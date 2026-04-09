import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "FileExplorerPane.tsx");

test("file explorer syncs the workspace root only when the selected workspace changes", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const lastSyncedWorkspaceRootRef = useRef<\{ workspaceId: string; rootPath: string \} \| null>\(null\);/);
  assert.match(
    source,
    /window\.electronAPI\.fs\.listDirectory\(\s*targetPath \?\? null,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(
    source,
    /lastSyncedWorkspaceRootRef\.current = \{\s*workspaceId: selectedWorkspaceId,\s*rootPath: workspaceRoot\s*\};/
  );
  assert.match(source, /\}, \[loadDirectory, selectedWorkspaceId\]\);/);
  assert.doesNotMatch(source, /\}, \[currentPath, loadDirectory, selectedWorkspaceId\]\);/);
  assert.doesNotMatch(source, /currentPath === workspaceRoot/);
});

test("file explorer polls the current directory to surface live file changes", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const payload = await window\.electronAPI\.fs\.listDirectory\(\s*currentPath,\s*selectedWorkspaceId \?\? null,\s*\);/,
  );
  assert.match(source, /const timer = window\.setInterval\(\(\) => \{\s*void refreshCurrentDirectory\(\);\s*\}, 1200\);/);
  assert.match(source, /window\.clearInterval\(timer\);/);
  assert.match(source, /\}, \[currentPath, selectedWorkspaceId\]\);/);
});

test("file explorer opens folders on double click instead of single click", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /onClick=\{\(\) => \{\s*setSelectedPath\(entry\.absolutePath\);\s*closeContextMenu\(\);\s*\}\}/);
  assert.match(
    source,
    /onDoubleClick=\{\(\) => \{\s*if \(entry\.isDirectory\) \{\s*void openPath\(entry\.absolutePath\);\s*return;\s*\}\s*void openFilePreview\(entry\.absolutePath\);\s*\}\}/
  );
  assert.match(source, /double-click to open folder/);
});

test("file explorer home opens the selected workspace root when available", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const openHomeDirectory = async \(\) => \{/);
  assert.match(source, /const workspaceRoot = await window\.electronAPI\.workspace\.getWorkspaceRoot\(selectedWorkspaceId\);/);
  assert.match(source, /await loadDirectory\(workspaceRoot, true\);/);
  assert.match(source, /await loadDirectory\(null, true\);/);
  assert.match(source, /onClick=\{\(\) => \{\s*void openHomeDirectory\(\);\s*\}\}/);
});

test("file explorer uses breadcrumbs and home instead of a separate up button", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const \[workspaceRootPath, setWorkspaceRootPath\] = useState<string \| null>\(null\);/);
  assert.match(
    source,
    /const isAtWorkspaceRoot = workspaceRootPath[\s\S]*normalizeComparablePath\(currentPath\) === normalizeComparablePath\(workspaceRootPath\)/
  );
  assert.doesNotMatch(source, /label="Up"/);
  assert.doesNotMatch(source, /ArrowUp/);
  assert.match(source, /label="Home"[\s\S]*disabled=\{isAtWorkspaceRoot\}/);
});

test("file explorer renders clickable breadcrumbs scoped to the current path", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /type FileExplorerBreadcrumb = \{/);
  assert.match(source, /function buildPathBreadcrumbs\(/);
  assert.match(
    source,
    /const breadcrumbs = useMemo\(\s*\(\) => buildPathBreadcrumbs\(currentPath, workspaceRootPath\),\s*\[currentPath, workspaceRootPath\],\s*\);/,
  );
  assert.match(source, /chat-scrollbar-hidden mt-1\.5 flex items-center gap-1 overflow-x-auto/);
  assert.match(source, /breadcrumbs\.map\(\(breadcrumb\) => \(/);
  assert.match(source, /<ChevronRight size=\{10\}/);
  assert.match(
    source,
    /onClick=\{\(\) => \{\s*void openPath\(breadcrumb\.absolutePath\);\s*\}\}/,
  );
});

test("file explorer accepts one-shot focus requests for artifact files", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /export type FileExplorerFocusRequest = \{\s*path: string;\s*requestKey: number;\s*\};/);
  assert.match(source, /interface FileExplorerPaneProps \{\s*focusRequest\?: FileExplorerFocusRequest \| null;\s*onFocusRequestConsumed\?: \(requestKey: number\) => void;\s*onClosePane\?: \(\(\) => void\) \| undefined;\s*\}/);
  assert.match(source, /const request = focusRequest;\s*if \(lastProcessedFocusRequestKeyRef\.current === request\.requestKey\) \{\s*return;\s*\}/);
  assert.match(source, /const workspaceRoot =\s*workspaceRootPath \?\?\s*\(await window\.electronAPI\.workspace\.getWorkspaceRoot\(selectedWorkspaceId\)\);/);
  assert.match(source, /targetPath = resolveWorkspaceTargetPath\(workspaceRoot, targetPath\);/);
  assert.match(source, /await openFilePreview\(targetPath, \{ syncDirectory: true \}\);/);
  assert.match(source, /onFocusRequestConsumed\?\.\(request\.requestKey\);/);
});

