import { dedupe } from "../src/index.js";
import { defaultKeyResolver } from "../src/key.js";

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------
describe("defaultKeyResolver", () => {
  it("produces the same key for objects with different property order", () => {
    const a = defaultKeyResolver([{ model: "claude", prompt: "hi" }]);
    const b = defaultKeyResolver([{ prompt: "hi", model: "claude" }]);
    expect(a).toBe(b);
  });

  it("produces different keys for different values", () => {
    const a = defaultKeyResolver([{ prompt: "hello" }]);
    const b = defaultKeyResolver([{ prompt: "world" }]);
    expect(a).not.toBe(b);
  });

  it("handles null and undefined without throwing", () => {
    expect(() => defaultKeyResolver([null, undefined])).not.toThrow();
  });

  it("handles numbers including edge cases", () => {
    const nan = defaultKeyResolver([Number.NaN]);
    const inf = defaultKeyResolver([Infinity]);
    const negInf = defaultKeyResolver([-Infinity]);
    const zero = defaultKeyResolver([0]);
    const negZero = defaultKeyResolver([-0]);

    // All should be distinct from each other
    const set = new Set([nan, inf, negInf, zero]);
    expect(set.size).toBe(4);

    // -0 and 0 normalise to the same key
    expect(zero).toBe(negZero);
  });

  it("handles nested objects", () => {
    const a = defaultKeyResolver([{ a: { b: { c: 1 } } }]);
    const b = defaultKeyResolver([{ a: { b: { c: 1 } } }]);
    expect(a).toBe(b);
  });

  it("handles arrays within objects", () => {
    const a = defaultKeyResolver([{ messages: ["a", "b"] }]);
    const b = defaultKeyResolver([{ messages: ["b", "a"] }]);
    expect(a).not.toBe(b); // array order matters
  });

  it("handles multiple arguments", () => {
    const a = defaultKeyResolver(["hello", "claude-sonnet", 0.7]);
    const b = defaultKeyResolver(["hello", "claude-sonnet", 0.7]);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Concurrency edge cases
// ---------------------------------------------------------------------------
describe("concurrency", () => {
  it("handles many simultaneous identical requests", async () => {
    let callCount = 0;
    const slow = (): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve("ok"), 20);
      });

    const safe = dedupe(slow);
    const results = await Promise.all(Array.from({ length: 20 }, () => safe()));

    expect(callCount).toBe(1);
    expect(results).toHaveLength(20);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("ok");
  });

  it("handles sequential calls with no TTL — each makes a real call", async () => {
    let callCount = 0;
    const fast = (): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        resolve("ok");
      });

    const safe = dedupe(fast, { ttl: 0 });

    await safe();
    await safe();
    await safe();

    expect(callCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Zero / edge option values
// ---------------------------------------------------------------------------
describe("option edge cases", () => {
  it("windowMs=0 never deduplicates (every call is treated as new)", async () => {
    let callCount = 0;
    const fn = (): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        // Resolve synchronously so the window logic has to handle 0ms edge case
        resolve("ok");
      });

    const safe = dedupe(fn, { windowMs: 0 });

    // Fire two calls back-to-back; with windowMs=0, the second call arrives
    // after the window (Date.now() - createdAt > 0 since >=1ms passes).
    const p1 = safe();
    await tick(5);
    const p2 = safe();

    expect(p1).not.toBe(p2);
    await Promise.all([p1, p2]);
    expect(callCount).toBe(2);
  });

  it("ttl=0 does not cache resolved responses", async () => {
    let callCount = 0;
    const fn = (): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve("ok"), 5);
      });

    const safe = dedupe(fn, { ttl: 0 });

    const r1 = await safe();
    const r2 = await safe();

    expect(callCount).toBe(2);
    expect(r1).toBe("ok");
    expect(r2).toBe("ok");
  });

  it("high TTL keeps the cache warm across multiple awaits", async () => {
    let callCount = 0;
    const fn = (): Promise<number> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve(42), 5);
      });

    const safe = dedupe(fn, { ttl: 2000 });

    const a = await safe();
    await tick(10);
    const b = await safe();
    await tick(10);
    const c = await safe();

    expect(callCount).toBe(1);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(c).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Return-type fidelity
// ---------------------------------------------------------------------------
describe("return type fidelity", () => {
  it("preserves object references from the underlying function", async () => {
    const obj = { data: [1, 2, 3] };
    const fn = (): Promise<typeof obj> => Promise.resolve(obj);

    const safe = dedupe(fn, { ttl: 1000 });

    const r1 = await safe();
    const r2 = await safe();

    expect(r1).toBe(obj);
    expect(r2).toBe(obj);
  });

  it("works with functions that return void/undefined", async () => {
    let callCount = 0;
    const fn = (): Promise<void> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(resolve, 10);
      });

    const safe = dedupe(fn);

    await Promise.all([safe(), safe()]);
    expect(callCount).toBe(1);
  });
});
