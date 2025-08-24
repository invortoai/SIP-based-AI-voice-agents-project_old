import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommandInput,
  GetObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import path from "path";

export interface S3Config {
  region?: string;
  endpoint?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export interface ArtifactMetadata {
  callId: string;
  type: "recording" | "transcript" | "metrics" | "summary";
  format?: string;
  duration?: number;
  size?: number;
  timestamp: string;
}

export class S3ArtifactManager {
  private s3Client: S3Client;
  private recordingsBucket: string;
  private transcriptsBucket: string;
  private metricsBucket: string;

  constructor(config?: S3Config) {
    this.s3Client = new S3Client(config || {});
    this.recordingsBucket = process.env.S3_BUCKET_RECORDINGS || "invorto-recordings";
    this.transcriptsBucket = process.env.S3_BUCKET_TRANSCRIPTS || "invorto-transcripts";
    this.metricsBucket = process.env.S3_BUCKET_METRICS || "invorto-metrics";
  }

  // Upload methods
  async uploadRecording(
    callId: string,
    audioData: Buffer | Uint8Array | Readable,
    metadata?: Partial<ArtifactMetadata>
  ): Promise<string> {
    const key = `recordings/${callId}.wav`;
    const params: PutObjectCommandInput = {
      Bucket: this.recordingsBucket,
      Key: key,
      Body: audioData,
      ContentType: "audio/wav",
      Metadata: {
        callId,
        type: "recording",
        timestamp: new Date().toISOString(),
        ...this.flattenMetadata(metadata),
      },
    };

    await this.s3Client.send(new PutObjectCommand(params));
    return `s3://${this.recordingsBucket}/${key}`;
  }

  async uploadTranscript(
    callId: string,
    transcript: any[],
    format: "json" | "jsonl" | "txt" = "jsonl"
  ): Promise<string> {
    const key = `transcripts/${callId}.${format}`;
    let body: string;

    switch (format) {
      case "jsonl":
        body = transcript.map(item => JSON.stringify(item)).join("\n");
        break;
      case "json":
        body = JSON.stringify(transcript, null, 2);
        break;
      case "txt":
        body = transcript
          .map(item => `[${item.timestamp || ""}] ${item.speaker || ""}: ${item.text}`)
          .join("\n");
        break;
      default:
        body = JSON.stringify(transcript);
    }

    const params: PutObjectCommandInput = {
      Bucket: this.transcriptsBucket,
      Key: key,
      Body: body,
      ContentType: format === "txt" ? "text/plain" : "application/json",
      Metadata: {
        callId,
        type: "transcript",
        format,
        timestamp: new Date().toISOString(),
        lineCount: String(transcript.length),
      },
    };

    await this.s3Client.send(new PutObjectCommand(params));
    return `s3://${this.transcriptsBucket}/${key}`;
  }

  async uploadMetrics(
    callId: string,
    metrics: any,
    format: "json" | "ndjson" = "ndjson"
  ): Promise<string> {
    const key = `metrics/${callId}.${format}`;
    const body = format === "ndjson" 
      ? Object.entries(metrics).map(([k, v]) => JSON.stringify({ metric: k, value: v })).join("\n")
      : JSON.stringify(metrics, null, 2);

    const params: PutObjectCommandInput = {
      Bucket: this.metricsBucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      Metadata: {
        callId,
        type: "metrics",
        format,
        timestamp: new Date().toISOString(),
      },
    };

    await this.s3Client.send(new PutObjectCommand(params));
    return `s3://${this.metricsBucket}/${key}`;
  }

  async uploadSummary(callId: string, summary: any): Promise<string> {
    const key = `summaries/${callId}.json`;
    const params: PutObjectCommandInput = {
      Bucket: this.transcriptsBucket,
      Key: key,
      Body: JSON.stringify(summary, null, 2),
      ContentType: "application/json",
      Metadata: {
        callId,
        type: "summary",
        timestamp: new Date().toISOString(),
      },
    };

    await this.s3Client.send(new PutObjectCommand(params));
    return `s3://${this.transcriptsBucket}/${key}`;
  }

