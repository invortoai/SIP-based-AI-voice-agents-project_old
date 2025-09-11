import Redis from "ioredis";

export class TimelinePublisher {
  private redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url);
  }

  async publish(callId: string, kind: string, payload: unknown) {
    const stream = `events:${callId}`;
    await this.redis.xadd(stream, "*", "kind", kind, "payload", JSON.stringify(payload), "timestamp", Date.now().toString());
  }

  async getEvents(callId: string, count: number = 100): Promise<Array<{ id: string; kind: string; payload: any; timestamp: number }>> {
    const stream = `events:${callId}`;
    const events = await this.redis.xrange(stream, "-", "+", "COUNT", count);

    return events.map(([id, fields]) => {
      const event: any = { id };
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        const value = fields[i + 1];

        if (key === 'payload') {
          event.payload = JSON.parse(value);
        } else if (key === 'timestamp') {
          event.timestamp = parseInt(value);
        } else {
          event[key] = value;
        }
      }
      return event;
    });
  }

  async close(): Promise<void> {
    try { await (this.redis as any)?.quit?.(); } catch {}
    try { (this.redis as any)?.disconnect?.(); } catch {}
  }
}

