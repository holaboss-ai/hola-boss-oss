import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "sessionRouting.ts");

test("preferred session routing prefers primary chat sessions ahead of raw runtime fallback", async () => {
  const source = await readFile(sourcePath, "utf8");

  const primarySessionIndex = source.indexOf("const preferredPrimary = sessions.find((session) => {");
  const runtimeFallbackIndex = source.indexOf("const runtimeFallback = runtimeStates.find(");

  assert.notEqual(primarySessionIndex, -1);
  assert.notEqual(runtimeFallbackIndex, -1);
  assert.ok(primarySessionIndex < runtimeFallbackIndex);
});
