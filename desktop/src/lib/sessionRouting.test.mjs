import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "sessionRouting.ts");

test("preferred session routing keeps the main session ahead of transient runtime sessions", async () => {
  const source = await readFile(sourcePath, "utf8");

  const mainSessionIndex = source.indexOf('const mainSessionId = (workspace.main_session_id || "").trim();');
  const runtimeFallbackIndex = source.indexOf("if (runtimeStates.length > 0) {");

  assert.notEqual(mainSessionIndex, -1);
  assert.notEqual(runtimeFallbackIndex, -1);
  assert.ok(mainSessionIndex < runtimeFallbackIndex);
});
