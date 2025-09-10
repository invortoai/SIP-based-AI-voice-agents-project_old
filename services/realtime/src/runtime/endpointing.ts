import { EventEmitter } from 'events';

export interface EndpointingConfig {
  provider: 'invorto' | 'livekit' | 'off';
  silenceMs?: number;
  minWords?: number;
  confidenceThreshold?: number;
  waitFunction?: string;
  adaptiveThreshold?: boolean;
}

export interface EndpointingResult {
  shouldEnd: boolean;
  confidence: number;
  reason: string;
  metadata?: Record<string, any>;
}

export class AdvancedEndpointing extends EventEmitter {
  private config: EndpointingConfig;
  private audioBuffer: number[] = [];
  private silenceCounter = 0;
  private wordCounter = 0;
  private lastActivityTime = Date.now();
  private isActive = false;

  constructor(config: EndpointingConfig) {
    super();
    this.config = {
      silenceMs: 1500,
      minWords: 3,
      confidenceThreshold: 0.7,
      waitFunction: 'linear',
      adaptiveThreshold: true,
      ...config
    };
  }

  /**
   * Process audio chunk for endpointing analysis
   */
  processAudioChunk(audioData: Float32Array, transcription?: string): EndpointingResult {
    const now = Date.now();

    // Update audio buffer for silence detection
    this.updateAudioBuffer(audioData);

    // Check for silence
    const isSilent = this.detectSilence(audioData);

    if (isSilent) {
      this.silenceCounter += audioData.length / 16000 * 1000; // Convert to ms
    } else {
      this.silenceCounter = 0;
      this.lastActivityTime = now;
      this.wordCounter += this.countWords(transcription);
    }

    // Apply different endpointing strategies based on provider
    switch (this.config.provider) {
      case 'invorto':
        return this.invortoEndpointing(transcription);
      case 'livekit':
        return this.livekitEndpointing(audioData, transcription);
      case 'off':
        return { shouldEnd: false, confidence: 0, reason: 'endpointing_disabled' };
      default:
        return this.invortoEndpointing(transcription);
    }
  }

  /**
   * Invorto's advanced endpointing algorithm
   */
  private invortoEndpointing(transcription?: string): EndpointingResult {
    const timeSinceActivity = Date.now() - this.lastActivityTime;
    const silenceThreshold = this.config.silenceMs || 1500;

    // Adaptive silence threshold based on conversation context
    const adaptiveThreshold = this.config.adaptiveThreshold
      ? this.calculateAdaptiveThreshold()
      : silenceThreshold;

    // Check silence-based endpointing
    if (this.silenceCounter > adaptiveThreshold) {
      return {
        shouldEnd: true,
        confidence: Math.min(0.9, this.silenceCounter / (adaptiveThreshold * 2)),
        reason: 'silence_timeout',
        metadata: {
          silenceDuration: this.silenceCounter,
          threshold: adaptiveThreshold,
          wordsSpoken: this.wordCounter
        }
      };
    }

    // Check word-based endpointing
    if (transcription && this.wordCounter >= (this.config.minWords || 3)) {
      const sentenceEnders = ['.', '!', '?', '\n'];
      const endsWithSentence = sentenceEnders.some(ender => transcription.trim().endsWith(ender));

      if (endsWithSentence) {
        return {
          shouldEnd: true,
          confidence: 0.85,
          reason: 'sentence_complete',
          metadata: {
            wordsSpoken: this.wordCounter,
            endsWithSentence: true
          }
        };
      }

      // Check for question patterns
      if (this.isQuestion(transcription)) {
        return {
          shouldEnd: true,
          confidence: 0.8,
          reason: 'question_detected',
          metadata: {
            wordsSpoken: this.wordCounter,
            questionPattern: true
          }
        };
      }
    }

    // Check for long pause after incomplete sentence
    if (timeSinceActivity > silenceThreshold * 0.7 && this.wordCounter > 0) {
      return {
        shouldEnd: true,
        confidence: 0.6,
        reason: 'incomplete_sentence_pause',
        metadata: {
          timeSinceActivity,
          wordsSpoken: this.wordCounter
        }
      };
    }

    return {
      shouldEnd: false,
      confidence: 0,
      reason: 'continue_listening'
    };
  }

