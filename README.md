# llm-dedupe

Deduplicates identical in-flight LLM API requests — one real call, zero duplicate token spend.

## The problem

In any interactive AI app, the same prompt can fire multiple times before the first response arrives:

- User **double-clicks** the Send button
- React **re-renders** trigger `useEffect` twice
- Autocomplete fires **3 requests** in rapid succession
- Server-side rendering + client hydration both call the API

Without deduplication each of those is a separate API call — and a separate bill.

```
User double-clicks Send:

Request 1  ──→  Claude API  ──→  "4"  (charged)
Request 2  ──→  Claude API  ──→  "4"  (charged again — wasted)
Request 3  ──→  Claude API  ──→  "4"  (charged again — wasted)
```

**With llm-dedupe:**

```
Request 1  ──→  Claude API  ──→  "4"  (charged once)
Request 2  ─┐
Request 3  ─┘──→  same Promise  ──→  "4"  (free)
```

## Installation

```bash
npm install llm-dedupe
```

## Quick start

```ts
import { dedupe } from "llm-dedupe";

// Wrap any async function that calls an LLM
const safeFetch = dedupe(myLLMCallFunction, {
  ttl: 0,        // 0 = no post-resolve cache, just dedup in-flight
  windowMs: 500, // deduplicate bursts within 500 ms
});

// All three calls below resolve to the same value with only ONE real API call
const [r1, r2, r3] = await Promise.all([
  safeFetch({ prompt: "hello", model: "claude-sonnet-4-20250514" }),
  safeFetch({ prompt: "hello", model: "claude-sonnet-4-20250514" }),
  safeFetch({ prompt: "hello", model: "claude-sonnet-4-20250514" }),
]);
```

## Before / After

**Before — 3× token cost**

```ts
async function sendMessage(prompt: string) {
  // Called 3 times on double-click = 3 billed requests
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0].message.content;
}
```

**After — 1× token cost**

```ts
import { dedupe } from "llm-dedupe";

const sendMessage = dedupe(
  async (prompt: string) => {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });
    return res.choices[0].message.content;
  },
  { windowMs: 500 }
);

// The UI fires 3 calls → only 1 real API call is made
const response = await sendMessage("What is 2 + 2?");
```

## Cost savings example

> 3 duplicate calls to Claude Sonnet = 3× token cost.
> With llm-dedupe = 1× token cost.

For a prompt that uses 500 input tokens + 100 output tokens at current Claude Sonnet pricing:
- Without dedup (3 accidental calls): `3 × (500 × $3/Mtok + 100 × $15/Mtok)` = **$0.009**
- With llm-dedupe: `1 × (500 × $3/Mtok + 100 × $15/Mtok)` = **$0.003**
- **Saving: 67% per double-click event**

At scale — 100,000 chat sessions/day with a 30% double-click rate — that's real money.

## API reference

### `dedupe(fn, options?)`

Wraps an async function and returns a deduplicated version.

| Parameter | Type | Description |
|---|---|---|
| `fn` | `(...args: TArgs) => Promise<TReturn>` | The async function to wrap. |
| `options` | `DedupeOptions<TArgs>` | Configuration (see below). |

**Returns:** `(...args: TArgs) => Promise<TReturn>` — a drop-in replacement for `fn`.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `ttl` | `number` | `0` | Milliseconds to keep a **resolved** response cached. `0` = no post-resolve caching, only dedup in-flight. |
| `windowMs` | `number` | `500` | Only deduplicate requests that arrive within this window (ms) of the first in-flight call. After the window, a matching key is treated as a fresh request. |
| `keyResolver` | `(...args: TArgs) => string` | stable JSON hash of all args | Custom function to produce the cache key from the call arguments. |

### Key generation

By default the key is a **stable, sorted JSON serialisation** of all arguments:

```ts
// These two calls produce the same key (object key order is normalised)
safeFetch({ model: "claude", prompt: "hi" });
safeFetch({ prompt: "hi", model: "claude" });
```

Override with `keyResolver` to ignore irrelevant fields (e.g. a per-request `requestId`):

```ts
const safe = dedupe(callLLM, {
  keyResolver: ({ prompt, model }) => `${model}:${prompt}`,
});
```

### Error behaviour

If the underlying call rejects, **all waiting callers** receive the same error and the key is immediately cleared so the next call can retry:

```ts
const safe = dedupe(flakyFn);

// Both reject with the same error
await Promise.allSettled([safe(), safe()]);

// Safe to retry — key was cleared
const result = await safe(); // makes a fresh real call
```

## TypeScript

Full generic types — the return type of the wrapped function is preserved:

```ts
import { dedupe, DedupeOptions } from "llm-dedupe";

interface ChatRequest {
  prompt: string;
  model: string;
  temperature?: number;
}

const safeClaude = dedupe(
  async (req: ChatRequest): Promise<string> => { /* ... */ },
  {
    ttl: 30_000,
    windowMs: 500,
    keyResolver: (req) => `${req.model}:${req.temperature ?? 1}:${req.prompt}`,
  } satisfies DedupeOptions<[ChatRequest]>
);

const result: string = await safeClaude({ prompt: "hello", model: "claude-sonnet-4-20250514" });
//    ^^^^^^ correctly typed as string
```

## Requirements

- Node.js 18+
- Zero runtime dependencies

## License

MIT