  // Stream upload for large files
  async uploadStream(
    bucket: string,
    key: string,
    stream: Readable,
    contentType?: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    const chunks: Buffer[] = [];
    
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    
    const body = Buffer.concat(chunks);
    
    const params: PutObjectCommandInput = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    };

    await this.s3Client.send(new PutObjectCommand(params));
    return `s3://${bucket}/${key}`;
  }

  // Generate signed URLs
  async getSignedUrl(
    type: "recording" | "transcript" | "metrics" | "summary",
    callId: string,
    expiresIn: number = 3600
  ): Promise<string> {
    let bucket: string;
    let key: string;

    switch (type) {
      case "recording":
        bucket = this.recordingsBucket;
        key = `recordings/${callId}.wav`;
        break;
      case "transcript":
        bucket = this.transcriptsBucket;
        key = `transcripts/${callId}.jsonl`;
        break;
      case "metrics":
        bucket = this.metricsBucket;
        key = `metrics/${callId}.ndjson`;
        break;
      case "summary":
        bucket = this.transcriptsBucket;
        key = `summaries/${callId}.json`;
        break;
      default:
        throw new Error(`Unknown artifact type: ${type}`);
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async getSignedUploadUrl(
    bucket: string,
    key: string,
    contentType?: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  // Get all artifacts for a call
  async getCallArtifacts(callId: string): Promise<{
    recording?: string;
    transcript?: string;
    metrics?: string;
    summary?: string;
  }> {
    const artifacts: any = {};

    try {
      artifacts.recording = await this.getSignedUrl("recording", callId);
    } catch {}

    try {
      artifacts.transcript = await this.getSignedUrl("transcript", callId);
    } catch {}

    try {
      artifacts.metrics = await this.getSignedUrl("metrics", callId);
    } catch {}

    try {
      artifacts.summary = await this.getSignedUrl("summary", callId);
    } catch {}

    return artifacts;
  }

  // Check if artifact exists
  async artifactExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
      return true;
    } catch {
      return false;
    }
  }

  // Delete artifacts
  async deleteCallArtifacts(callId: string): Promise<void> {
    const deletions = [
      this.deleteObject(this.recordingsBucket, `recordings/${callId}.wav`),
      this.deleteObject(this.transcriptsBucket, `transcripts/${callId}.jsonl`),
      this.deleteObject(this.transcriptsBucket, `transcripts/${callId}.json`),
      this.deleteObject(this.transcriptsBucket, `transcripts/${callId}.txt`),
      this.deleteObject(this.metricsBucket, `metrics/${callId}.ndjson`),
      this.deleteObject(this.metricsBucket, `metrics/${callId}.json`),
      this.deleteObject(this.transcriptsBucket, `summaries/${callId}.json`),
    ];

    await Promise.allSettled(deletions);
  }

  private async deleteObject(bucket: string, key: string): Promise<void> {
    try {
      await this.s3Client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
    } catch {
      // Ignore errors for non-existent objects
    }
  }

  // List artifacts
  async listCallRecordings(prefix: string = ""): Promise<string[]> {
    const response = await this.s3Client.send(new ListObjectsV2Command({
      Bucket: this.recordingsBucket,
      Prefix: `recordings/${prefix}`,
      MaxKeys: 1000,
    }));

    return response.Contents?.map(obj => obj.Key!) || [];
  }

  // Helper to flatten metadata for S3
  private flattenMetadata(metadata?: any): Record<string, string> {
    if (!metadata) return {};
    
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== undefined && value !== null) {
        flat[key] = String(value);
      }
    }
    return flat;
  }

  // Batch upload helper
  async batchUpload(
    uploads: Array<{
      bucket: string;
      key: string;
      body: Buffer | Uint8Array | string;
      contentType?: string;
      metadata?: Record<string, string>;
    }>
  ): Promise<string[]> {
    const results = await Promise.all(
      uploads.map(async (upload) => {
        const params: PutObjectCommandInput = {
          Bucket: upload.bucket,
          Key: upload.key,
          Body: upload.body,
          ContentType: upload.contentType,
          Metadata: upload.metadata,
        };
        
        await this.s3Client.send(new PutObjectCommand(params));
        return `s3://${upload.bucket}/${upload.key}`;
      })
    );
    
    return results;
  }
}

// Export singleton instance
export const s3Artifacts = new S3ArtifactManager();