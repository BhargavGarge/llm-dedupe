/**
 * Real-world demo: wrapping the Anthropic Claude API with llm-dedupe.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-ant-... npx ts-node examples/claude-demo.ts
 *
 * Requires:  npm install @anthropic-ai/sdk
 */

import Anthropic from "@anthropic-ai/sdk";
import { dedupe } from "../src/index.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

interface ChatRequest {
  prompt: string;
  model?: string;
  maxTokens?: number;
}

async function callClaude(req: ChatRequest): Promise<string> {
  const response = await client.messages.create({
    model: req.model ?? "claude-haiku-4-5-20251001",
    max_tokens: req.maxTokens ?? 256,
    messages: [{ role: "user", content: req.prompt }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  return block.text;
}

// ---------------------------------------------------------------------------
// Wrap with llm-dedupe
// ---------------------------------------------------------------------------

const safeCallClaude = dedupe(callClaude, {
  ttl: 30_000,    // Cache for 30 s — great for autocomplete / streaming suggestions
  windowMs: 500,  // Deduplicate bursts within 500 ms (e.g. double-click, re-renders)
  keyResolver: (req) =>
    JSON.stringify({
      prompt: req.prompt,
      model: req.model ?? "claude-haiku-4-5-20251001",
    }),
});

// ---------------------------------------------------------------------------
// Simulation: user double-clicks "Send" three times
// ---------------------------------------------------------------------------

async function simulateDoubleSend(): Promise<void> {
  console.log("\n=== Scenario: User double-clicks Send (3 rapid requests) ===\n");

  const req: ChatRequest = {
    prompt: "What is 2 + 2?",
    model: "claude-haiku-4-5-20251001",
  };

  let realCallCount = 0;
  const original = callClaude;

  // Instrument to count real calls (demo only)
  const instrumented = dedupe(
    async (r: ChatRequest): Promise<string> => {
      realCallCount++;
      console.log(`  → Real API call #${realCallCount} fired`);
      return original(r);
    },
    {
      ttl: 30_000,
      windowMs: 500,
      keyResolver: (r) =>
        JSON.stringify({
          prompt: r.prompt,
          model: r.model ?? "claude-haiku-4-5-20251001",
        }),
    }
  );

  const start = Date.now();

  // Fire 3 identical requests "simultaneously"
  const [r1, r2, r3] = await Promise.all([
    instrumented(req),
    instrumented(req),
    instrumented(req),
  ]);

  const elapsed = Date.now() - start;

  console.log(`\n  Results (all identical): "${r1.slice(0, 60)}..."`);
  console.log(`  Real API calls made: ${realCallCount}  (saved ${3 - realCallCount} × token cost)`);
  console.log(`  Total elapsed: ${elapsed} ms\n`);

  // Demonstrate TTL cache — 4th call reuses the cached response
  console.log("=== Scenario: Same prompt again within TTL (e.g. autocomplete re-trigger) ===\n");
  const r4 = await instrumented(req);
  console.log(`  Real API calls made so far: ${realCallCount}  (4th call served from cache)`);
  console.log(`  Response: "${r4.slice(0, 60)}..."\n`);

  // Cost savings summary
  console.log("=== Cost Savings Summary ===");
  console.log(`  Without llm-dedupe : 4 API calls = 4× token cost`);
  console.log(`  With    llm-dedupe : ${realCallCount} API call  = ${realCallCount}× token cost`);
  console.log(
    `  Savings            : ${Math.round(((4 - realCallCount) / 4) * 100)}% fewer tokens billed\n`
  );
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error("ANTHROPIC_API_KEY is not set — set it to run this demo.");
  process.exit(1);
}

simulateDoubleSend().catch((err: unknown) => {
  console.error("Demo failed:", err);
  process.exit(1);
});

// Export for use in other modules
export { safeCallClaude };
