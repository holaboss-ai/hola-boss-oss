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
    /lastSyncedWorkspaceRootRef\.current = \{\s*workspaceId: selectedWorkspaceId,\s*rootPath: workspaceRoot\s*\};/
  );
  assert.match(source, /\}, \[loadDirectory, selectedWorkspaceId\]\);/);
  assert.doesNotMatch(source, /\}, \[currentPath, loadDirectory, selectedWorkspaceId\]\);/);
  assert.doesNotMatch(source, /currentPath === workspaceRoot/);
});

test("file explorer polls the current directory to surface live file changes", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const payload = await window\.electronAPI\.fs\.listDirectory\(currentPath\);/);
  assert.match(source, /const timer = window\.setInterval\(\(\) => \{\s*void refreshCurrentDirectory\(\);\s*\}, 1200\);/);
  assert.match(source, /window\.clearInterval\(timer\);/);
  assert.match(source, /\}, \[currentPath\]\);/);
});

test("file explorer opens folders on double click instead of single click", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /onClick=\{\(\) => \{\s*setSelectedPath\(entry\.absolutePath\);\s*\}\}/);
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

test("file explorer disables up navigation when already at workspace root", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const \[workspaceRootPath, setWorkspaceRootPath\] = useState<string \| null>\(null\);/);
  assert.match(
    source,
    /const isAtWorkspaceRoot = workspaceRootPath[\s\S]*normalizeComparablePath\(currentPath\) === normalizeComparablePath\(workspaceRootPath\)/
  );
  assert.match(
    source,
    /label="Up"[\s\S]*onClick=\{\(\) => parentPath && !isAtWorkspaceRoot && void openPath\(parentPath\)\}[\s\S]*disabled=\{!parentPath \|\| isAtWorkspaceRoot\}/
  );
  assert.match(source, /label="Home"[\s\S]*disabled=\{isAtWorkspaceRoot\}/);
});

test("file explorer accepts one-shot focus requests for artifact files", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /export type FileExplorerFocusRequest = \{\s*path: string;\s*requestKey: number;\s*\};/);
  assert.match(source, /interface FileExplorerPaneProps \{\s*focusRequest\?: FileExplorerFocusRequest \| null;\s*onFocusRequestConsumed\?: \(requestKey: number\) => void;\s*\}/);
  assert.match(source, /if \(lastProcessedFocusRequestKeyRef\.current === focusRequest\.requestKey\) \{\s*return;\s*\}/);
  assert.match(source, /const workspaceRoot =\s*workspaceRootPath \?\?\s*\(await window\.electronAPI\.workspace\.getWorkspaceRoot\(selectedWorkspaceId\)\);/);
  assert.match(source, /targetPath = resolveWorkspaceTargetPath\(workspaceRoot, targetPath\);/);
  assert.match(source, /await openFilePreview\(targetPath, \{ syncDirectory: true \}\);/);
  assert.match(source, /onFocusRequestConsumed\?\.\(focusRequest\.requestKey\);/);
});
