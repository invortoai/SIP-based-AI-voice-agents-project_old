import { EventEmitter } from 'events';

/**
 * Audio Analyzer for emotion detection and energy metering
 * Calculates RMS, dBFS, VAD, and emotion indicators from audio
 */

export interface AudioMetrics {
  rms: number;
  dBFS: number;
  energy: number;
  isSpeaking: boolean;
  silenceDuration: number;
  voiceActivity: number;
}

export interface EmotionState {
  class: 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised';
  arousal: number; // -1 to 1 (calm to excited)
  valence: number; // -1 to 1 (negative to positive)
  confidence: number; // 0 to 1
}

export interface EmotionWindow {
  energy_db: number;
  speaking: boolean;
  pitch: number;
  pitchVariance: number;
  speechRate: number;
  timestamp: number;
}

export class AudioAnalyzer extends EventEmitter {
  private sampleRate: number;
  private windowSize: number;
  private windowBuffer: Float32Array;
  private windowIndex: number = 0;
  private silenceThreshold: number;
  private speechThreshold: number;
  private isSpeaking: boolean = false;
  private silenceStartTime: number = 0;
  private lastSpeechTime: number = 0;
  private energyHistory: number[] = [];
  private pitchHistory: number[] = [];
  private emotionBuffer: EmotionWindow[] = [];
  private emotionWindowSize: number = 50; // 50 windows for emotion analysis

  constructor(options: {
    sampleRate?: number;
    windowSize?: number;
    silenceThreshold?: number;
    speechThreshold?: number;
  } = {}) {
    super();
    this.sampleRate = options.sampleRate || 16000;
    this.windowSize = options.windowSize || 512;
    this.silenceThreshold = options.silenceThreshold || -40; // dBFS
    this.speechThreshold = options.speechThreshold || -35; // dBFS
    this.windowBuffer = new Float32Array(this.windowSize);
  }

  /**
   * Analyze PCM16 audio chunk
   */
  analyzeChunk(pcm16: Uint8Array): AudioMetrics {
    // Convert PCM16 to Float32
    const float32 = this.pcm16ToFloat32(pcm16);
    
    // Calculate RMS (Root Mean Square)
    const rms = this.calculateRMS(float32);
    
    // Convert RMS to dBFS (Decibels relative to Full Scale)
    const dBFS = this.rmsTodBFS(rms);
    
    // Calculate energy
    const energy = this.calculateEnergy(float32);
    
    // Voice Activity Detection
    const voiceActivity = this.detectVoiceActivity(float32);
    
    // Update speaking state
    const wasSpeaking = this.isSpeaking;
    this.isSpeaking = dBFS > this.speechThreshold && voiceActivity > 0.3;
    
    // Track silence duration
    let silenceDuration = 0;
    if (!this.isSpeaking) {
      if (wasSpeaking) {
        this.silenceStartTime = Date.now();
      }
      silenceDuration = Date.now() - this.silenceStartTime;
    } else {
      this.lastSpeechTime = Date.now();
      this.silenceStartTime = 0;
    }
    
    // Update history
    this.energyHistory.push(energy);
    if (this.energyHistory.length > 100) {
      this.energyHistory.shift();
    }
    
    // Calculate pitch
    const pitch = this.estimatePitch(float32);
    if (pitch > 0) {
      this.pitchHistory.push(pitch);
      if (this.pitchHistory.length > 100) {
        this.pitchHistory.shift();
      }
    }
    
    // Create emotion window
    const emotionWindow: EmotionWindow = {
      energy_db: dBFS,
      speaking: this.isSpeaking,
      pitch: pitch,
      pitchVariance: this.calculateVariance(this.pitchHistory),
      speechRate: this.estimateSpeechRate(),
      timestamp: Date.now(),
    };
    
    // Add to emotion buffer
    this.emotionBuffer.push(emotionWindow);
    if (this.emotionBuffer.length > this.emotionWindowSize) {
      this.emotionBuffer.shift();
    }
    
    // Emit emotion window event
    this.emit('emotion.window', emotionWindow);
    
    // Analyze emotion if enough data
    if (this.emotionBuffer.length >= 10) {
      const emotionState = this.analyzeEmotion();
      this.emit('emotion.state', emotionState);
    }
    
    const metrics: AudioMetrics = {
      rms,
      dBFS,
      energy,
      isSpeaking: this.isSpeaking,
      silenceDuration,
      voiceActivity,
    };
    
    // Emit metrics
    this.emit('metrics', metrics);
    
    return metrics;
  }

