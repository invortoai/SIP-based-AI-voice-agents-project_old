// Test stub for S3 artifact helpers used by API service during Jest runs.
// Provides minimal async methods so routes can execute without AWS dependencies.

export const s3Artifacts = {
  async getCallArtifacts(callId: string) {
    return {
      recording: `https://example.com/recordings/${callId}.wav`,
      transcription: 'Hello, how can I help you? I can assist with various tasks.',
      summary: 'Mock summary for testing',
      metadata: { callId, processed: true }
    };
  },

  async uploadRecording(callId: string, _buffer: Buffer | Uint8Array | any) {
    return `s3://mock-bucket/recordings/${callId}.wav`;
  },

  async uploadSummary(callId: string, _summary: unknown) {
    return `s3://mock-bucket/summaries/${callId}.json`;
  },

  async uploadDocument(callId: string, buffer: Buffer, key: string) {
    // In test environment, return mock URL
    if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') {
      return `https://mock-s3.example.com/${key}`;
    }

    // In production, this would upload to actual S3
    // For now, return a placeholder - you would implement actual S3 upload here
    return `https://s3.amazonaws.com/your-bucket/${key}`;
  },

  async getDocumentUrl(key: string) {
    // In test environment, return mock URL
    if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') {
      return `https://mock-s3.example.com/${key}`;
    }

    // In production, generate signed URL for S3 object
    // For now, return a placeholder - you would implement actual signed URL generation here
    return `https://s3.amazonaws.com/your-bucket/${key}?signed=true`;
  }
};