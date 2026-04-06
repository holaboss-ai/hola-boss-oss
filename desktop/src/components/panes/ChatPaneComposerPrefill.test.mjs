import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "ChatPane.tsx");

test("chat pane can consume a one-shot composer prefill request", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /interface ChatPaneComposerPrefillRequest \{\s*text: string;\s*requestKey: number;\s*\}/);
  assert.match(source, /composerPrefillRequest\?: ChatPaneComposerPrefillRequest \| null;/);
  assert.match(source, /onComposerPrefillConsumed\?: \(requestKey: number\) => void;/);
  assert.match(source, /const lastHandledComposerPrefillRequestKeyRef = useRef\(0\);/);
  assert.match(source, /const requestKey = composerPrefillRequest\?\.requestKey \?\? 0;/);
  assert.match(source, /requestKey === lastHandledComposerPrefillRequestKeyRef\.current/);
  assert.match(source, /setInput\(composerPrefillRequest\?\.text \?\? ""\);/);
  assert.match(source, /setPendingAttachments\(\[\]\);/);
  assert.match(source, /onComposerPrefillConsumed\?\.\(requestKey\);/);
});
