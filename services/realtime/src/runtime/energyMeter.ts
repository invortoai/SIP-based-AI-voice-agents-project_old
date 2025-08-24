export type EnergyWindow = {
  energyDb: number;
  speaking: boolean;
};

export type EnergyCallback = (w: EnergyWindow) => void;

/**
 * Computes RMS energy (dBFS) over sliding windows from PCM16 mono audio.
 */
export class EnergyMeter {
  private readonly sampleRate: number;
  private readonly intervalMs: number;
  private readonly speakingThresholdDb: number;
  private readonly minHoldWindows: number;

  private buffer: Int16Array[] = [];
  private onWindowCb?: EnergyCallback;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveSpeaking: number = 0;
  private consecutiveSilent: number = 0;
  private lastSpeaking: boolean = false;

  constructor(opts?: {
    sampleRate?: number;
    intervalMs?: number;
    speakingThresholdDb?: number;
    minHoldWindows?: number;
  }) {
    this.sampleRate = opts?.sampleRate ?? 16000;
    this.intervalMs = opts?.intervalMs ?? 250;
    this.speakingThresholdDb = opts?.speakingThresholdDb ?? -50; // dBFS
    this.minHoldWindows = opts?.minHoldWindows ?? 2; // hysteresis
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
      this.emitWindow(-120, false);
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

    // RMS
    let sumSquares = 0;
    for (let i = 0; i < joined.length; i++) {
      const s = joined[i] / 32768; // normalize to [-1,1)
      sumSquares += s * s;
    }
    const rms = joined.length > 0 ? Math.sqrt(sumSquares / joined.length) : 0;
    // dBFS: 20*log10(rms)
    const db = rms > 0 ? 20 * Math.log10(rms) : -120;

    // Hysteresis speaking detection
    const isAbove = db >= this.speakingThresholdDb;
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

    this.emitWindow(db, speaking);
  }

  private emitWindow(energyDb: number, speaking: boolean) {
    this.onWindowCb?.({ energyDb, speaking });
  }
}


