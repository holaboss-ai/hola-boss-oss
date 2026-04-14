import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "ChatPane.tsx");

test("chat composer compact reasoning control can expand past icon-only width", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const COMPOSER_COMPACT_THINKING_CONTROL_MIN_WIDTH_PX = 56;/,
  );
  assert.match(
    source,
    /const COMPOSER_COMPACT_THINKING_CONTROL_MAX_WIDTH_PX = 124;/,
  );
  assert.match(
    source,
    /const showCompactLabel =\s*!compact \|\|\s*typeof compactWidth !== "number" \|\|\s*compactWidth >= compactLabelMinWidth;/,
  );
  assert.match(
    source,
    /const compactThinkingControlWidth = showThinkingValueSelector[\s\S]*Math\.min\(\s*COMPOSER_COMPACT_THINKING_CONTROL_MAX_WIDTH_PX,\s*compactFooterControlWidth - compactModelControlWidth,\s*\)/,
  );
});
