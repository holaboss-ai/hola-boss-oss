import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "index.css");

test("chat markdown styles wrap long content without disabling code block scrolling", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /\.chat-markdown \{\s*max-width: 100%;[\s\S]*overflow-wrap: anywhere;[\s\S]*word-break: break-word;/);
  assert.match(source, /\.chat-user-markdown \{\s*font-size: 13px;[\s\S]*line-height: 1\.75;/);
  assert.match(source, /\.chat-assistant-markdown \{\s*font-size: 15px;[\s\S]*line-height: 2;/);
  assert.match(source, /\.chat-markdown \.md-link,[\s\S]*\.chat-markdown \.md-table th \{\s*overflow-wrap: anywhere;[\s\S]*word-break: break-word;/);
  assert.match(source, /\.simple-markdown \.md-code-block \{[\s\S]*overflow-x: auto;/);
});
