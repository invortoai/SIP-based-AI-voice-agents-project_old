/**
 * TimelinePublisher XRANGE mapping, ordering, COUNT, pagination tests
 * Uses Jest moduleNameMapper to mock ioredis with tests/mocks/ioredis.ts
 */
import { TimelinePublisher } from "../../services/realtime/src/timeline/redis";

describe("TimelinePublisher.getEvents()", () => {
  const redisUrl = "redis://localhost:6379";

  test("maps XRANGE entries to {id, kind, payload, timestamp} with ascending order", async () => {
    const tl = new TimelinePublisher(redisUrl);
    const callId = "tl_test_" + Date.now();

    // Insert 3 events out of order by pushing with real-time increasing ids
    await tl.publish(callId, "kind.a", { a: 1 });
    await tl.publish(callId, "kind.b", { b: "x" });
    await tl.publish(callId, "kind.c", { c: true });

    const events = await tl.getEvents(callId, 10);
    expect(events.length).toBe(3);

    // Ascending ordering by XRANGE default (our mock preserves push order)
    expect(events[0].kind).toBe("kind.a");
    expect(events[1].kind).toBe("kind.b");
    expect(events[2].kind).toBe("kind.c");

    // payload is parsed JSON and timestamp is number
    expect(events[0].payload).toEqual({ a: 1 });
    expect(typeof events[0].timestamp).toBe("number");

    // id is a non-empty string
    expect(typeof events[0].id).toBe("string");
    expect(events[0].id.length).toBeGreaterThan(0);

    // clean up
    await (tl as any).close?.();
  });

  test("respects COUNT and basic pagination behavior", async () => {
    const tl = new TimelinePublisher(redisUrl);
    const callId = "tl_pagination_" + Date.now();

    // Produce 5 entries
    for (let i = 0; i < 5; i++) {
      await tl.publish(callId, `k.${i}`, { i });
    }

    // First page: COUNT=3
    const first = await tl.getEvents(callId, 3);
    expect(first.length).toBe(3);
    expect(first[0].kind).toBe("k.0");
    expect(first[2].kind).toBe("k.2");

    // Second page emulation by re-calling getEvents with COUNT=5 then slicing.
    // (Our current getEvents does XRANGE with COUNT only; real cursor-based pagination
    //  would accept start/end ids. For now we validate COUNT behavior deterministically.)
    const all = await tl.getEvents(callId, 5);
    expect(all.length).toBe(5);
    expect(all[4].kind).toBe("k.4");

    await (tl as any).close?.();
  });

  test("gracefully handles empty streams", async () => {
    const tl = new TimelinePublisher(redisUrl);
    const callId = "empty_stream_" + Date.now();

    const events = await tl.getEvents(callId, 10);
    expect(events).toEqual([]);

    await (tl as any).close?.();
  });
});