test("file explorer opens text files directly in the editor without a preview toggle", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(source, /type TextPreviewMode/);
  assert.doesNotMatch(source, /textPreviewMode/);
  assert.doesNotMatch(source, /getHighlightedHtml/);
  assert.doesNotMatch(source, /Loading preview/);
  assert.match(source, /title=\{preview \|\| previewLoading \|\| previewError \? "File" : ""\}/);
  assert.match(source, /preview\?\.kind === "text" \? \(/);
  assert.match(source, /readOnly=\{!preview\.isEditable\}/);
  assert.match(source, /embedded-input focus:border-border\/70/);
  assert.doesNotMatch(source, /focus:bg-background\/35/);
  assert.match(
    source,
    /window\.electronAPI\.fs\.readFilePreview\(\s*targetPath,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(
    source,
    /window\.electronAPI\.fs\.writeTextFile\(\s*preview\.absolutePath,\s*previewDraft,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(source, /Save/);
});

test("file explorer warns users to save before leaving an unsaved file", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /You have unsaved changes\. Press Cancel to go back and save them, or OK to discard them\./,
  );
  assert.match(source, /if \(!skipConfirm && !confirmDiscardIfDirty\(\)\) \{\s*return;\s*\}/);
  assert.match(source, /if \(!confirmDiscardIfDirty\(\)\) \{\s*return;\s*\}\s*setPreview\(null\);/);
});

test("file explorer assigns richer icons for common file types", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /FileBadge2,[\s\S]*FileSpreadsheet,[\s\S]*FileVideoCamera,[\s\S]*Shield,/);
  assert.match(source, /const SPECIAL_POLICY_FILENAMES = new Set\(\[\s*"agents\.md"\s*\]\);/);
  assert.match(source, /const normalizedFileName = getComparableFileName\(targetName\);/);
  assert.match(source, /if \(SPECIAL_POLICY_FILENAMES\.has\(normalizedFileName\)\) \{\s*return \{\s*Icon: Shield,/);
  assert.match(source, /if \(SPREADSHEET_EXTENSIONS\.has\(extension\)\) \{\s*return \{\s*Icon: FileSpreadsheet,/);
  assert.match(source, /if \(extension === ".pdf"\) \{\s*return \{\s*Icon: FileBadge2,/);
  assert.match(source, /if \(JSON_EXTENSIONS\.has\(extension\)\) \{\s*return \{\s*Icon: FileJson,/);
  assert.match(source, /const \{ Icon, className \} = getExplorerIconDescriptor\(\s*entry\.name,\s*entry\.isDirectory\s*\);/);
});

test("file explorer exposes right-click rename and delete actions for entries", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /type FileExplorerContextMenuState = \{/);
  assert.match(source, /const \[contextMenu, setContextMenu\] = useState<FileExplorerContextMenuState \| null>\(null\);/);
  assert.match(source, /const \[renamingPath, setRenamingPath\] = useState<string \| null>\(null\);/);
  assert.match(source, /const \[renameDraft, setRenameDraft\] = useState\(""\);/);
  assert.match(source, /const paneRect = containerRef\.current\?\.getBoundingClientRect\(\);/);
  assert.match(
    source,
    /onContextMenu=\{\(event\) => \{\s*event\.preventDefault\(\);\s*const paneRect = containerRef\.current\?\.getBoundingClientRect\(\);\s*if \(!paneRect\) \{\s*return;\s*\}\s*setSelectedPath\(entry\.absolutePath\);\s*setContextMenu\(\{\s*entry,\s*x: event\.clientX,\s*y: event\.clientY,[\s\S]*paneBounds:/,
  );
  assert.match(source, /const menuWidth = Math\.min\(196, Math\.max\(160, contextMenu\.paneBounds\.width - 16\)\);/);
  assert.match(source, /contextMenu\.paneBounds\.right - menuWidth - 8/);
  assert.match(source, /contextMenu\.paneBounds\.bottom - menuHeight - 8/);
  assert.match(source, /setRenamingPath\(entry\.absolutePath\);/);
  assert.match(source, /setRenameDraft\(entry\.name\);/);
  assert.match(source, /ref=\{renameInputRef\}/);
  assert.match(source, /onBlur=\{\(\) => \{\s*void submitRenameEntry\(\);\s*\}\}/);
  assert.match(source, /if \(event\.key === "Enter"\) \{\s*event\.preventDefault\(\);\s*void submitRenameEntry\(\);/);
  assert.match(source, /if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*cancelRenameEntry\(\);/);
  assert.doesNotMatch(source, /window\.prompt/);
  assert.match(source, /Delete folder "\$\{entry\.name\}" and all of its contents\? This cannot be undone\./);
  assert.match(
    source,
    /window\.electronAPI\.fs\.renamePath\(\s*renamingEntry\.absolutePath,\s*nextName,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(
    source,
    /window\.electronAPI\.fs\.deletePath\(\s*entry\.absolutePath,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(source, /Rename…/);
  assert.match(source, /Delete…/);
});

test("file explorer exposes an optional close action for both preview and list modes", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /interface FileExplorerPaneProps \{\s*focusRequest\?: FileExplorerFocusRequest \| null;\s*onFocusRequestConsumed\?: \(requestKey: number\) => void;\s*onClosePane\?: \(\(\) => void\) \| undefined;\s*\}/);
  assert.match(source, /export function FileExplorerPane\(\{\s*focusRequest = null,\s*onFocusRequestConsumed,\s*onClosePane,\s*}: FileExplorerPaneProps\)/);
  assert.match(source, /label="Close file explorer"/);
});