  /**
   * Convert PCM16 to Float32 (-1 to 1)
   */
  private pcm16ToFloat32(pcm16: Uint8Array): Float32Array {
    const float32 = new Float32Array(pcm16.length / 2);
    const dataView = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    
    for (let i = 0; i < float32.length; i++) {
      const sample = dataView.getInt16(i * 2, true); // Little-endian
      float32[i] = sample / 32768.0; // Normalize to -1 to 1
    }
    
    return float32;
  }

  /**
   * Calculate Root Mean Square
   */
  private calculateRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Convert RMS to dBFS (Decibels relative to Full Scale)
   */
  private rmsTodBFS(rms: number): number {
    if (rms === 0) return -Infinity;
    
    // Convert to dBFS (20 * log10(rms))
    // Since our samples are normalized to -1 to 1, full scale is 1
    const dBFS = 20 * Math.log10(rms);
    
    // Clamp to reasonable range
    return Math.max(-96, Math.min(0, dBFS));
  }

  /**
   * Calculate energy of the signal
   */
  private calculateEnergy(samples: Float32Array): number {
    let energy = 0;
    for (let i = 0; i < samples.length; i++) {
      energy += Math.abs(samples[i]);
    }
    return energy / samples.length;
  }

  /**
   * Voice Activity Detection using Zero Crossing Rate and Energy
   */
  private detectVoiceActivity(samples: Float32Array): number {
    // Calculate Zero Crossing Rate
    let zeroCrossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    const zcr = zeroCrossings / samples.length;
    
    // Calculate short-term energy
    const energy = this.calculateEnergy(samples);
    
    // Combine ZCR and energy for VAD
    // High energy and moderate ZCR indicates speech
    const vadScore = energy * (1 - Math.abs(zcr - 0.1));
    
    return Math.min(1, Math.max(0, vadScore * 10));
  }

  /**
   * Estimate pitch using autocorrelation
   */
  private estimatePitch(samples: Float32Array): number {
    const minPeriod = Math.floor(this.sampleRate / 400); // 400 Hz max
    const maxPeriod = Math.floor(this.sampleRate / 50);  // 50 Hz min
    
    // Autocorrelation
    let maxCorr = 0;
    let bestPeriod = 0;
    
    for (let period = minPeriod; period < maxPeriod && period < samples.length; period++) {
      let corr = 0;
      for (let i = 0; i < samples.length - period; i++) {
        corr += samples[i] * samples[i + period];
      }
      
      if (corr > maxCorr) {
        maxCorr = corr;
        bestPeriod = period;
      }
    }
    
    if (bestPeriod === 0 || maxCorr < 0.3) {
      return 0; // No clear pitch detected
    }
    
    return this.sampleRate / bestPeriod;
  }

  /**
   * Calculate variance of array
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(x => Math.pow(x - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  /**
   * Estimate speech rate based on energy patterns
   */
  private estimateSpeechRate(): number {
    // Count energy peaks (syllables)
    let peaks = 0;
    const threshold = this.calculateMean(this.energyHistory) * 1.2;
    
    for (let i = 1; i < this.energyHistory.length - 1; i++) {
      if (this.energyHistory[i] > threshold &&
          this.energyHistory[i] > this.energyHistory[i - 1] &&
          this.energyHistory[i] > this.energyHistory[i + 1]) {
        peaks++;
      }
    }
    
    // Convert to syllables per second
    const timeWindow = this.energyHistory.length * this.windowSize / this.sampleRate;
    return peaks / timeWindow;
  }

