import Redis from "ioredis";

export class TimelinePublisher {
  private redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url);
  }

  async publish(callId: string, kind: string, payload: unknown) {
    const stream = `events:${callId}`;
    await this.redis.xadd(stream, "*", "kind", kind, "payload", JSON.stringify(payload));
  }
}

