import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "InternalSurfacePane.tsx");

test("internal surface renders markdown files with the shared markdown renderer", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /import \{ SimpleMarkdown \} from "@\/components\/marketplace\/SimpleMarkdown";/);
  assert.match(source, /const MARKDOWN_PREVIEW_EXTENSIONS = new Set\(\[\s*"\.md",\s*"\.mdx",\s*"\.markdown",\s*\]\);/);
  assert.match(source, /function isMarkdownPreviewPayload\(/);
  assert.match(source, /if \(preview\.kind === "text"\) \{[\s\S]*if \(isMarkdownPreviewPayload\(preview\)\) \{/);
  assert.match(source, /<SimpleMarkdown[\s\S]*className="chat-markdown text-sm text-foreground\/90"[\s\S]*onLinkClick=\{openPreviewLink\}[\s\S]*\{preview\.content\}[\s\S]*<\/SimpleMarkdown>/);
  assert.match(source, /window\.electronAPI\.ui\.openExternalUrl\(url\)/);
});
