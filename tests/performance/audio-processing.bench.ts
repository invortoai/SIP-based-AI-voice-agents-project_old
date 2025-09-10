/**
 * Performance benchmarks for audio processing components
 */

import { JitterBuffer } from '../../services/realtime/src/runtime/jitterBuffer';
import { EnergyMeter } from '../../services/realtime/src/runtime/energyMeter';

describe('Audio Processing Performance Benchmarks', () => {
  let jitterBuffer: JitterBuffer;
  let energyMeter: EnergyMeter;

  beforeEach(() => {
    jitterBuffer = new JitterBuffer({
      targetMs: 40,
      sampleRate: 16000,
      channels: 1,
      frameMs: 20
    });

    energyMeter = new EnergyMeter({
      sampleRate: 16000,
      intervalMs: 250,
      speakingThresholdDb: -40,
      adaptiveMode: false // Disable for consistent benchmarking
    });
  });

  describe('Jitter Buffer Performance', () => {
    benchmark('JitterBuffer packet push/pop throughput', () => {
      const audioData = new Uint8Array(640); // 20ms at 16kHz
      const dataView = new DataView(audioData.buffer);

      // Fill with test data
      for (let i = 0; i < 320; i++) {
        dataView.setInt16(i * 2, Math.sin(i * 0.1) * 10000, true);
      }

      // Benchmark packet processing
      for (let seq = 1; seq <= 1000; seq++) {
        jitterBuffer.push(seq, Date.now(), audioData);
        jitterBuffer.pop();
      }
    });

    benchmark('JitterBuffer statistics calculation', () => {
      // Fill buffer with test data
      for (let i = 1; i <= 100; i++) {
        const audioData = new Uint8Array(640);
        jitterBuffer.push(i, Date.now(), audioData);
        jitterBuffer.pop();
      }

      // Benchmark statistics calculation
      for (let i = 0; i < 1000; i++) {
        jitterBuffer.getStats();
      }
    });

    benchmark('JitterBuffer packet loss simulation', () => {
      // Simulate packet loss scenario
      for (let seq = 1; seq <= 1000; seq++) {
        if (seq % 10 !== 0) { // Lose every 10th packet
          const audioData = new Uint8Array(640);
          jitterBuffer.push(seq, Date.now(), audioData);
        }
        jitterBuffer.pop(); // This should trigger PLC for missing packets
      }
    });
  });

  describe('Energy Meter Performance', () => {
    benchmark('EnergyMeter audio analysis throughput', () => {
      const audioData = new Uint8Array(3200); // 100ms at 16kHz
      const dataView = new DataView(audioData.buffer);

      // Fill with complex audio signal
      for (let i = 0; i < 1600; i++) {
        const sample = (
          Math.sin(i * 0.1) * 8000 +  // 440Hz tone
          Math.sin(i * 0.05) * 4000 +  // 220Hz tone
          Math.random() * 1000         // Noise
        );
        dataView.setInt16(i * 2, Math.floor(sample), true);
      }

      // Benchmark analysis throughput
      for (let i = 0; i < 1000; i++) {
        energyMeter.pushPcm16(audioData);
        (energyMeter as any).flushWindow();
      }
    });

    benchmark('EnergyMeter multi-band analysis', () => {
      const audioData = new Uint8Array(3200);

      // Benchmark frequency band analysis
      for (let i = 0; i < 500; i++) {
        energyMeter.pushPcm16(audioData);
        (energyMeter as any).flushWindow();
      }
    });

    benchmark('EnergyMeter adaptive threshold adjustment', () => {
      energyMeter = new EnergyMeter({
        sampleRate: 16000,
        intervalMs: 250,
        speakingThresholdDb: -40,
        adaptiveMode: true // Enable adaptive mode
      });

      const audioData = new Uint8Array(3200);

      // Benchmark adaptive algorithm
      for (let i = 0; i < 1000; i++) {
        energyMeter.pushPcm16(audioData);
        (energyMeter as any).flushWindow();
      }
    });
  });

  describe('Integration Performance', () => {
    benchmark('Full audio pipeline throughput', () => {
      const audioData = new Uint8Array(640);
      const dataView = new DataView(audioData.buffer);

      // Fill with realistic audio data
      for (let i = 0; i < 320; i++) {
        dataView.setInt16(i * 2, Math.sin(i * 0.1) * 8000 + Math.random() * 2000, true);
      }

      // Benchmark complete pipeline
      for (let seq = 1; seq <= 1000; seq++) {
        // Jitter buffer processing
        jitterBuffer.push(seq, Date.now(), audioData);
        const processedAudio = jitterBuffer.pop();

        // Energy meter processing
        if (processedAudio) {
          energyMeter.pushPcm16(processedAudio);
          (energyMeter as any).flushWindow();
        }
      }
    });
  });

  describe('Memory Usage Benchmarks', () => {
    test('JitterBuffer memory efficiency', () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Process large amount of audio data
      for (let seq = 1; seq <= 10000; seq++) {
        const audioData = new Uint8Array(640);
        jitterBuffer.push(seq, Date.now(), audioData);
        jitterBuffer.pop();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      console.log(`Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
    });

    test('EnergyMeter memory efficiency', () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Process large amount of audio data
      for (let i = 0; i < 10000; i++) {
        const audioData = new Uint8Array(3200);
        energyMeter.pushPcm16(audioData);
        (energyMeter as any).flushWindow();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      console.log(`Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
      expect(memoryIncrease).toBeLessThan(30 * 1024 * 1024); // Less than 30MB increase
    });
  });

  describe('Latency Benchmarks', () => {
    test('JitterBuffer processing latency', () => {
      const latencies: number[] = [];
      const audioData = new Uint8Array(640);

      for (let seq = 1; seq <= 1000; seq++) {
        const startTime = process.hrtime.bigint();
        jitterBuffer.push(seq, Date.now(), audioData);
        const result = jitterBuffer.pop();
        const endTime = process.hrtime.bigint();

        if (result) {
          const latencyMs = Number(endTime - startTime) / 1000000; // Convert to milliseconds
          latencies.push(latencyMs);
        }
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

      console.log(`Average latency: ${avgLatency.toFixed(3)}ms`);
      console.log(`Max latency: ${maxLatency.toFixed(3)}ms`);
      console.log(`95th percentile latency: ${p95Latency.toFixed(3)}ms`);

      expect(avgLatency).toBeLessThan(1.0); // Less than 1ms average
      expect(p95Latency).toBeLessThan(5.0); // Less than 5ms p95
    });

    test('EnergyMeter processing latency', () => {
      const latencies: number[] = [];
      const audioData = new Uint8Array(3200);

      for (let i = 0; i < 1000; i++) {
        const startTime = process.hrtime.bigint();
        energyMeter.pushPcm16(audioData);
        (energyMeter as any).flushWindow();
        const endTime = process.hrtime.bigint();

        const latencyMs = Number(endTime - startTime) / 1000000;
        latencies.push(latencyMs);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

      console.log(`Average latency: ${avgLatency.toFixed(3)}ms`);
      console.log(`Max latency: ${maxLatency.toFixed(3)}ms`);
      console.log(`95th percentile latency: ${p95Latency.toFixed(3)}ms`);

      expect(avgLatency).toBeLessThan(2.0); // Less than 2ms average
      expect(p95Latency).toBeLessThan(10.0); // Less than 10ms p95
    });
  });
});

/**
 * Simple benchmarking utility
 */
function benchmark(name: string, fn: () => void) {
  test(`Benchmark: ${name}`, () => {
    const startTime = process.hrtime.bigint();
    fn();
    const endTime = process.hrtime.bigint();

    const durationMs = Number(endTime - startTime) / 1000000;
    console.log(`${name}: ${durationMs.toFixed(2)}ms`);

    // Basic performance expectations
    expect(durationMs).toBeLessThan(5000); // Less than 5 seconds for any benchmark
  });
}