  /**
   * Calculate mean of array
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Analyze emotion based on audio features
   */
  private analyzeEmotion(): EmotionState {
    // Extract features from emotion buffer
    const avgEnergy = this.calculateMean(this.emotionBuffer.map(w => w.energy_db));
    const avgPitch = this.calculateMean(this.emotionBuffer.filter(w => w.pitch > 0).map(w => w.pitch));
    const pitchVariance = this.calculateMean(this.emotionBuffer.map(w => w.pitchVariance));
    const speechRate = this.calculateMean(this.emotionBuffer.map(w => w.speechRate));
    const speakingRatio = this.emotionBuffer.filter(w => w.speaking).length / this.emotionBuffer.length;
    
    // Simple emotion classification based on audio features
    let emotionClass: EmotionState['class'] = 'neutral';
    let arousal = 0;
    let valence = 0;
    let confidence = 0.5;
    
    // High energy + high pitch variance = excited/happy or angry
    if (avgEnergy > -30 && pitchVariance > 50) {
      arousal = 0.7;
      if (speechRate > 4) {
        // Fast speech = likely angry
        emotionClass = 'angry';
        valence = -0.5;
      } else {
        // Normal/slow speech = likely happy
        emotionClass = 'happy';
        valence = 0.6;
      }
      confidence = 0.7;
    }
    // Low energy + low pitch = sad or calm
    else if (avgEnergy < -40 && avgPitch < 150) {
      arousal = -0.5;
      if (speechRate < 2) {
        emotionClass = 'sad';
        valence = -0.6;
      } else {
        emotionClass = 'neutral';
        valence = 0;
      }
      confidence = 0.6;
    }
    // High pitch + high speech rate = fearful or surprised
    else if (avgPitch > 250 && speechRate > 4) {
      arousal = 0.8;
      if (pitchVariance > 70) {
        emotionClass = 'fearful';
        valence = -0.7;
      } else {
        emotionClass = 'surprised';
        valence = 0.1;
      }
      confidence = 0.65;
    }
    // Default to neutral
    else {
      emotionClass = 'neutral';
      arousal = avgEnergy > -35 ? 0.2 : -0.2;
      valence = 0;
      confidence = 0.8;
    }
    
    // Normalize arousal and valence to -1 to 1
    arousal = Math.max(-1, Math.min(1, arousal));
    valence = Math.max(-1, Math.min(1, valence));
    
    return {
      class: emotionClass,
      arousal,
      valence,
      confidence,
    };
  }

  /**
   * Reset analyzer state
   */
  reset(): void {
    this.windowIndex = 0;
    this.isSpeaking = false;
    this.silenceStartTime = 0;
    this.lastSpeechTime = 0;
    this.energyHistory = [];
    this.pitchHistory = [];
    this.emotionBuffer = [];
    this.windowBuffer.fill(0);
  }

  /**
   * Get current speaking state
   */
  getSpeakingState(): boolean {
    return this.isSpeaking;
  }

  /**
   * Get time since last speech
   */
  getTimeSinceLastSpeech(): number {
    if (this.isSpeaking) return 0;
    return Date.now() - this.lastSpeechTime;
  }

  /**
   * Get average energy over recent history
   */
  getAverageEnergy(): number {
    return this.calculateMean(this.energyHistory);
  }

  /**
   * Get average pitch over recent history
   */
  getAveragePitch(): number {
    return this.calculateMean(this.pitchHistory);
  }
}

/**
 * Create a simplified energy meter for basic use
 */
export function createEnergyMeter(sampleRate: number = 16000): (pcm16: Uint8Array) => number {
  const analyzer = new AudioAnalyzer({ sampleRate });
  
  return (pcm16: Uint8Array): number => {
    const metrics = analyzer.analyzeChunk(pcm16);
    return metrics.dBFS;
  };
}

/**
 * Create emotion detector
 */
export function createEmotionDetector(
  onEmotion: (state: EmotionState) => void,
  onWindow?: (window: EmotionWindow) => void
): AudioAnalyzer {
  const analyzer = new AudioAnalyzer();
  
  analyzer.on('emotion.state', onEmotion);
  if (onWindow) {
    analyzer.on('emotion.window', onWindow);
  }
  
  return analyzer;
}