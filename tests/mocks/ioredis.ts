// In-memory Redis mock tailored for our tests (avoids ioredis-mock ESM/CJS issues)
type KV = Map<string, string>;
type SetStore = Map<string, Set<string>>;
type HashStore = Map<string, KV>;
type ListStore = Map<string, string[]>;
type StreamEntry = [string, string[]]; // [id, [field1, value1, field2, value2, ...]]
type StreamStore = Map<string, StreamEntry[]>;

let globalStreamSeq = 0;

export default class InMemoryRedis {
  private sets: SetStore = new Map();
  private hashes: HashStore = new Map();
  private lists: ListStore = new Map();
  private kv: KV = new Map();
  private streams: StreamStore = new Map();

  constructor(_url?: string) {}

  // --- Set operations ---
  private ensureSet(key: string): Set<string> {
    let s = this.sets.get(key);
    if (!s) {
      s = new Set();
      this.sets.set(key, s);
    }
    return s;
  }

  async sadd(key: string, member: string): Promise<number> {
    const s = this.ensureSet(key);
    const before = s.size;
    s.add(member);
    return s.size > before ? 1 : 0;
  }

  async srem(key: string, member: string): Promise<number> {
    const s = this.sets.get(key);
    if (!s) return 0;
    const had = s.delete(member);
    if (s.size === 0) this.sets.delete(key);
    return had ? 1 : 0;
  }

  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size || 0;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) || []);
  }

  // --- KV operations ---
  async set(key: string, value: string, mode?: string, ttlMode?: string | number, ttl?: number): Promise<'OK'> {
    // Support EX TTL signature: set(key, value, 'EX', 60)
    this.kv.set(key, String(value));
    // TTL is ignored in the in-memory mock
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.kv.has(key) ? (this.kv.get(key) as string) : null;
  }

  async del(key: string): Promise<number> {
    let deleted = 0;
    if (this.kv.delete(key)) deleted++;
    if (this.sets.delete(key)) deleted++;
    if (this.hashes.delete(key)) deleted++;
    if (this.lists.delete(key)) deleted++;
    if (this.streams.delete(key)) deleted++;
    return deleted;
  }

  // --- Hash operations ---
  private ensureHash(key: string): KV {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    return h;
  }

  async hset(key: string, data: Record<string, any>): Promise<number> {
    const h = this.ensureHash(key);
    let added = 0;
    for (const [k, v] of Object.entries(data || {})) {
      const existed = h.has(k);
      h.set(k, String(v));
      if (!existed) added++;
    }
    return added;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const h = this.hashes.get(key);
    const out: Record<string, string> = {};
    if (!h) return out;
    for (const [k, v] of h.entries()) out[k] = v;
    return out;
  }

  // --- List operations ---
  private ensureList(key: string): string[] {
    let l = this.lists.get(key);
    if (!l) {
      l = [];
      this.lists.set(key, l);
    }
    return l;
  }

  async lpush(key: string, value: string): Promise<number> {
    const l = this.ensureList(key);
    l.unshift(value);
    return l.length;
  }

  // --- Streams (minimal) ---
  private ensureStream(key: string): StreamEntry[] {
    let s = this.streams.get(key);
    if (!s) {
      s = [];
      this.streams.set(key, s);
    }
    return s;
  }

  private genStreamId(): string {
    // Simplified ID: millis-Seq
    const ts = Date.now();
    globalStreamSeq = (globalStreamSeq + 1) % 10000;
    return `${ts}-${globalStreamSeq}`;
    }

  async xadd(key: string, id: string, ...fields: string[]): Promise<string> {
    // id can be '*'
    const realId = id === '*' ? this.genStreamId() : id;
    const stream = this.ensureStream(key);
    // fields already in alternating [field, value, field, value...]
    stream.push([realId, fields]);
    return realId;
  }

  async xrange(
    key: string,
    _start: string,
    _end: string,
    arg?: string,
    count?: number
  ): Promise<StreamEntry[]> {
    const stream = this.streams.get(key) || [];
    if (arg === 'COUNT' && typeof count === 'number') {
      return stream.slice(0, count);
    }
    return [...stream];
  }

  async xrevrange(
    key: string,
    _end: string,
    _start: string,
    arg?: string,
    count?: number
  ): Promise<StreamEntry[]> {
    const stream = this.streams.get(key) || [];
    const rev = [...stream].reverse();
    if (arg === 'COUNT' && typeof count === 'number') {
      return rev.slice(0, count);
    }
    return rev;
  }

  // --- Keys ---
  async keys(pattern: string): Promise<string[]> {
    // basic prefix support for 'events:*'
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      const pool = new Set<string>([
        ...this.kv.keys(),
        ...this.sets.keys(),
        ...this.hashes.keys(),
        ...this.lists.keys(),
        ...this.streams.keys(),
      ]);
      return Array.from(pool).filter((k) => k.startsWith(prefix));
    }
    // exact
    const pool = new Set<string>([
      ...this.kv.keys(),
      ...this.sets.keys(),
      ...this.hashes.keys(),
      ...this.lists.keys(),
      ...this.streams.keys(),
    ]);
    return Array.from(pool).filter((k) => k === pattern);
  }

  // --- Misc ---
  async ping(): Promise<string> {
    return 'PONG';
  }

  // Close/disconnect no-ops
  disconnect(): void {}
  quit(): Promise<'OK'> { return Promise.resolve('OK'); }
}