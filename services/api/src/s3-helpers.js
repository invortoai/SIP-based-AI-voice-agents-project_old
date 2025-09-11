// Test stub for S3 artifact helpers used by API service during Jest runs.
// Provides minimal async methods so routes can execute without AWS dependencies.

export const s3Artifacts = {
  async getCallArtifacts(callId) {
    return {
      recording: `https://example.com/recordings/${callId}.wav`,
      transcription: 'Hello, how can I help you? I can assist with various tasks.',
      summary: 'Mock summary for testing',
      metadata: { callId, processed: true }
    };
  },

  async uploadRecording(callId, _buffer) {
    return `s3://mock-bucket/recordings/${callId}.wav`;
  },

  async uploadSummary(callId, _summary) {
    return `s3://mock-bucket/summaries/${callId}.json`;
  }
};