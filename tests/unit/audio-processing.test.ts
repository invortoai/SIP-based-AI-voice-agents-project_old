/// <reference path="../jest-globals.d.ts" />
/* Using global Jest via ../jest-globals.d.ts */
import { JitterBuffer } from '../../services/realtime/src/runtime/jitterBuffer';
import { EnergyMeter } from '../../services/realtime/src/runtime/energyMeter';

describe('Audio Processing Components', () => {
  describe('JitterBuffer', () => {
    let jitterBuffer: JitterBuffer;

    beforeEach(() => {
      jitterBuffer = new JitterBuffer({
        targetMs: 40,
        sampleRate: 16000,
        channels: 1,
        frameMs: 20
      });
    });

    afterEach(() => {
      jitterBuffer.reset();
    });

    describe('initialization', () => {
      it('should create instance with correct configuration', () => {
        expect(jitterBuffer).toBeDefined();
        expect(jitterBuffer.getBufferSize()).toBe(0);
      });

      it('should have default adaptive mode enabled', () => {
        const stats = jitterBuffer.getStats();
        expect(stats).toBeDefined();
        expect(stats.packetsReceived).toBe(0);
      });
    });

    describe('packet handling', () => {
      it('should accept RTP packets with sequence numbers', () => {
        const audioData = new Uint8Array([1, 2, 3, 4]);
        jitterBuffer.push(1, Date.now(), audioData);

        const stats = jitterBuffer.getStats();
        expect(stats.packetsReceived).toBe(1);
        expect(stats.currentBufferSize).toBe(1);
      });

      it('should handle packet reordering', () => {
        const audioData1 = new Uint8Array([1, 2]);
        const audioData2 = new Uint8Array([3, 4]);
        const audioData3 = new Uint8Array([5, 6]);

        // Send packets out of order
        jitterBuffer.push(3, Date.now(), audioData3);
        jitterBuffer.push(1, Date.now(), audioData1);
        jitterBuffer.push(2, Date.now(), audioData2);

        const stats = jitterBuffer.getStats();
        expect(stats.packetsReceived).toBe(3);
        expect(stats.currentBufferSize).toBe(3);
      });

      it('should discard late packets', () => {
        const audioData = new Uint8Array([1, 2, 3, 4]);

        // Send a packet with very old sequence number
        jitterBuffer.push(1, Date.now(), audioData);
        jitterBuffer.push(1000, Date.now(), audioData); // Much higher sequence

        // Now try to send a very old packet
        jitterBuffer.push(1, Date.now(), audioData); // Should be discarded

        const stats = jitterBuffer.getStats();
        expect(stats.packetsReceived).toBe(2); // Only 2 packets received
        expect(stats.packetsLate).toBe(1);
      });
    });

    describe('playback', () => {
      it('should return audio data in correct order', () => {
        const audioData1 = new Uint8Array([1, 2]);
        const audioData2 = new Uint8Array([3, 4]);

        jitterBuffer.push(1, Date.now(), audioData1);
        jitterBuffer.push(2, Date.now(), audioData2);

        const result1 = jitterBuffer.pop();
        const result2 = jitterBuffer.pop();

        expect(result1).toEqual(audioData1);
        expect(result2).toEqual(audioData2);
      });

      it('should use PLC for missing packets', () => {
        const audioData = new Uint8Array([100, 101, 102, 103]);

        // Send packet 1, skip packet 2, send packet 3
        jitterBuffer.push(1, Date.now(), audioData);
        jitterBuffer.push(3, Date.now(), audioData);

        const result1 = jitterBuffer.pop(); // Should get packet 1
        const result2 = jitterBuffer.pop(); // Should get PLC packet

        expect(result1).toEqual(audioData);
        expect(result2).toBeDefined();
        expect(result2!.length).toBe(audioData.length);
        // PLC packet should be attenuated
        expect(result2![0]).toBeLessThan(audioData[0]);
      });
    });

    describe('statistics', () => {
      it('should track comprehensive statistics', () => {
        const audioData = new Uint8Array([1, 2, 3, 4]);

        // Send some packets
        for (let i = 1; i <= 5; i++) {
          jitterBuffer.push(i, Date.now(), audioData);
        }

        // Play back some packets
        jitterBuffer.pop();
        jitterBuffer.pop();

        const stats = jitterBuffer.getStats();

        expect(stats.packetsReceived).toBe(5);
        expect(stats.packetsPlayed).toBe(2);
        expect(stats.currentBufferSize).toBe(3);
        expect(stats.jitterMs).toBeDefined();
        expect(stats.averageLatency).toBeDefined();
      });

      it('should calculate jitter correctly', () => {
        const audioData = new Uint8Array([1, 2]);

        // Send packets with varying delays
        const baseTime = Date.now();
        jitterBuffer.push(1, baseTime, audioData);
        jitterBuffer.push(2, baseTime + 10, audioData);
        jitterBuffer.push(3, baseTime + 25, audioData);

        const stats = jitterBuffer.getStats();
        expect(stats.jitterMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('adaptive buffering', () => {
      it('should adapt buffer size based on conditions', () => {
        // This would require mocking network conditions
        // For now, just test the configuration
        expect(jitterBuffer.getStats().currentBufferSize).toBeDefined();
      });
    });
  });

  describe('EnergyMeter', () => {
    let energyMeter: EnergyMeter;
    let mockCallback: jest.Mock;

    beforeEach(() => {
      mockCallback = jest.fn();
      energyMeter = new EnergyMeter({
        sampleRate: 16000,
        intervalMs: 250,
        speakingThresholdDb: -40,
        noiseGateThreshold: -55,
        adaptiveMode: true
      });
      energyMeter.onWindow(mockCallback);
    });

    afterEach(() => {
      energyMeter.stop();
    });

    describe('initialization', () => {
      it('should create instance with correct configuration', () => {
        expect(energyMeter).toBeDefined();
        expect(energyMeter.getNoiseFloor()).toBe(-60);
        expect(energyMeter.getSpeakingThreshold()).toBe(-40);
      });
    });

    describe('audio processing', () => {
      it('should process PCM16 audio and emit energy windows', () => {
        // Create a sine wave at 440Hz (A4 note)
        const frequency = 440;
        const sampleRate = 16000;
        const duration = 0.1; // 100ms
        const numSamples = Math.floor(sampleRate * duration);

        const pcm16 = new Uint8Array(numSamples * 2); // 16-bit samples
        const dataView = new DataView(pcm16.buffer);

        for (let i = 0; i < numSamples; i++) {
          const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 16384; // 50% amplitude
          dataView.setInt16(i * 2, Math.floor(sample), true);
        }

        energyMeter.pushPcm16(pcm16);

        // Manually trigger flush (normally done by timer)
        (energyMeter as any).flushWindow();

        expect(mockCallback).toHaveBeenCalled();
        const window = mockCallback.mock.calls[0][0];

        expect(window).toHaveProperty('energyDb');
        expect(window).toHaveProperty('speaking');
        expect(window).toHaveProperty('noiseFloor');
        expect(window).toHaveProperty('snr');
        expect(window).toHaveProperty('bands');
        expect(window).toHaveProperty('vadConfidence');

        expect(typeof window.energyDb).toBe('number');
        expect(typeof window.speaking).toBe('boolean');
        expect(window.bands).toHaveProperty('low');
        expect(window.bands).toHaveProperty('mid');
        expect(window.bands).toHaveProperty('high');
      });

      it('should detect speaking vs silence', () => {
        // Silent audio (all zeros)
        const silentPcm = new Uint8Array(320); // 10ms at 16kHz
        energyMeter.pushPcm16(silentPcm);
        (energyMeter as any).flushWindow();

        const silentWindow = mockCallback.mock.calls[mockCallback.mock.calls.length - 1][0];
        expect(silentWindow.energyDb).toBe(-120); // Very low energy
        expect(silentWindow.speaking).toBe(false);

        // Reset callback mock
        mockCallback.mockClear();

        // Loud audio
        const loudPcm = new Uint8Array(320);
        const dataView = new DataView(loudPcm.buffer);
        for (let i = 0; i < 160; i++) {
          dataView.setInt16(i * 2, 10000, true); // High amplitude
        }

        energyMeter.pushPcm16(loudPcm);
        (energyMeter as any).flushWindow();

        const loudWindow = mockCallback.mock.calls[0][0];
        expect(loudWindow.energyDb).toBeGreaterThan(-60); // Higher energy
        expect(loudWindow.speaking).toBe(true);
      });

      it('should perform multi-band analysis', () => {
        const pcm16 = new Uint8Array(640); // 20ms at 16kHz
        const dataView = new DataView(pcm16.buffer);

        // Create mixed frequency content
        for (let i = 0; i < 320; i++) {
          const lowFreq = Math.sin(2 * Math.PI * 100 * i / 16000) * 8192;   // 100Hz
          const midFreq = Math.sin(2 * Math.PI * 1000 * i / 16000) * 4096;  // 1kHz
          const highFreq = Math.sin(2 * Math.PI * 5000 * i / 16000) * 2048; // 5kHz
          const sample = lowFreq + midFreq + highFreq;
          dataView.setInt16(i * 2, Math.floor(sample), true);
        }

        energyMeter.pushPcm16(pcm16);
        (energyMeter as any).flushWindow();

        const window = mockCallback.mock.calls[0][0];

        expect(window.bands.low).toBeDefined();
        expect(window.bands.mid).toBeDefined();
        expect(window.bands.high).toBeDefined();

        // Low band should have highest energy due to 100Hz component
        expect(window.bands.low).toBeGreaterThan(window.bands.high);
      });
    });

    describe('noise gating', () => {
      it('should apply noise gating below threshold', () => {
        // Very quiet audio below noise gate
        const quietPcm = new Uint8Array(320);
        const dataView = new DataView(quietPcm.buffer);
        for (let i = 0; i < 160; i++) {
          dataView.setInt16(i * 2, 10, true); // Very low amplitude
        }

        energyMeter.pushPcm16(quietPcm);
        (energyMeter as any).flushWindow();

        const window = mockCallback.mock.calls[0][0];
        expect(window.energyDb).toBe(-120); // Should be gated to -120dB
      });
    });

    describe('adaptive thresholds', () => {
      it('should adapt speaking threshold based on environment', () => {
        const initialThreshold = energyMeter.getSpeakingThreshold();

        // Simulate consistent audio environment
        for (let i = 0; i < 25; i++) {
          const pcm16 = new Uint8Array(320);
          const dataView = new DataView(pcm16.buffer);
          for (let j = 0; j < 160; j++) {
            dataView.setInt16(j * 2, 1000 + Math.floor(Math.random() * 500), true);
          }

          energyMeter.pushPcm16(pcm16);
          (energyMeter as any).flushWindow();
        }

        const adaptedThreshold = energyMeter.getSpeakingThreshold();
        // Threshold should have adapted (may be higher or lower depending on noise)
        expect(typeof adaptedThreshold).toBe('number');
        expect(adaptedThreshold).toBeGreaterThanOrEqual(-60);
        expect(adaptedThreshold).toBeLessThanOrEqual(-20);
      });
    });

    describe('VAD confidence', () => {
      it('should calculate VAD confidence based on multiple factors', () => {
        // Clear audio (should have low confidence)
        const silentPcm = new Uint8Array(320);
        energyMeter.pushPcm16(silentPcm);
        (energyMeter as any).flushWindow();

        const silentWindow = mockCallback.mock.calls[0][0];
        expect(silentWindow.vadConfidence).toBeLessThan(0.5);

        mockCallback.mockClear();

        // Speech-like audio (should have higher confidence)
        const speechPcm = new Uint8Array(320);
        const dataView = new DataView(speechPcm.buffer);
        for (let i = 0; i < 160; i++) {
          // Mix of frequencies typical for speech
          const sample = Math.sin(2 * Math.PI * 200 * i / 16000) * 8000 +
                        Math.sin(2 * Math.PI * 1200 * i / 16000) * 4000;
          dataView.setInt16(i * 2, Math.floor(sample), true);
        }

        energyMeter.pushPcm16(speechPcm);
        (energyMeter as any).flushWindow();

        const speechWindow = mockCallback.mock.calls[0][0];
        expect(speechWindow.vadConfidence).toBeGreaterThan(0.3);
      });
    });
  });

  describe('Integration Tests', () => {
    it('should integrate JitterBuffer with EnergyMeter', () => {
      const jitterBuffer = new JitterBuffer({
        targetMs: 40,
        sampleRate: 16000,
        channels: 1,
        frameMs: 20
      });

      const energyMeter = new EnergyMeter({
        sampleRate: 16000,
        intervalMs: 250
      });

      let energyWindows: any[] = [];
      energyMeter.onWindow((window) => {
        energyWindows.push(window);
      });

      // Create test audio data
      const audioData = new Uint8Array(640); // 20ms at 16kHz
      const dataView = new DataView(audioData.buffer);
      for (let i = 0; i < 320; i++) {
        const sample = Math.sin(2 * Math.PI * 440 * i / 16000) * 8192;
        dataView.setInt16(i * 2, Math.floor(sample), true);
      }

      // Send through jitter buffer
      jitterBuffer.push(1, Date.now(), audioData);
      const processedAudio = jitterBuffer.pop();

      // Process with energy meter
      if (processedAudio) {
        energyMeter.pushPcm16(processedAudio);
        (energyMeter as any).flushWindow();
      }

      expect(energyWindows.length).toBeGreaterThan(0);
      expect(energyWindows[0].energyDb).toBeDefined();
      expect(energyWindows[0].speaking).toBeDefined();
    });
  });
});