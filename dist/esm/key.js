/**
 * Generates a stable cache key from an arbitrary argument list.
 *
 * Uses a deterministic JSON serialisation that sorts object keys so that
 * `{ model: "x", prompt: "y" }` and `{ prompt: "y", model: "x" }` produce
 * the same key.
 */
export function defaultKeyResolver(args) {
    return stableStringify(args);
}
function stableStringify(value) {
    if (value === null)
        return "null";
    if (value === undefined)
        return "undefined";
    const type = typeof value;
    if (type === "number") {
        // Normalise -0 → 0 and preserve NaN/Infinity as strings so they round-trip
        if (Number.isNaN(value))
            return '"__NaN__"';
        if (!Number.isFinite(value))
            return value > 0 ? '"__Infinity__"' : '"__-Infinity__"';
        return Object.is(value, -0) ? "0" : String(value);
    }
    if (type === "boolean" || type === "bigint")
        return String(value);
    if (type === "string")
        return JSON.stringify(value);
    if (type === "function" || type === "symbol") {
        // Functions / symbols can't be meaningfully serialised — use their string
        // representation as a best-effort discriminator.
        return JSON.stringify(value.toString());
    }
    if (Array.isArray(value)) {
        return "[" + value.map(stableStringify).join(",") + "]";
    }
    // Plain object — sort keys for stability
    const obj = value;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return "{" + pairs.join(",") + "}";
}
//# sourceMappingURL=key.js.map