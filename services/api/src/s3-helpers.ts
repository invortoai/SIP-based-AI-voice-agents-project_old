import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSecret } from '@invorto/shared';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
});

// Get bucket names from environment or secrets
async function getBucketNames() {
  const recordingsBucket = process.env.S3_BUCKET_RECORDINGS || await getSecret('S3_BUCKET_RECORDINGS') || 'invorto-recordings';
  const transcriptsBucket = process.env.S3_BUCKET_TRANSCRIPTS || await getSecret('S3_BUCKET_TRANSCRIPTS') || 'invorto-transcripts';
  const documentsBucket = process.env.S3_BUCKET_DOCUMENTS || await getSecret('S3_BUCKET_DOCUMENTS') || 'invorto-documents';

  return {
    recordings: recordingsBucket,
    transcripts: transcriptsBucket,
    documents: documentsBucket,
  };
}

export const s3Artifacts = {
  async getCallArtifacts(callId: string) {
    try {
      const buckets = await getBucketNames();

      // Get recording URL (if exists)
      let recordingUrl = null;
      try {
        const recordingKey = `recordings/${callId}.wav`;
        await s3Client.send(new HeadObjectCommand({
          Bucket: buckets.recordings,
          Key: recordingKey,
        }));
        recordingUrl = await getSignedUrl(s3Client, new GetObjectCommand({
          Bucket: buckets.recordings,
          Key: recordingKey,
        }), { expiresIn: 3600 }); // 1 hour
      } catch {
        // Recording doesn't exist
      }

      // Get transcription (if exists)
      let transcription = null;
      try {
        const transcriptKey = `transcriptions/${callId}.json`;
        const transcriptResponse = await s3Client.send(new GetObjectCommand({
          Bucket: buckets.transcripts,
          Key: transcriptKey,
        }));
        const transcriptData = await transcriptResponse.Body?.transformToString();
        if (transcriptData) {
          const transcriptJson = JSON.parse(transcriptData);
          transcription = transcriptJson.transcription || null;
        }
      } catch {
        // Transcription doesn't exist
      }

      // Get summary (if exists)
      let summary = null;
      try {
        const summaryKey = `summaries/${callId}.json`;
        const summaryResponse = await s3Client.send(new GetObjectCommand({
          Bucket: buckets.transcripts,
          Key: summaryKey,
        }));
        const summaryData = await summaryResponse.Body?.transformToString();
        if (summaryData) {
          const summaryJson = JSON.parse(summaryData);
          summary = summaryJson.summary || null;
        }
      } catch {
        // Summary doesn't exist
      }

      return {
        recording: recordingUrl,
        transcription: transcription || 'Transcription not available',
        summary: summary || 'Summary not available',
        metadata: {
          callId,
          processed: !!(transcription && summary),
          hasRecording: !!recordingUrl,
        }
      };
    } catch (error) {
      console.error('Error getting call artifacts:', error);
      throw new Error('Failed to retrieve call artifacts');
    }
  },

  async uploadRecording(callId: string, buffer: Buffer | Uint8Array) {
    try {
      const buckets = await getBucketNames();
      const key = `recordings/${callId}.wav`;

      await s3Client.send(new PutObjectCommand({
        Bucket: buckets.recordings,
        Key: key,
        Body: buffer,
        ContentType: 'audio/wav',
        Metadata: {
          callId,
          uploadedAt: new Date().toISOString(),
        },
      }));

      return `s3://${buckets.recordings}/${key}`;
    } catch (error) {
      console.error('Error uploading recording:', error);
      throw new Error('Failed to upload recording');
    }
  },

  async uploadSummary(callId: string, summary: any) {
    try {
      const buckets = await getBucketNames();
      const key = `summaries/${callId}.json`;

      await s3Client.send(new PutObjectCommand({
        Bucket: buckets.transcripts,
        Key: key,
        Body: JSON.stringify({
          callId,
          summary: typeof summary === 'string' ? summary : JSON.stringify(summary),
          createdAt: new Date().toISOString(),
        }),
        ContentType: 'application/json',
        Metadata: {
          callId,
          type: 'summary',
        },
      }));

      return `s3://${buckets.transcripts}/${key}`;
    } catch (error) {
      console.error('Error uploading summary:', error);
      throw new Error('Failed to upload summary');
    }
  },

  async uploadDocument(callId: string, buffer: Buffer, key: string) {
    try {
      const buckets = await getBucketNames();
      const fullKey = `documents/${callId}/${key}`;

      // Determine content type based on file extension
      const contentType = key.endsWith('.pdf') ? 'application/pdf' :
                         key.endsWith('.txt') ? 'text/plain' :
                         key.endsWith('.json') ? 'application/json' :
                         'application/octet-stream';

      await s3Client.send(new PutObjectCommand({
        Bucket: buckets.documents,
        Key: fullKey,
        Body: buffer,
        ContentType: contentType,
        Metadata: {
          callId,
          originalKey: key,
          uploadedAt: new Date().toISOString(),
        },
      }));

      // Generate signed URL for access
      const signedUrl = await getSignedUrl(s3Client, new GetObjectCommand({
        Bucket: buckets.documents,
        Key: fullKey,
      }), { expiresIn: 3600 }); // 1 hour

      return signedUrl;
    } catch (error) {
      console.error('Error uploading document:', error);
      throw new Error('Failed to upload document');
    }
  },

  async getDocumentUrl(key: string) {
    try {
      const buckets = await getBucketNames();

      // Generate signed URL for the document
      const signedUrl = await getSignedUrl(s3Client, new GetObjectCommand({
        Bucket: buckets.documents,
        Key: key,
      }), { expiresIn: 3600 }); // 1 hour

      return signedUrl;
    } catch (error) {
      console.error('Error generating document URL:', error);
      throw new Error('Failed to generate document URL');
    }
  }
};