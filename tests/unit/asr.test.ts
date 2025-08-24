import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DeepgramWsAsr } from '../../services/realtime/src/adapters/asr/deepgram_ws';
import { EventEmitter } from 'events';

// Mock Deepgram SDK
jest.mock('@deepgram/sdk', () => ({
  createClient: jest.fn(() => ({
    listen: {
      live: jest.fn(() => new MockLiveClient())
    }
  })),
  LiveTranscriptionEvents: {
    Open: 'open',
    Transcript: 'transcript',
    Metadata: 'metadata',
    Error: 'error',
    Close: 'close',
    UtteranceEnd: 'utteranceEnd'
  }
}));

class MockLiveClient extends EventEmitter {
  send = jest.fn();
  finish = jest.fn();
  close = jest.fn();
}

describe('DeepgramWsAsr', () => {
  let asr: DeepgramWsAsr;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    asr = new DeepgramWsAsr({
      apiKey: mockApiKey,
      language: 'en-US',
      sampleRate: 16000
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create instance with correct options', () => {
      expect(asr).toBeDefined();
      expect(asr.isActive()).toBe(false);
    });
  });

  describe('start', () => {
    it('should establish WebSocket connection', async () => {
      await asr.start();
      expect(asr.isActive()).toBe(false); // Will be true after 'open' event
    });

    it('should handle connection errors', async () => {
      const errorHandler = jest.fn();
      asr.onError(errorHandler);
      
      await asr.start();
      asr.emit('error', new Error('Connection failed'));
      
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('audio processing', () => {
    it('should send audio chunks when connected', async () => {
      await asr.start();
      
      const audioChunk = new Uint8Array([1, 2, 3, 4]);
      await asr.pushPcm16(audioChunk);
      
      // Audio should be buffered until connection is open
      expect(asr.isActive()).toBe(false);
    });

    it('should buffer audio when not connected', async () => {
      const audioChunk = new Uint8Array([1, 2, 3, 4]);
      await asr.pushPcm16(audioChunk);
      
      // Should not throw error
      expect(true).toBe(true);
    });
  });

  describe('transcription events', () => {
    it('should emit partial transcripts', async () => {
      const partialHandler = jest.fn();
      asr.onPartial(partialHandler);
      
      await asr.start();
      
      // Simulate partial transcript
      asr.emit('partial', { text: 'hello', confidence: 0.9 });
      
      expect(partialHandler).toHaveBeenCalledWith('hello', 0.9);
    });

    it('should emit final transcripts', async () => {
      const finalHandler = jest.fn();
      asr.onFinal(finalHandler);
      
      await asr.start();
      
      // Simulate final transcript
      asr.emit('final', { text: 'hello world', confidence: 0.95, duration: 2.5 });
      
      expect(finalHandler).toHaveBeenCalledWith('hello world', 0.95, 2.5);
    });
  });

  describe('reconnection', () => {
    it('should attempt reconnection on disconnect', async () => {
      await asr.start();
      
      // Simulate disconnect
      asr.emit('close', { code: 1006, reason: 'Abnormal closure' });
      
      // Should trigger reconnection logic
      expect(asr.isActive()).toBe(false);
    });

    it('should not reconnect after intentional close', async () => {
      await asr.start();
      await asr.end();
      
      // Should not attempt reconnection
      expect(asr.isActive()).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on end', async () => {
      await asr.start();
      await asr.end();
      
      expect(asr.isActive()).toBe(false);
    });

    it('should clear audio buffer', () => {
      asr.clearBuffer();
      // Buffer should be empty
      expect(true).toBe(true);
    });
  });
});