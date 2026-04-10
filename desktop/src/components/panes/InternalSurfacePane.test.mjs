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
  assert.match(source, /const \[textPreviewMode, setTextPreviewMode\] =\s*useState<TextPreviewMode>\("edit"\);/);
  assert.match(source, /setTextPreviewMode\("edit"\);/);
  assert.match(source, /if \(preview\.kind === "text"\) \{[\s\S]*\{isMarkdownPreview && textPreviewMode === "preview" \? \(/);
  assert.match(source, /<SimpleMarkdown[\s\S]*className="chat-markdown text-sm text-foreground\/90"[\s\S]*onLinkClick=\{openPreviewLink\}[\s\S]*\{previewDraft\}[\s\S]*<\/SimpleMarkdown>/);
  assert.match(source, /window\.electronAPI\.ui\.openExternalUrl\(url\)/);
});

test("internal surface preview omits absolute path metadata", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(
    source,
    /MetadataRow label="Path" value=\{preview\.absolutePath\}/,
  );
  assert.doesNotMatch(
    source,
    /MetadataRow label="Target" value=\{resourceId\}/,
  );
});

test("internal surface enables editing and saving for file displays", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const savePreview = useCallback\(async \(\) => \{[\s\S]*window\.electronAPI\.fs\.writeTextFile\(\s*preview\.absolutePath,\s*previewDraft,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(
    source,
    /<textarea[\s\S]*value=\{previewDraft\}[\s\S]*onChange=\{\(event\) => setPreviewDraft\(event\.target\.value\)\}[\s\S]*readOnly=\{!preview\.isEditable\}/,
  );
  assert.match(
    source,
    /{preview\.isEditable \? \(\s*<button[\s\S]*onClick=\{\(\) => void savePreview\(\)\}[\s\S]*\{isSaving \? "Saving" : "Save"\}/,
  );
});
