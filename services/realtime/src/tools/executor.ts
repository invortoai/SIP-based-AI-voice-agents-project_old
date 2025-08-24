import Ajv, { JSONSchemaType } from "ajv";
import { v4 as uuidv4 } from "uuid";
import Redis from "ioredis";

export interface ToolDefinition {
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  inputSchema?: any;
  outputSchema?: any;
  blocking?: boolean;
  timeoutMs?: number;
}

export interface ToolResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  result?: unknown;
  error?: string;
}

export class ToolExecutor {
  private ajv = new Ajv({ allErrors: true, strict: false });
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async execute(def: ToolDefinition, args: Record<string, unknown>, idempotencyKey?: string): Promise<ToolResult> {
    const key = idempotencyKey || uuidv4();
    const lockKey = `toollock:${def.name}:${key}`;
    const set = await this.redis.set(lockKey, "1", "EX", 10, "NX");
    if (!set) {
      return { ok: false, error: "conflict" };
    }
    const start = Date.now();
    try {
      if (def.inputSchema) {
        const validate = this.ajv.compile(def.inputSchema);
        if (!validate(args)) {
          return { ok: false, error: "bad_request" };
        }
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), def.timeoutMs ?? 2000);
      const url = this.interpolate(def.url, args);
      const res = await fetch(url, {
        method: def.method,
        headers: def.headers,
        body: def.method === "GET" ? undefined : JSON.stringify(args),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;
      let json: unknown = undefined;
      try { json = await res.json(); } catch {}
      if (def.outputSchema) {
        const validateOut = this.ajv.compile(def.outputSchema);
        if (json && !validateOut(json)) {
          return { ok: false, status: res.status, latencyMs, error: "schema_mismatch" };
        }
      }
      return { ok: res.ok, status: res.status, latencyMs, result: json };
    } catch (err: any) {
      return { ok: false, error: err?.name === "AbortError" ? "timeout" : "error" };
    } finally {
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  private interpolate(template: string, params: Record<string, unknown>): string {
    return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
  }
}

