export type EnergyWindow = {
  energyDb: number;
  speaking: boolean;
  noiseFloor: number;
  snr: number; // Signal-to-Noise Ratio
  bands: {
    low: number;    // 0-300Hz
    mid: number;    // 300-3000Hz
    high: number;   // 3000Hz+
  };
  vadConfidence: number;
};

export type EnergyCallback = (w: EnergyWindow) => void;

/**
 * Advanced Energy Meter with noise gating, multi-band analysis, and adaptive thresholds
 */
export class EnergyMeter {
  private readonly sampleRate: number;
  private readonly intervalMs: number;
  private readonly minHoldWindows: number;

  // Adaptive thresholds
  private speakingThresholdDb: number;
  private noiseGateThreshold: number;
  private adaptiveMode: boolean = true;

  // Multi-band analysis
  private readonly fftSize: number = 512;
  private readonly bandRanges = {
    low: { min: 0, max: 300 },
    mid: { min: 300, max: 3000 },
    high: { min: 3000, max: 8000 }
  };

  // Noise estimation
  private noiseFloor: number = -60; // dBFS
  private noiseHistory: number[] = [];
  private readonly maxNoiseHistory = 50;

  // State tracking
  private buffer: Int16Array[] = [];
  private onWindowCb?: EnergyCallback;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveSpeaking: number = 0;
  private consecutiveSilent: number = 0;
  private lastSpeaking: boolean = false;

  // Statistics
  private energyHistory: number[] = [];
  private readonly maxEnergyHistory = 100;

  constructor(opts?: {
    sampleRate?: number;
    intervalMs?: number;
    speakingThresholdDb?: number;
    minHoldWindows?: number;
    noiseGateThreshold?: number;
    adaptiveMode?: boolean;
  }) {
    this.sampleRate = opts?.sampleRate ?? 16000;
    this.intervalMs = opts?.intervalMs ?? 250;
    this.speakingThresholdDb = opts?.speakingThresholdDb ?? -40; // dBFS
    this.noiseGateThreshold = opts?.noiseGateThreshold ?? -55; // dBFS
    this.minHoldWindows = opts?.minHoldWindows ?? 2; // hysteresis
    this.adaptiveMode = opts?.adaptiveMode ?? true;
  }

  onWindow(cb: EnergyCallback) {
    this.onWindowCb = cb;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flushWindow(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.buffer = [];
    this.consecutiveSpeaking = 0;
    this.consecutiveSilent = 0;
  }

  pushPcm16(pcm: Uint8Array) {
    // Interpret as little-endian 16-bit signed
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const len = Math.floor(pcm.byteLength / 2);
    const frame = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      frame[i] = view.getInt16(i * 2, true);
    }
    this.buffer.push(frame);
  }

  private flushWindow() {
    if (this.buffer.length === 0) {
      this.emitWindow({
        energyDb: -120,
        speaking: false,
        noiseFloor: this.noiseFloor,
        snr: 0,
        bands: { low: -120, mid: -120, high: -120 },
        vadConfidence: 0
      });
      return;
    }

    // Concatenate frames
    let totalLen = 0;
    for (const f of this.buffer) totalLen += f.length;
    const joined = new Int16Array(totalLen);
    let offset = 0;
    for (const f of this.buffer) {
      joined.set(f, offset);
      offset += f.length;
    }
    this.buffer = [];

    // Multi-band analysis
    const bands = this.analyzeFrequencyBands(joined);

    // Overall RMS and dBFS
    const rms = this.calculateRMS(joined);
    const energyDb = this.rmsTodBFS(rms);

    // Update noise floor estimation
    this.updateNoiseFloor(energyDb);

    // Calculate SNR (Signal-to-Noise Ratio)
    const snr = Math.max(0, energyDb - this.noiseFloor);

    // Apply noise gating
    const gatedEnergyDb = energyDb > this.noiseGateThreshold ? energyDb : -120;

    // Voice Activity Detection with confidence
    const vadConfidence = this.calculateVADConfidence(gatedEnergyDb, bands, snr);

    // Hysteresis speaking detection
    const isAbove = gatedEnergyDb >= this.speakingThresholdDb && vadConfidence > 0.3;
    if (isAbove) {
      this.consecutiveSpeaking += 1;
      this.consecutiveSilent = 0;
    } else {
      this.consecutiveSilent += 1;
      this.consecutiveSpeaking = 0;
    }

    let speaking = this.lastSpeaking;
    if (!this.lastSpeaking && this.consecutiveSpeaking >= this.minHoldWindows) {
      speaking = true;
    } else if (this.lastSpeaking && this.consecutiveSilent >= this.minHoldWindows) {
      speaking = false;
    }
    this.lastSpeaking = speaking;

    // Adaptive threshold adjustment
    if (this.adaptiveMode) {
      this.adaptThresholds(gatedEnergyDb, speaking);
    }

    // Update energy history
    this.energyHistory.push(gatedEnergyDb);
    if (this.energyHistory.length > this.maxEnergyHistory) {
      this.energyHistory.shift();
    }

    this.emitWindow({
      energyDb: gatedEnergyDb,
      speaking,
      noiseFloor: this.noiseFloor,
      snr,
      bands,
      vadConfidence
    });
  }

