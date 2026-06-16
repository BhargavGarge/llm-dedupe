/**
 * After tsc emits dist/cjs, drop a package.json next to the CJS files so that
 * Node.js treats them as CommonJS even when the root package.json has
 * "type": "module" (which we don't set, but this keeps future changes safe).
 */
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cjsDir = join(__dirname, "..", "dist", "cjs");

writeFileSync(
  join(cjsDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n"
);

console.log("✓ wrote dist/cjs/package.json");
