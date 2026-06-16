import { dedupe } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCounter<T>(
  result: T,
  delayMs = 10
): { fn: (arg: T) => Promise<T>; calls: number } {
  const tracker = { calls: 0 };
  const fn = (_arg: T): Promise<T> =>
    new Promise<T>((resolve) => {
      tracker.calls++;
      setTimeout(() => resolve(result), delayMs);
    });
  return { fn, calls: tracker.calls };
}

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test 1 — Two identical requests fired simultaneously: only 1 real call
// ---------------------------------------------------------------------------
describe("deduplication of in-flight requests", () => {
  it("makes only one real call when two identical requests are in-flight", async () => {
    let callCount = 0;
    const slow = (_prompt: string): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve("response"), 30);
      });

    const safe = dedupe(slow);

    const [r1, r2] = await Promise.all([safe("hello"), safe("hello")]);

    expect(callCount).toBe(1);
    expect(r1).toBe("response");
    expect(r2).toBe("response");
  });

  it("returns the same Promise reference for duplicate in-flight calls", async () => {
    const slow = (): Promise<string> =>
      new Promise((resolve) => setTimeout(() => resolve("ok"), 30));

    const safe = dedupe(slow);

    const p1 = safe();
    const p2 = safe();

    expect(p1).toBe(p2);

    await p1;
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Two different prompts: both calls made independently
// ---------------------------------------------------------------------------
describe("distinct keys produce independent calls", () => {
  it("makes two real calls for two different prompts", async () => {
    let callCount = 0;
    const slow = (prompt: string): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve(prompt.toUpperCase()), 20);
      });

    const safe = dedupe(slow);

    const [r1, r2] = await Promise.all([safe("hello"), safe("world")]);

    expect(callCount).toBe(2);
    expect(r1).toBe("HELLO");
    expect(r2).toBe("WORLD");
  });
});

// ---------------------------------------------------------------------------
// Test 3 — First request fails: all callers get the error, key is cleared
// ---------------------------------------------------------------------------
describe("error propagation", () => {
  it("rejects all waiting callers when the first call fails", async () => {
    let callCount = 0;
    const failing = (): Promise<string> =>
      new Promise((_, reject) => {
        callCount++;
        setTimeout(() => reject(new Error("API error")), 20);
      });

    const safe = dedupe(failing);

    const [result1, result2] = await Promise.allSettled([safe(), safe()]);

    expect(callCount).toBe(1);
    expect(result1.status).toBe("rejected");
    expect(result2.status).toBe("rejected");
    if (result1.status === "rejected")
      expect(result1.reason.message).toBe("API error");
    if (result2.status === "rejected")
      expect(result2.reason.message).toBe("API error");
  });

  it("allows retry after a failed request clears the key", async () => {
    let callCount = 0;
    let shouldFail = true;
    const flaky = (): Promise<string> =>
      new Promise((resolve, reject) => {
        callCount++;
        setTimeout(() => {
          if (shouldFail) reject(new Error("temporary error"));
          else resolve("ok");
        }, 20);
      });

    const safe = dedupe(flaky);

    await expect(safe()).rejects.toThrow("temporary error");

    shouldFail = false;
    const result = await safe();
    expect(result).toBe("ok");
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — TTL: third request within TTL gets cached response
// ---------------------------------------------------------------------------
describe("TTL caching", () => {
  it("serves cached result within TTL without making a new call", async () => {
    let callCount = 0;
    const slow = (): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve("cached"), 10);
      });

    const safe = dedupe(slow, { ttl: 200, windowMs: 5000 });

    const r1 = await safe();
    expect(callCount).toBe(1);
    expect(r1).toBe("cached");

    // Second call after settlement but within TTL
    await tick(20);
    const r2 = await safe();
    expect(callCount).toBe(1); // no new call
    expect(r2).toBe("cached");
  });

  it("makes a fresh call after TTL expires", async () => {
    let callCount = 0;
    const slow = (): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve("response"), 10);
      });

    const safe = dedupe(slow, { ttl: 50 });

    await safe();
    expect(callCount).toBe(1);

    // Wait for TTL to expire
    await tick(100);

    await safe();
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — windowMs exceeded: treated as a new request
// ---------------------------------------------------------------------------
describe("windowMs", () => {
  it("makes a new call when windowMs has elapsed between requests", async () => {
    let callCount = 0;
    const slow = (): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve("ok"), 200);
      });

    const safe = dedupe(slow, { windowMs: 30 });

    // First call — starts the in-flight entry
    const p1 = safe();

    // Wait until after the window expires
    await tick(60);

    // Second call — window expired so a new real call should be made
    const p2 = safe();

    expect(p1).not.toBe(p2);
    expect(callCount).toBe(2);

    // Resolve both so Jest doesn't leak timers
    await Promise.allSettled([p1, p2]);
  });

  it("deduplicates when requests arrive within windowMs", async () => {
    let callCount = 0;
    const slow = (): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve("ok"), 50);
      });

    const safe = dedupe(slow, { windowMs: 200 });

    const p1 = safe();
    await tick(10); // still within window
    const p2 = safe();

    expect(p1).toBe(p2);
    expect(callCount).toBe(1);

    await p1;
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Custom keyResolver
// ---------------------------------------------------------------------------
describe("custom keyResolver", () => {
  it("uses the provided keyResolver to generate cache keys", async () => {
    let callCount = 0;
    const fn = (opts: { prompt: string; requestId: string }): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve(opts.prompt.toUpperCase()), 10);
      });

    // Only consider `prompt`, ignore `requestId`
    const safe = dedupe(fn, {
      keyResolver: (opts) => opts.prompt,
    });

    const [r1, r2] = await Promise.all([
      safe({ prompt: "hello", requestId: "req-1" }),
      safe({ prompt: "hello", requestId: "req-2" }),
    ]);

    expect(callCount).toBe(1);
    expect(r1).toBe("HELLO");
    expect(r2).toBe("HELLO");
  });

  it("treats requests as distinct when keyResolver returns different keys", async () => {
    let callCount = 0;
    const fn = (opts: { prompt: string }): Promise<string> =>
      new Promise((resolve) => {
        callCount++;
        setTimeout(() => resolve(opts.prompt), 10);
      });

    const safe = dedupe(fn, {
      keyResolver: (opts) => opts.prompt,
    });

    await Promise.all([safe({ prompt: "a" }), safe({ prompt: "b" })]);

    expect(callCount).toBe(2);
  });
});
