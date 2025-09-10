#!/usr/bin/env node

/**
 * Audio Processing Performance Test Script
 * Tests the performance of JitterBuffer and EnergyMeter components
 */

const { JitterBuffer } = require('../services/realtime/src/runtime/jitterBuffer.ts');
const { EnergyMeter } = require('../services/realtime/src/runtime/energyMeter.ts');

class PerformanceTest {
  constructor() {
    this.results = {};
  }

  runBenchmark(name, fn, iterations = 1000) {
    console.log(`\n🧪 Running benchmark: ${name}`);
    console.log(`   Iterations: ${iterations}`);

    const startTime = process.hrtime.bigint();
    const startMemory = process.memoryUsage().heapUsed;

    for (let i = 0; i < iterations; i++) {
      fn();
    }

    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage().heapUsed;

    const durationMs = Number(endTime - startTime) / 1000000;
    const memoryIncrease = endMemory - startMemory;
    const avgIterationTime = durationMs / iterations;

    this.results[name] = {
      totalTime: durationMs,
      avgIterationTime,
      memoryIncrease,
      iterations
    };

    console.log(`   ✅ Total time: ${durationMs.toFixed(2)}ms`);
    console.log(`   ✅ Avg per iteration: ${avgIterationTime.toFixed(4)}ms`);
    console.log(`   ✅ Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   ✅ Throughput: ${(iterations / durationMs * 1000).toFixed(0)} ops/sec`);

    return this.results[name];
  }

  testJitterBuffer() {
    console.log('\n🎵 Testing JitterBuffer Performance');

    const jitterBuffer = new JitterBuffer({
      targetMs: 40,
      sampleRate: 16000,
      channels: 1,
      frameMs: 20
    });

    // Test 1: Basic packet processing
    this.runBenchmark('JitterBuffer - Basic packet push/pop', () => {
      const audioData = new Uint8Array(640); // 20ms at 16kHz
      const seq = Math.floor(Math.random() * 10000);
      jitterBuffer.push(seq, Date.now(), audioData);
      jitterBuffer.pop();
    }, 5000);

    // Test 2: Statistics calculation
    this.runBenchmark('JitterBuffer - Statistics calculation', () => {
      jitterBuffer.getStats();
    }, 10000);

    // Test 3: Packet loss simulation
    this.runBenchmark('JitterBuffer - Packet loss handling', () => {
      const audioData = new Uint8Array(640);
      const seq = Math.floor(Math.random() * 10000);
      // Simulate 10% packet loss
      if (Math.random() > 0.1) {
        jitterBuffer.push(seq, Date.now(), audioData);
      }
      jitterBuffer.pop();
    }, 5000);

    console.log('\n📊 JitterBuffer Statistics:');
    console.log(JSON.stringify(jitterBuffer.getStats(), null, 2));
  }

  testEnergyMeter() {
    console.log('\n🎚️  Testing EnergyMeter Performance');

    const energyMeter = new EnergyMeter({
      sampleRate: 16000,
      intervalMs: 250,
      speakingThresholdDb: -40,
      adaptiveMode: false
    });

    // Generate test audio data
    const generateTestAudio = (samples = 3200) => {
      const audioData = new Uint8Array(samples * 2);
      const dataView = new DataView(audioData.buffer);

      for (let i = 0; i < samples; i++) {
        // Mix of speech-like frequencies with noise
        const sample = (
          Math.sin(i * 0.1) * 8000 +  // 440Hz tone
          Math.sin(i * 0.05) * 4000 +  // 220Hz tone
          (Math.random() - 0.5) * 2000  // Noise
        );
        dataView.setInt16(i * 2, Math.floor(Math.max(-32768, Math.min(32767, sample))), true);
      }

      return audioData;
    };

    const testAudio = generateTestAudio();

    // Test 1: Audio analysis throughput
    this.runBenchmark('EnergyMeter - Audio analysis', () => {
      energyMeter.pushPcm16(testAudio);
      // Note: flushWindow is private, so we can't call it directly
      // In real usage, this would be called by the timer
    }, 1000);

    console.log('\n📊 EnergyMeter Status:');
    console.log(`   Noise Floor: ${energyMeter.getNoiseFloor().toFixed(2)} dBFS`);
    console.log(`   Speaking Threshold: ${energyMeter.getSpeakingThreshold().toFixed(2)} dBFS`);
  }

