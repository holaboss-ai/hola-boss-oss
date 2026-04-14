import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");
const preloadSourcePath = path.join(__dirname, "preload.ts");
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
  assert.match(source, /hasHeaderRow: boolean;/);
  assert.match(source, /const hasHeaderRow =/);
  assert.match(source, /async function writeTableFile\(/);
  assert.match(source, /async function writeCsvTablePreview\(/);
  assert.match(source, /async function writeWorkbookTablePreview\(/);
  assert.match(source, /if \(extension === "\.xls"\) \{\s*throw new Error\("Legacy \.xls files are preview-only in the inline editor\."\);\s*\}/);
  assert.match(
    source,
    /const TEXT_FILE_EXTENSIONS = new Set\(\[[\s\S]*"\.md"[\s\S]*"\.mdx"[\s\S]*"\.markdown"[\s\S]*\]\);/,
  );
});

test("desktop file explorer enforces the selected workspace root as a filesystem boundary", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /async function resolveWorkspaceScopedExplorerPath\(/);
  assert.match(source, /async function createExplorerPath\(/);
  assert.match(source, /async function renameExplorerPath\(/);
  assert.match(source, /async function moveExplorerPath\(/);
  assert.match(source, /async function deleteExplorerPath\(/);
  assert.match(source, /await workspaceDirectoryPath\(normalizedWorkspaceId\)/);
  assert.match(source, /const relativePath = path\.relative\(rootPath, targetPath\);/);
  assert.match(source, /throw new Error\(`Target path escapes workspace root: \$\{trimmedTargetPath\}`\);/);
  assert.match(source, /throw new Error\("Created path escapes workspace root\."\);/);
  assert.match(source, /throw new Error\("Workspace root cannot be renamed\."\);/);
  assert.match(source, /throw new Error\("Workspace root cannot be moved\."\);/);
  assert.match(source, /throw new Error\("Workspace root cannot be deleted\."\);/);
  assert.match(source, /async function ensureExplorerPathDoesNotExist\(/);
  assert.match(source, /if \(await fileExists\(targetPath\)\) \{/);
  assert.match(source, /throw new Error\(`A file or folder named "\$\{targetName\}" already exists\.`\);/);
  assert.match(source, /async function rewriteExplorerBookmarksAfterPathChange\(/);
  assert.match(source, /async function nextAvailableExplorerCreatePath\(/);
  assert.match(source, /kind === "directory" \? "New Folder" : "Untitled\.txt"/);
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
    /"fs:writeTableFile"[\s\S]*tableSheets: FilePreviewTableSheetPayload\[\],[\s\S]*writeTableFile\(targetPath, tableSheets, workspaceId\)/,
  );
  assert.match(
    source,
    /"fs:createPath"[\s\S]*parentPath: string \| null \| undefined,[\s\S]*kind: FileSystemCreateKind,[\s\S]*createExplorerPath\(parentPath, kind, workspaceId\)/,
  );
  assert.match(source, /type ExplorerExternalImportEntryPayload =/);
  assert.match(source, /interface ExplorerExternalImportResultPayload \{\s*absolutePaths: string\[];\s*\}/);
  assert.match(source, /function normalizeExplorerImportRelativePath\(/);
  assert.match(source, /function normalizeExplorerImportEntries\(/);
  assert.match(source, /async function importExternalExplorerEntries\(/);
  assert.match(source, /await nextAvailableExplorerCreatePath\(\s*destinationAbsolutePath,\s*rootName,\s*\)/);
  assert.match(source, /await fs\.mkdir\(absolutePath, \{ recursive: true \}\);/);
  assert.match(source, /await fs\.writeFile\(absolutePath, Buffer\.from\(fileEntry\.content\)\);/);
  assert.match(
    source,
    /"fs:importExternalEntries"[\s\S]*destinationDirectoryPath: string,[\s\S]*entries: ExplorerExternalImportEntryPayload\[\],[\s\S]*importExternalExplorerEntries\(\s*destinationDirectoryPath,\s*entries,\s*workspaceId,\s*\)/,
  );
  assert.match(
    source,
    /"fs:watchFile"[\s\S]*async \(_event, targetPath: string, workspaceId\?: string \| null\) =>\s*watchFilePreviewPath\(targetPath, workspaceId\)/,
  );
  assert.match(
    source,
    /"fs:unwatchFile"[\s\S]*async \(_event, subscriptionId: string\) => \{\s*closeFilePreviewWatchSubscription\(subscriptionId\);/,
  );
  assert.match(
    source,
    /"fs:renamePath"[\s\S]*targetPath: string,[\s\S]*nextName: string,[\s\S]*renameExplorerPath\(targetPath, nextName, workspaceId\)/,
  );
  assert.match(
    source,
    /"fs:movePath"[\s\S]*sourcePath: string,[\s\S]*destinationDirectoryPath: string,[\s\S]*moveExplorerPath\(sourcePath, destinationDirectoryPath, workspaceId\)/,
  );
  assert.match(
    source,
    /"fs:deletePath"[\s\S]*async \(_event, targetPath: string, workspaceId\?: string \| null\) =>\s*deleteExplorerPath\(targetPath, workspaceId\)/,
  );
  assert.match(
    source,
    /const watcher = watch\(\s*watchedDirectoryPath,\s*\{ persistent: false \},[\s\S]*emitFilePreviewChanged\(\{ absolutePath \}\);/,
  );
});

test("desktop preload exposes file preview watch subscriptions and change events", async () => {
  const source = await readFile(preloadSourcePath, "utf8");

  assert.match(source, /hasHeaderRow: boolean;/);
  assert.match(
    source,
    /createPath: \(\s*parentPath: string \| null \| undefined,\s*kind: "file" \| "directory",\s*workspaceId\?: string \| null,\s*\) =>[\s\S]*ipcRenderer\.invoke\("fs:createPath", parentPath, kind, workspaceId\) as Promise<FileSystemMutationPayload>/,
  );
  assert.match(source, /type ExplorerExternalImportEntryPayload =/);
  assert.match(
    source,
    /importExternalEntries: \(\s*destinationDirectoryPath: string,\s*entries: ExplorerExternalImportEntryPayload\[\],\s*workspaceId\?: string \| null,\s*\) =>[\s\S]*ipcRenderer\.invoke\(\s*"fs:importExternalEntries",\s*destinationDirectoryPath,\s*entries,\s*workspaceId,\s*\) as Promise<ExplorerExternalImportResultPayload>/,
  );
  assert.match(
    source,
    /writeTableFile: \(\s*targetPath: string,\s*tableSheets: FilePreviewTableSheetPayload\[\],\s*workspaceId\?: string \| null,\s*\) =>[\s\S]*ipcRenderer\.invoke\("fs:writeTableFile", targetPath, tableSheets, workspaceId\) as Promise<FilePreviewPayload>/,
  );
  assert.match(
    source,
    /watchFile: \(targetPath: string, workspaceId\?: string \| null\) =>\s*ipcRenderer\.invoke\("fs:watchFile", targetPath, workspaceId\) as Promise<FilePreviewWatchSubscriptionPayload>/,
  );
  assert.match(
    source,
    /unwatchFile: \(subscriptionId: string\) =>\s*ipcRenderer\.invoke\("fs:unwatchFile", subscriptionId\) as Promise<void>/,
  );
  assert.match(
    source,
    /movePath: \(\s*sourcePath: string,\s*destinationDirectoryPath: string,\s*workspaceId\?: string \| null,\s*\) =>[\s\S]*ipcRenderer\.invoke\("fs:movePath", sourcePath, destinationDirectoryPath, workspaceId\) as Promise<FileSystemMutationPayload>/,
  );
  assert.match(
    source,
    /onFileChange: \(listener: \(payload: FilePreviewChangePayload\) => void\) => \{\s*const wrapped = \(_event: Electron\.IpcRendererEvent, payload: FilePreviewChangePayload\) => listener\(payload\);\s*ipcRenderer\.on\("fs:fileChanged", wrapped\);\s*return \(\) => ipcRenderer\.removeListener\("fs:fileChanged", wrapped\);/,
  );
});

test("file explorer renders spreadsheet previews with the shared table editor", async () => {
  const source = await readFile(fileExplorerPaneSourcePath, "utf8");

  assert.match(
    source,
    /import \{[\s\S]*SpreadsheetEditor,[\s\S]*\} from "@\/components\/panes\/SpreadsheetEditor";/,
  );
  assert.match(
    source,
    /preview\?\.kind === "table" && activeTableSheet/,
  );
  assert.match(
    source,
    /window\.electronAPI\.fs\.writeTableFile\(\s*preview\.absolutePath,\s*tablePreviewDraft,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(
    source,
    /<SpreadsheetEditor[\s\S]*sheets=\{previewTableSheets\}[\s\S]*onChange=\{setTablePreviewDraft\}/,
  );
});
