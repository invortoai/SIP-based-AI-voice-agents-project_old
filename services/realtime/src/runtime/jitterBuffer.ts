export class JitterBuffer {
  private queue: Uint8Array[] = [];
  private targetMs: number;
  private sampleRate: number;
  private channels: number;
  private frameMs: number;

  constructor(opts: { targetMs: number; sampleRate: number; channels: number; frameMs: number }) {
    this.targetMs = opts.targetMs;
    this.sampleRate = opts.sampleRate;
    this.channels = opts.channels;
    this.frameMs = opts.frameMs;
  }

  push(chunk: Uint8Array) {
    this.queue.push(chunk);
  }

  pop(): Uint8Array | null {
    const framesNeeded = Math.ceil((this.targetMs / this.frameMs));
    if (this.queue.length < framesNeeded) return null;
    return this.queue.shift() || null;
  }
}

