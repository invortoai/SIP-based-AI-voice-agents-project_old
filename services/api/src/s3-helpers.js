// CommonJS test stub for S3 artifact helpers so Jest can parse this file without ESM/transform issues.
module.exports = {
  s3Artifacts: {
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
  }
};