  /**
   * LiveKit-style endpointing (more conservative)
   */
  private livekitEndpointing(audioData: Float32Array, transcription?: string): EndpointingResult {
    const silenceThreshold = this.config.silenceMs || 2000; // More conservative

    // LiveKit uses energy-based detection with longer silence windows
    if (this.silenceCounter > silenceThreshold) {
      return {
        shouldEnd: true,
        confidence: 0.75,
        reason: 'livekit_silence',
        metadata: {
          silenceDuration: this.silenceCounter,
          energyLevel: this.calculateEnergyLevel(audioData)
        }
      };
    }

    // LiveKit prioritizes transcription-based endpointing
    if (transcription && transcription.length > 10) {
      const confidence = this.estimateTranscriptionConfidence(transcription);
      if (confidence > (this.config.confidenceThreshold || 0.8)) {
        return {
          shouldEnd: true,
          confidence,
          reason: 'livekit_transcription_confidence',
          metadata: { transcriptionLength: transcription.length }
        };
      }
    }

    return {
      shouldEnd: false,
      confidence: 0,
      reason: 'livekit_continue'
    };
  }

  /**
   * Helper methods
   */
  private updateAudioBuffer(audioData: Float32Array): void {
    // Keep only recent audio for analysis (last 5 seconds at 16kHz)
    const maxBufferSize = 5 * 16000;
    this.audioBuffer.push(...Array.from(audioData));

    if (this.audioBuffer.length > maxBufferSize) {
      this.audioBuffer = this.audioBuffer.slice(-maxBufferSize);
    }
  }

  private detectSilence(audioData: Float32Array): boolean {
    const energyThreshold = 0.01; // Very low energy threshold
    let totalEnergy = 0;

    for (let i = 0; i < audioData.length; i++) {
      totalEnergy += audioData[i] * audioData[i];
    }

    const averageEnergy = totalEnergy / audioData.length;
    return averageEnergy < energyThreshold;
  }

  private calculateEnergyLevel(audioData: Float32Array): number {
    let totalEnergy = 0;
    for (let i = 0; i < audioData.length; i++) {
      totalEnergy += audioData[i] * audioData[i];
    }
    return totalEnergy / audioData.length;
  }

  private countWords(text?: string): number {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  private isQuestion(text: string): boolean {
    const questionWords = ['what', 'when', 'where', 'why', 'how', 'who', 'which', 'whose', 'whom'];
    const lowerText = text.toLowerCase();

    // Check for question words
    const hasQuestionWord = questionWords.some(word => lowerText.includes(word));

    // Check for question mark
    const hasQuestionMark = lowerText.includes('?');

    return hasQuestionWord || hasQuestionMark;
  }

  private calculateAdaptiveThreshold(): number {
    const baseThreshold = this.config.silenceMs || 1500;

    // Increase threshold for longer conversations
    const conversationLengthBonus = Math.min(this.wordCounter * 50, 1000);

    // Decrease threshold if user speaks quickly
    const speakingRate = this.wordCounter / Math.max((Date.now() - this.lastActivityTime) / 1000, 1);
    const fastSpeakingBonus = speakingRate > 2 ? -300 : 0;

    return baseThreshold + conversationLengthBonus + fastSpeakingBonus;
  }

  private estimateTranscriptionConfidence(text: string): number {
    // Simple confidence estimation based on text characteristics
    if (!text || text.length < 3) return 0;

    let confidence = 0.5; // Base confidence

    // Longer text is generally more confident
    confidence += Math.min(text.length / 100, 0.3);

    // Proper sentence structure increases confidence
    if (text.includes('.') || text.includes('!') || text.includes('?')) {
      confidence += 0.1;
    }

    // Capital letters at start suggest proper sentences
    if (/^[A-Z]/.test(text.trim())) {
      confidence += 0.1;
    }

    return Math.min(confidence, 0.95);
  }

  /**
   * Reset endpointing state
   */
  reset(): void {
    this.audioBuffer = [];
    this.silenceCounter = 0;
    this.wordCounter = 0;
    this.lastActivityTime = Date.now();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<EndpointingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isActive: this.isActive,
      silenceCounter: this.silenceCounter,
      wordCounter: this.wordCounter,
      timeSinceActivity: Date.now() - this.lastActivityTime,
      config: this.config
    };
  }
}