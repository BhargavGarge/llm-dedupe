export interface DedupeOptions<TArgs extends unknown[]> {
    /**
     * How long (ms) to cache a resolved response after the promise settles.
     * Default: 0 — no caching, dedup in-flight requests only.
     */
    ttl?: number;
    /**
     * Only deduplicate requests that arrive within this window (ms) of the
     * first in-flight request.  After the window closes a new call is treated
     * as a fresh request even if the key matches.
     * Default: 500
     */
    windowMs?: number;
    /**
     * Custom key resolver.  Receives the same arguments as the wrapped function
     * and must return a string that uniquely identifies the logical request.
     * Default: stable JSON serialisation of all arguments.
     */
    keyResolver?: (...args: TArgs) => string;
}
export interface CacheEntry<T> {
    promise: Promise<T>;
    /** Epoch ms when the entry was first created. */
    createdAt: number;
    /** Epoch ms after which the entry should be evicted (set once resolved, if ttl > 0). */
    expiresAt?: number;
    /** Whether the underlying promise has already settled. */
    settled: boolean;
}
export type AsyncFn<TArgs extends unknown[], TReturn> = (...args: TArgs) => Promise<TReturn>;
//# sourceMappingURL=types.d.ts.map