import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");
const fileExplorerPaneSourcePath = path.join(
  __dirname,
  "..",
  "src",
  "components",
  "panes",
  "FileExplorerPane.tsx",
);

test("desktop file preview supports tabular spreadsheet kinds", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(
    source,
    /type FilePreviewKind = "text" \| "image" \| "pdf" \| "table" \| "unsupported";/,
  );
  assert.match(
    source,
    /const TABLE_FILE_EXTENSIONS = new Set\(\["\.csv", "\.xlsx", "\.xls"\]\);/,
  );
  assert.match(
    source,
    /if \(kind === "table"\) \{[\s\S]*const tableSheets = buildTablePreviewSheets\(buffer\);/,
  );
});

test("file explorer opens folders directly on click and renders table previews", async () => {
  const source = await readFile(fileExplorerPaneSourcePath, "utf8");

  assert.match(
    source,
    /onClick=\{\(\) => \{\s*if \(entry\.isDirectory\) \{\s*void openPath\(entry\.absolutePath\);/,
  );
  assert.match(
    source,
    /preview\?\.kind === "table" && activeTableSheet/,
  );
});