  testIntegration() {
    console.log('\n🔗 Testing Audio Pipeline Integration');

    const jitterBuffer = new JitterBuffer({
      targetMs: 40,
      sampleRate: 16000,
      channels: 1,
      frameMs: 20
    });

    const energyMeter = new EnergyMeter({
      sampleRate: 16000,
      intervalMs: 250,
      speakingThresholdDb: -40,
      adaptiveMode: false
    });

    // Generate test audio
    const audioData = new Uint8Array(640);
    const dataView = new DataView(audioData.buffer);
    for (let i = 0; i < 320; i++) {
      dataView.setInt16(i * 2, Math.sin(i * 0.1) * 8000, true);
    }

    // Test complete pipeline
    this.runBenchmark('Full Audio Pipeline', () => {
      const seq = Math.floor(Math.random() * 10000);
      jitterBuffer.push(seq, Date.now(), audioData);
      const processedAudio = jitterBuffer.pop();

      if (processedAudio) {
        energyMeter.pushPcm16(processedAudio);
      }
    }, 5000);

    console.log('\n📊 Integration Test Results:');
    console.log(`   JitterBuffer packets processed: ${jitterBuffer.getStats().packetsReceived}`);
    console.log(`   JitterBuffer packets played: ${jitterBuffer.getStats().packetsPlayed}`);
  }

  testLatency() {
    console.log('\n⚡ Testing Latency Performance');

    const jitterBuffer = new JitterBuffer({
      targetMs: 40,
      sampleRate: 16000,
      channels: 1,
      frameMs: 20
    });

    const latencies = [];
    const audioData = new Uint8Array(640);

    // Measure JitterBuffer latency
    for (let i = 0; i < 1000; i++) {
      const startTime = process.hrtime.bigint();
      const seq = i + 1;
      jitterBuffer.push(seq, Date.now(), audioData);
      const result = jitterBuffer.pop();
      const endTime = process.hrtime.bigint();

      if (result) {
        const latencyMs = Number(endTime - startTime) / 1000000;
        latencies.push(latencyMs);
      }
    }

    latencies.sort((a, b) => a - b);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p50Latency = latencies[Math.floor(latencies.length * 0.5)];
    const p95Latency = latencies[Math.floor(latencies.length * 0.95)];
    const p99Latency = latencies[Math.floor(latencies.length * 0.99)];

    console.log(`   JitterBuffer Latency:`);
    console.log(`   - Average: ${avgLatency.toFixed(4)}ms`);
    console.log(`   - 50th percentile: ${p50Latency.toFixed(4)}ms`);
    console.log(`   - 95th percentile: ${p95Latency.toFixed(4)}ms`);
    console.log(`   - 99th percentile: ${p99Latency.toFixed(4)}ms`);

    // Performance assertions
    if (avgLatency > 1.0) {
      console.log(`   ⚠️  Warning: Average latency ${avgLatency.toFixed(4)}ms exceeds 1.0ms target`);
    } else {
      console.log(`   ✅ Average latency within target (< 1.0ms)`);
    }

    if (p95Latency > 5.0) {
      console.log(`   ⚠️  Warning: P95 latency ${p95Latency.toFixed(4)}ms exceeds 5.0ms target`);
    } else {
      console.log(`   ✅ P95 latency within target (< 5.0ms)`);
    }
  }

  runAllTests() {
    console.log('🚀 Starting Audio Processing Performance Tests');
    console.log('=' .repeat(60));

    try {
      this.testJitterBuffer();
      this.testEnergyMeter();
      this.testIntegration();
      this.testLatency();

      console.log('\n' + '=' .repeat(60));
      console.log('✅ All performance tests completed successfully!');
      console.log('\n📈 Summary of Results:');

      Object.entries(this.results).forEach(([name, result]) => {
        console.log(`   ${name}:`);
        console.log(`     - ${result.avgIterationTime.toFixed(4)}ms per operation`);
        console.log(`     - ${(result.iterations / result.totalTime * 1000).toFixed(0)} ops/sec`);
        console.log(`     - ${(result.memoryIncrease / 1024 / 1024).toFixed(2)} MB memory increase`);
      });

    } catch (error) {
      console.error('\n❌ Performance test failed:', error.message);
      process.exit(1);
    }
  }
}

// Run the tests
if (require.main === module) {
  const test = new PerformanceTest();
  test.runAllTests();
}

module.exports = { PerformanceTest };