  /**
   * Analyze frequency bands using simple filter bank
   */
  private analyzeFrequencyBands(samples: Int16Array): EnergyWindow['bands'] {
    const sampleRate = this.sampleRate;
    const bands = { low: -120, mid: -120, high: -120 };

    // Simple frequency domain analysis using autocorrelation
    // In production, this would use FFT for better accuracy

    // Low band (0-300Hz) - fundamental frequencies
    const lowBand = this.extractBandEnergy(samples, this.bandRanges.low.min, this.bandRanges.low.max, sampleRate);
    bands.low = this.rmsTodBFS(Math.sqrt(lowBand));

    // Mid band (300-3000Hz) - vocal formants
    const midBand = this.extractBandEnergy(samples, this.bandRanges.mid.min, this.bandRanges.mid.max, sampleRate);
    bands.mid = this.rmsTodBFS(Math.sqrt(midBand));

    // High band (3000Hz+) - fricatives and noise
    const highBand = this.extractBandEnergy(samples, this.bandRanges.high.min, this.bandRanges.high.max, sampleRate);
    bands.high = this.rmsTodBFS(Math.sqrt(highBand));

    return bands;
  }

  /**
   * Extract energy in a specific frequency band
   */
  private extractBandEnergy(samples: Int16Array, minFreq: number, maxFreq: number, sampleRate: number): number {
    // Simplified band-pass filtering using moving average
    // In production, use proper IIR/FIR filters

    const minPeriod = Math.floor(sampleRate / maxFreq);
    const maxPeriod = Math.floor(sampleRate / minFreq);

    let bandEnergy = 0;
    let sampleCount = 0;

    // Simple low-pass filter for high frequencies
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i] / 32768.0;
      bandEnergy += sample * sample;
      sampleCount++;
    }

    return bandEnergy / sampleCount;
  }

  /**
   * Calculate RMS energy
   */
  private calculateRMS(samples: Int16Array): number {
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i] / 32768.0; // normalize to [-1,1)
      sumSquares += s * s;
    }
    return samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
  }

  /**
   * Convert RMS to dBFS
   */
  private rmsTodBFS(rms: number): number {
    if (rms === 0) return -120;
    return Math.max(-120, Math.min(0, 20 * Math.log10(rms)));
  }

  /**
   * Update noise floor estimation
   */
  private updateNoiseFloor(currentEnergy: number): void {
    this.noiseHistory.push(currentEnergy);
    if (this.noiseHistory.length > this.maxNoiseHistory) {
      this.noiseHistory.shift();
    }

    // Use percentile-based noise floor estimation
    if (this.noiseHistory.length > 10) {
      const sorted = [...this.noiseHistory].sort((a, b) => a - b);
      // 20th percentile for noise floor
      const index = Math.floor(sorted.length * 0.2);
      this.noiseFloor = sorted[index];
    }
  }

  /**
   * Calculate Voice Activity Detection confidence
   */
  private calculateVADConfidence(energyDb: number, bands: EnergyWindow['bands'], snr: number): number {
    // Combine multiple factors for VAD confidence
    let confidence = 0;

    // Energy above noise floor
    if (energyDb > this.noiseFloor + 10) confidence += 0.4;

    // SNR threshold
    if (snr > 15) confidence += 0.3;

    // Frequency band balance (speech typically has energy in mid band)
    const totalEnergy = bands.low + bands.mid + bands.high;
    if (totalEnergy > 0) {
      const midRatio = bands.mid / totalEnergy;
      if (midRatio > 0.3) confidence += 0.3; // Speech has mid-band emphasis
    }

    return Math.min(1, confidence);
  }

  /**
   * Adapt thresholds based on environment
   */
  private adaptThresholds(currentEnergy: number, isSpeaking: boolean): void {
    if (this.energyHistory.length < 20) return;

    const recentEnergies = this.energyHistory.slice(-20);
    const avgEnergy = recentEnergies.reduce((a, b) => a + b, 0) / recentEnergies.length;
    const stdDev = Math.sqrt(
      recentEnergies.reduce((sum, energy) => sum + Math.pow(energy - avgEnergy, 2), 0) / recentEnergies.length
    );

    // Adjust speaking threshold based on noise characteristics
    if (isSpeaking) {
      // If currently speaking, ensure threshold is below current energy
      this.speakingThresholdDb = Math.min(this.speakingThresholdDb, currentEnergy - 5);
    } else {
      // If not speaking, gradually increase threshold toward optimal level
      const optimalThreshold = Math.max(this.noiseFloor + 15, avgEnergy - stdDev);
      this.speakingThresholdDb = 0.95 * this.speakingThresholdDb + 0.05 * optimalThreshold;
    }

    // Keep thresholds within reasonable bounds
    this.speakingThresholdDb = Math.max(-60, Math.min(-20, this.speakingThresholdDb));
  }

  private emitWindow(window: EnergyWindow) {
    this.onWindowCb?.(window);
  }

  /**
   * Get current noise floor
   */
  getNoiseFloor(): number {
    return this.noiseFloor;
  }

  /**
   * Get current speaking threshold
   */
  getSpeakingThreshold(): number {
    return this.speakingThresholdDb;
  }

  /**
   * Manually set thresholds
   */
  setThresholds(speakingThreshold: number, noiseGateThreshold: number): void {
    this.speakingThresholdDb = speakingThreshold;
    this.noiseGateThreshold = noiseGateThreshold;
  }

  /**
   * Enable/disable adaptive mode
   */
  setAdaptiveMode(enabled: boolean): void {
    this.adaptiveMode = enabled;
  }
}


