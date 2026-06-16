import { defaultKeyResolver } from "./key.js";
const DEFAULT_TTL = 0;
const DEFAULT_WINDOW_MS = 500;
export function dedupe(fn, options = {}) {
    const { ttl = DEFAULT_TTL, windowMs = DEFAULT_WINDOW_MS, keyResolver, } = options;
    const cache = new Map();
    function resolveKey(args) {
        return keyResolver != null
            ? keyResolver(...args)
            : defaultKeyResolver(args);
    }
    function evict(key) {
        cache.delete(key);
    }
    return function deduped(...args) {
        const key = resolveKey(args);
        const now = Date.now();
        const existing = cache.get(key);
        if (existing != null) {
            // If the entry has a TTL expiry and it's passed, evict and fall through.
            if (existing.expiresAt != null && now >= existing.expiresAt) {
                cache.delete(key);
            }
            else if (existing.settled) {
                // Resolved and within TTL — return cached promise directly.
                return existing.promise;
            }
            else {
                // Still in-flight — check window.
                if (now - existing.createdAt <= windowMs) {
                    return existing.promise;
                }
                // Window has expired — treat as a new request (fall through).
                cache.delete(key);
            }
        }
        const promise = fn(...args).then((value) => {
            const entry = cache.get(key);
            if (entry != null) {
                entry.settled = true;
                if (ttl > 0) {
                    entry.expiresAt = Date.now() + ttl;
                    // Schedule automatic eviction so the Map doesn't grow unboundedly.
                    setTimeout(() => {
                        const current = cache.get(key);
                        if (current === entry)
                            evict(key);
                    }, ttl).unref();
                }
                else {
                    // No caching — remove immediately on settle.
                    evict(key);
                }
            }
            return value;
        }, (error) => {
            // On failure, always evict so subsequent callers can retry.
            evict(key);
            throw error;
        });
        const entry = {
            promise,
            createdAt: now,
            settled: false,
        };
        cache.set(key, entry);
        return promise;
    };
}
//# sourceMappingURL=dedupe.js.map