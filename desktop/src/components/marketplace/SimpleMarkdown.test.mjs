import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "SimpleMarkdown.tsx");

test("simple markdown normalizes line endings and supports indented gfm tables", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.ok(source.includes('source.replace(/\\r\\n?/g, "\\n")'));
  assert.ok(source.includes("const codeBlocks: string[] = [];"));
  assert.ok(source.includes("@@MD_CODE_BLOCK_"));
  assert.ok(source.includes("/^( {0,3}\\|[^\\n]*\\|[ \\t]*)\\n"));
  assert.ok(source.includes(":?-{3,}:?[ \\t]*\\|"));
  assert.ok(source.includes("((?: {0,3}\\|[^\\n]*\\|[ \\t]*(?:\\n|$))+)/gm"));
  assert.ok(source.includes('/^ {0,3}#### (.+)$/gm'));
  assert.ok(source.includes('<h4 class="md-h4">$1</h4>'));
});
