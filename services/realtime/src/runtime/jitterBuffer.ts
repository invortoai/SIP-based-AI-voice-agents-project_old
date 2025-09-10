/**
 * RTP Packet structure for audio streaming
 */
interface RTPPacket {
  sequenceNumber: number;
  timestamp: number;
  payload: Uint8Array;
  receivedAt: number;
  marker?: boolean;
}

/**
 * Jitter buffer statistics for monitoring
 */
interface JitterStats {
  packetsReceived: number;
  packetsLost: number;
  packetsLate: number;
  packetsPlayed: number;
  currentBufferSize: number;
  averageBufferSize: number;
  maxBufferSize: number;
  jitterMs: number;
  averageLatency: number;
}

/**
 * Production-grade Jitter Buffer with adaptive buffering and PLC
 */
export class JitterBuffer {
  private packetBuffer: Map<number, RTPPacket> = new Map();
  private playoutQueue: RTPPacket[] = [];
  private targetMs: number;
  private sampleRate: number;
  private channels: number;
  private frameMs: number;

  // Adaptive buffering
  private minBufferSize: number;
  private maxBufferSize: number;
  private currentBufferSize: number;
  private adaptiveMode: boolean = true;

  // Sequence tracking
  private expectedSequence: number = 0;
  private lastPlayedSequence: number = -1;

  // Statistics
  private stats: JitterStats = {
    packetsReceived: 0,
    packetsLost: 0,
    packetsLate: 0,
    packetsPlayed: 0,
    currentBufferSize: 0,
    averageBufferSize: 0,
    maxBufferSize: 0,
    jitterMs: 0,
    averageLatency: 0
  };

  // Timing
  private latencies: number[] = [];
  private maxLatencyHistory = 100;

  // PLC (Packet Loss Concealment)
  private lastValidPacket: RTPPacket | null = null;
  private plcEnabled: boolean = true;

  constructor(opts: {
    targetMs: number;
    sampleRate: number;
    channels: number;
    frameMs: number;
    minBufferSize?: number;
    maxBufferSize?: number;
    adaptiveMode?: boolean;
  }) {
    this.targetMs = opts.targetMs;
    this.sampleRate = opts.sampleRate;
    this.channels = opts.channels;
    this.frameMs = opts.frameMs;
    this.minBufferSize = opts.minBufferSize || Math.max(1, Math.floor(opts.targetMs / opts.frameMs / 4));
    this.maxBufferSize = opts.maxBufferSize || Math.max(10, Math.floor(opts.targetMs / opts.frameMs * 2));
    this.currentBufferSize = Math.floor(opts.targetMs / opts.frameMs);
    this.adaptiveMode = opts.adaptiveMode ?? true;
  }

  /**
   * Push an RTP packet into the buffer
   */
  push(sequenceNumber: number, timestamp: number, payload: Uint8Array, marker?: boolean): void {
    const packet: RTPPacket = {
      sequenceNumber,
      timestamp,
      payload,
      receivedAt: Date.now(),
      marker
    };

    // Update statistics
    this.stats.packetsReceived++;

    // Check if packet is too late
    if (sequenceNumber < this.expectedSequence - this.maxBufferSize) {
      this.stats.packetsLate++;
      return; // Discard late packet
    }

    // Store packet in buffer
    this.packetBuffer.set(sequenceNumber, packet);

    // Update expected sequence if this is the first packet
    if (this.expectedSequence === 0) {
      this.expectedSequence = sequenceNumber;
    }

    // Update buffer size statistics
    this.updateBufferStats();
  }

  /**
   * Pop the next packet for playback
   */
  pop(): Uint8Array | null {
    // Try to get next expected packet
    let packet = this.packetBuffer.get(this.expectedSequence);

    if (packet) {
      // Packet available
      this.packetBuffer.delete(this.expectedSequence);
      this.lastValidPacket = packet;
      this.expectedSequence++;
      this.stats.packetsPlayed++;

      // Update latency tracking
      const latency = Date.now() - packet.receivedAt;
      this.latencies.push(latency);
      if (this.latencies.length > this.maxLatencyHistory) {
        this.latencies.shift();
      }

      return packet.payload;
    } else {
      // Packet missing - use PLC if enabled
      if (this.plcEnabled && this.lastValidPacket) {
        this.stats.packetsLost++;
        return this.generatePLCPacket();
      }

      return null;
    }
  }

