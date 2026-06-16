/**
 * Generates a stable cache key from an arbitrary argument list.
 *
 * Uses a deterministic JSON serialisation that sorts object keys so that
 * `{ model: "x", prompt: "y" }` and `{ prompt: "y", model: "x" }` produce
 * the same key.
 */
export declare function defaultKeyResolver(args: unknown[]): string;
//# sourceMappingURL=key.d.ts.map