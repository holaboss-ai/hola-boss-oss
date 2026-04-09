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
    /if \(kind === "table"\) \{[\s\S]*const tableSheets = await buildTablePreviewSheets\(buffer, extension\);/,
  );
});

test("desktop file explorer enforces the selected workspace root as a filesystem boundary", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /async function resolveWorkspaceScopedExplorerPath\(/);
  assert.match(source, /async function renameExplorerPath\(/);
  assert.match(source, /async function deleteExplorerPath\(/);
  assert.match(source, /await workspaceDirectoryPath\(normalizedWorkspaceId\)/);
  assert.match(source, /const relativePath = path\.relative\(rootPath, targetPath\);/);
  assert.match(source, /throw new Error\(`Target path escapes workspace root: \$\{trimmedTargetPath\}`\);/);
  assert.match(source, /throw new Error\("Workspace root cannot be renamed\."\);/);
  assert.match(source, /throw new Error\("Workspace root cannot be deleted\."\);/);
  assert.match(source, /let targetExists = false;/);
  assert.match(source, /if \(targetExists\) \{\s*throw new Error\(`A file or folder named "\$\{trimmedName\}" already exists\.`\);\s*\}/);
  assert.match(
    source,
    /"fs:listDirectory"[\s\S]*async \(_event, targetPath\?: string \| null, workspaceId\?: string \| null\) =>\s*listDirectory\(targetPath, workspaceId\)/,
  );
  assert.match(
    source,
    /"fs:readFilePreview"[\s\S]*async \(_event, targetPath: string, workspaceId\?: string \| null\) =>\s*readFilePreview\(targetPath, workspaceId\)/,
  );
  assert.match(
    source,
    /"fs:writeTextFile"[\s\S]*workspaceId\?: string \| null,[\s\S]*writeTextFile\(targetPath, content, workspaceId\)/,
  );
  assert.match(
    source,
    /"fs:renamePath"[\s\S]*targetPath: string,[\s\S]*nextName: string,[\s\S]*renameExplorerPath\(targetPath, nextName, workspaceId\)/,
  );
  assert.match(
    source,
    /"fs:deletePath"[\s\S]*async \(_event, targetPath: string, workspaceId\?: string \| null\) =>\s*deleteExplorerPath\(targetPath, workspaceId\)/,
  );
});

test("file explorer opens folders on double click and renders table previews", async () => {
  const source = await readFile(fileExplorerPaneSourcePath, "utf8");

  assert.match(
    source,
    /onDoubleClick=\{\(\) => \{\s*if \(entry\.isDirectory\) \{\s*void openPath\(entry\.absolutePath\);/,
  );
  assert.match(
    source,
    /preview\?\.kind === "table" && activeTableSheet/,
  );
});