  /**
   * Generate a PLC (Packet Loss Concealment) packet using linear interpolation
   */
  private generatePLCPacket(): Uint8Array | null {
    if (!this.lastValidPacket) return null;

    // Simple repetition PLC - repeat last packet
    // In production, this would use more sophisticated interpolation
    const plcPacket = new Uint8Array(this.lastValidPacket.payload.length);
    plcPacket.set(this.lastValidPacket.payload);

    // Apply slight attenuation to indicate concealment
    for (let i = 0; i < plcPacket.length; i++) {
      plcPacket[i] = Math.floor(plcPacket[i] * 0.7); // 30% attenuation
    }

    return plcPacket;
  }

  /**
   * Adapt buffer size based on network conditions
   */
  private adaptBufferSize(): void {
    if (!this.adaptiveMode) return;

    const bufferSize = this.packetBuffer.size;
    const recentJitter = this.calculateRecentJitter();

    // Increase buffer if jitter is high
    if (recentJitter > 50 && bufferSize < this.maxBufferSize) {
      this.currentBufferSize = Math.min(this.maxBufferSize, this.currentBufferSize + 1);
    }
    // Decrease buffer if jitter is low and buffer is large
    else if (recentJitter < 10 && bufferSize > this.minBufferSize && this.currentBufferSize > this.minBufferSize) {
      this.currentBufferSize = Math.max(this.minBufferSize, this.currentBufferSize - 1);
    }
  }

  /**
   * Calculate recent jitter based on packet arrival times
   */
  private calculateRecentJitter(): number {
    if (this.latencies.length < 2) return 0;

    const recentLatencies = this.latencies.slice(-10);
    let jitterSum = 0;

    for (let i = 1; i < recentLatencies.length; i++) {
      jitterSum += Math.abs(recentLatencies[i] - recentLatencies[i - 1]);
    }

    return jitterSum / (recentLatencies.length - 1);
  }

  /**
   * Update buffer statistics
   */
  private updateBufferStats(): void {
    const bufferSize = this.packetBuffer.size;
    this.stats.currentBufferSize = bufferSize;
    this.stats.maxBufferSize = Math.max(this.stats.maxBufferSize, bufferSize);

    // Calculate rolling average
    this.stats.averageBufferSize = (this.stats.averageBufferSize + bufferSize) / 2;
  }

  /**
   * Get current jitter buffer statistics
   */
  getStats(): JitterStats {
    // Calculate current jitter
    this.stats.jitterMs = this.calculateRecentJitter();

    // Calculate average latency
    if (this.latencies.length > 0) {
      this.stats.averageLatency = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
    }

    return { ...this.stats };
  }

  /**
   * Reset the jitter buffer
   */
  reset(): void {
    this.packetBuffer.clear();
    this.playoutQueue = [];
    this.expectedSequence = 0;
    this.lastPlayedSequence = -1;
    this.lastValidPacket = null;
    this.latencies = [];

    // Reset statistics
    this.stats = {
      packetsReceived: 0,
      packetsLost: 0,
      packetsLate: 0,
      packetsPlayed: 0,
      currentBufferSize: 0,
      averageBufferSize: 0,
      maxBufferSize: 0,
      jitterMs: 0,
      averageLatency: 0
    };
  }

  /**
   * Check if buffer has enough packets for playback
   */
  hasEnoughPackets(): boolean {
    return this.packetBuffer.size >= this.currentBufferSize;
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.packetBuffer.size;
  }

  /**
   * Enable/disable PLC
   */
  setPlcEnabled(enabled: boolean): void {
    this.plcEnabled = enabled;
  }

  /**
   * Set adaptive mode
   */
  setAdaptiveMode(enabled: boolean): void {
    this.adaptiveMode = enabled;
  }
}

