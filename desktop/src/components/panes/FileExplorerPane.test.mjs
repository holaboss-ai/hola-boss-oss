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

test("file explorer switches folders to inline tree expansion and keeps explorer-only file opening", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /type FileExplorerVisibleRow =/,
  );
  assert.match(
    source,
    /function buildVisibleExplorerRows\(/,
  );
  assert.match(
    source,
    /const toggleDirectoryExpansion = useCallback\(\s*async \(entry: LocalFileEntry\) => \{/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => \{\s*setSelectedPath\(entry\.absolutePath\);\s*closeContextMenu\(\);\s*if \(entry\.isDirectory\) \{\s*void toggleDirectoryExpansion\(entry\);\s*return;\s*\}\s*if \(!previewInPane\) \{\s*void openFileTarget\(entry\.absolutePath\);\s*\}\s*\}\}/,
  );
  assert.match(
    source,
    /onDoubleClick=\{\(\) => \{\s*if \(!entry\.isDirectory && previewInPane\) \{\s*void openFilePreview\(entry\.absolutePath\);\s*\}\s*\}\}/,
  );
  assert.match(source, /click to \$\{isExpanded \? "collapse" : "expand"\} folder/);
  assert.match(source, /click to open file, drag into chat to attach/);
});

test("file explorer keeps drag-to-attach without using a grab cursor", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const rowClassName = `group mb-0\.5 w-full rounded-md px-2 py-1\.5 text-left transition-colors/);
  assert.match(source, /\$\{isRenaming \? "cursor-default" : "cursor-pointer"\}/);
  assert.match(source, /className="w-full min-w-0 cursor-pointer text-left"/);
  assert.match(source, /draggable=\{!entry\.isDirectory\}/);
  assert.match(source, /event\.dataTransfer\.effectAllowed = "copyMove";/);
  assert.doesNotMatch(source, /cursor-grab/);
  assert.doesNotMatch(source, /cursor-grabbing/);
});

test("file explorer keeps a minimal tree header without showing the workspace root row", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /<div className="flex items-center gap-2">[\s\S]*<div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-muted\/50 px-2\.5 py-1\.5 text-xs transition-colors focus-within:border-ring">[\s\S]*placeholder="Search files"[\s\S]*<\/div>[\s\S]*aria-label="Create new item"[\s\S]*aria-label=\{activeBookmark \? "Remove bookmark" : "Add bookmark"\}/,
  );
  assert.doesNotMatch(source, /text-\[11px\] font-medium uppercase tracking-\[0\.14em\] text-muted-foreground\/72">\s*Files\s*</);
  assert.doesNotMatch(source, /const rootFolderLabel = currentPath \? getFolderName\(currentPath\) : "Workspace";/);
  assert.doesNotMatch(source, /const isRootExpanded = normalizedQuery\.length > 0 \|\| expandedDirectoryPaths\[currentPath\] !== false;/);
  assert.doesNotMatch(source, /setExpandedDirectoryPaths\(\(current\) => \(\{\s*\.\.\.current,\s*\[currentPath\]: !isRootExpanded,\s*\}\)\);/);
  assert.doesNotMatch(source, /label="Back"/);
  assert.doesNotMatch(source, /label="Forward"/);
  assert.doesNotMatch(source, /label="Home"/);
  assert.doesNotMatch(source, /buildPathBreadcrumbs/);
  assert.doesNotMatch(source, /const \[history, setHistory\]/);
});

test("file explorer accepts one-shot focus requests for artifact files", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /export type FileExplorerFocusRequest = \{\s*path: string;\s*requestKey: number;\s*\};/);
  assert.match(
    source,
    /interface FileExplorerPaneProps \{\s*focusRequest\?: FileExplorerFocusRequest \| null;\s*onFocusRequestConsumed\?: \(requestKey: number\) => void;\s*previewInPane\?: boolean;\s*onFileOpen\?: \(path: string\) => void;\s*embedded\?: boolean;\s*\}/,
  );
  assert.match(source, /const request = focusRequest;\s*if \(lastProcessedFocusRequestKeyRef\.current === request\.requestKey\) \{\s*return;\s*\}/);
  assert.match(source, /const workspaceRoot =\s*workspaceRootPath \?\?\s*\(await window\.electronAPI\.workspace\.getWorkspaceRoot\(selectedWorkspaceId\)\);/);
  assert.match(source, /targetPath = resolveWorkspaceTargetPath\(workspaceRoot, targetPath\);/);
  assert.match(source, /const revealPathInTree = useCallback\(/);
  assert.match(source, /await openFileTarget\(targetPath, \{ syncDirectory: true \}\);/);
  assert.match(source, /onFocusRequestConsumed\?\.\(request\.requestKey\);/);
});

test("file explorer adds a markdown preview mode while keeping text editing inline", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /import \{ SimpleMarkdown \} from "@\/components\/marketplace\/SimpleMarkdown";/);
  assert.match(source, /const MARKDOWN_PREVIEW_EXTENSIONS = new Set\(\[\s*"\.md",\s*"\.mdx",\s*"\.markdown"\s*\]\);/);
  assert.match(source, /const HTML_PREVIEW_EXTENSIONS = new Set\(\[\s*"\.html",\s*"\.htm"\s*\]\);/);
  assert.match(source, /type TextPreviewMode = "edit" \| "preview";/);
  assert.match(
    source,
    /const \[textPreviewMode, setTextPreviewMode\]\s*=\s*useState<TextPreviewMode>\("edit"\);/,
  );
  assert.match(source, /function isHtmlPreviewPayload\(/);
  assert.match(
    source,
    /const prefersRenderedTextPreview =\s*isMarkdownPreviewPayload\(payload\) \|\| isHtmlPreviewPayload\(payload\);\s*setTextPreviewMode\(prefersRenderedTextPreview \? "preview" : "edit"\);/,
  );
  assert.match(
    source,
    /const showInlinePreview =\s*previewInPane && Boolean\(preview \|\| previewLoading \|\| previewError\);/,
  );
  assert.match(source, /const explorerPane = embedded \? \(\s*content\s*\) : \(/);
  assert.match(source, /title=\{showInlinePreview \? "File" : ""\}/);
  assert.match(source, /preview\?\.kind === "text" \? \(/);
  assert.match(source, /isMarkdownPreview && textPreviewMode === "preview"/);
  assert.match(source, /<SimpleMarkdown[\s\S]*className="chat-markdown text-sm leading-7 text-foreground"[\s\S]*onLinkClick=\{openPreviewLink\}[\s\S]*\{previewDraft\}[\s\S]*<\/SimpleMarkdown>/);
  assert.match(source, /const supportsRenderedTextPreview = isMarkdownPreview \|\| isHtmlPreview;/);
  assert.match(source, /readOnly=\{!preview\.isEditable\}/);
  assert.match(source, />\s*Preview\s*<\/button>/);
  assert.match(source, />\s*Edit\s*<\/button>/);
  assert.match(source, /window\.electronAPI\.ui\.openExternalUrl\(url\)/);
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

test("file explorer renders html files inside a sandboxed iframe preview", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const isHtmlPreview = isHtmlPreviewPayload\(preview\);/);
  assert.match(source, /isHtmlPreview && textPreviewMode === "preview"/);
  assert.match(source, /<iframe[\s\S]*title=\{preview\.name\}[\s\S]*sandbox=""[\s\S]*srcDoc=\{previewDraft\}[\s\S]*className="h-full w-full rounded-lg border border-border bg-white"/);
  assert.match(source, /Empty file — switch to Edit to add markup\./);
});

test("file explorer renders editable spreadsheet previews", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /import \{[\s\S]*SpreadsheetEditor,[\s\S]*\} from "@\/components\/panes\/SpreadsheetEditor";/);
  assert.match(
    source,
    /const \[tablePreviewDraft, setTablePreviewDraft\] = useState<[\s\S]*FilePreviewTableSheetPayload\[\][\s\S]*>\(\[\]\);/,
  );
  assert.match(
    source,
    /preview\?\.kind === "table" && preview\.isEditable[\s\S]*!areTablePreviewSheetsEqual\(tablePreviewDraft, preview\.tableSheets\)/,
  );
  assert.match(source, /setTablePreviewDraft\(cloneTablePreviewSheets\(payload\.tableSheets\)\);/);
  assert.match(source, /window\.electronAPI\.fs\.writeTableFile\(\s*preview\.absolutePath,\s*tablePreviewDraft,\s*selectedWorkspaceId \?\? null,\s*\)/);
  assert.match(
    source,
    /<SpreadsheetEditor[\s\S]*sheets=\{previewTableSheets\}[\s\S]*editable=\{preview\.isEditable\}[\s\S]*onChange=\{setTablePreviewDraft\}/,
  );
});

test("file explorer preview metadata omits the absolute file path", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(
    source,
    /\{preview\?\.absolutePath \? <span>\{preview\.absolutePath\}<\/span> : null\}/,
  );
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
  assert.match(
    source,
    /const \[contextMenu, setContextMenu\]\s*=\s*useState<FileExplorerContextMenuState \| null>\(null\);/,
  );
  assert.match(source, /const \[renamingPath, setRenamingPath\] = useState<string \| null>\(null\);/);
  assert.match(source, /const \[renameDraft, setRenameDraft\] = useState\(""\);/);
  assert.match(source, /const openEntryContextMenu = useCallback\(/);
  assert.match(
    source,
    /onContextMenu=\{\(event\) => \{\s*event\.preventDefault\(\);\s*if \(isRenaming\) \{\s*return;\s*\}\s*openEntryContextMenu\(entry,\s*\{\s*x: event\.clientX,\s*y: event\.clientY,\s*\}\);\s*\}\}/,
  );
  assert.match(source, /aria-label=\{`More actions for \$\{entry\.name\}`\}/);
  assert.match(
    source,
    /openEntryContextMenu\(entry,\s*\{\s*anchorRect:\s*event\.currentTarget\.getBoundingClientRect\(\),\s*\}\);/,
  );
  assert.match(source, /group-hover:pointer-events-auto group-hover:opacity-100/);
  assert.match(
    source,
    /const menuWidth = Math\.min\(\s*196,\s*Math\.max\(160, contextMenu\.paneBounds\.width - 16\),\s*\);/,
  );
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
  assert.match(source, /const refreshDirectoryEntries = useCallback\(/);
  assert.match(
    source,
    /const parentPath =\s*getParentFolderPath\(renamingEntry\.absolutePath\)\s*\?\?\s*currentPathRef\.current;/,
  );
  assert.match(
    source,
    /window\.electronAPI\.fs\.deletePath\(\s*entry\.absolutePath,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(source, /Rename…/);
  assert.match(source, /Delete…/);
});

test("file explorer can create new files and folders at the selected directory target", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const creationTargetDirectoryPath = selectedEntry\?\.isDirectory[\s\S]*getParentFolderPath\(selectedEntry\.absolutePath\) \?\? currentPath[\s\S]*: currentPath;/,
  );
  assert.match(source, /aria-label="Create new item"/);
  assert.match(source, /<DropdownMenuContent align="end" sideOffset=\{6\} className="w-40">/);
  assert.match(
    source,
    /window\.electronAPI\.fs\.createPath\(\s*normalizedTargetDirectoryPath,\s*kind,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(source, /setRenamingPath\(payload\.absolutePath\);/);
  assert.match(source, /setRenameDraft\(getFolderName\(payload\.absolutePath\)\);/);
  assert.match(source, /New file/);
  assert.match(source, /New folder/);
});

test("file explorer can move dragged files into folder rows", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const \[draggedEntryPath, setDraggedEntryPath\] = useState<string \| null>\(null\);/,
  );
  assert.match(
    source,
    /const \[directoryDropTargetPath, setDirectoryDropTargetPath\] = useState<[\s\S]*string \| null[\s\S]*>\(null\);/,
  );
  assert.match(source, /const canDropDraggedEntryIntoDirectory = useCallback\(/);
  assert.match(source, /event\.dataTransfer\.dropEffect = "move";/);
  assert.match(
    source,
    /void moveEntryToDirectory\(\s*draggedEntryPath,\s*entry\.absolutePath,\s*\);/,
  );
  assert.match(
    source,
    /window\.electronAPI\.fs\.movePath\(\s*normalizedSourcePath,\s*normalizedDestinationDirectoryPath,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(
    source,
    /setExpandedDirectoryPaths\(\(current\) => \(\{\s*\.\.\.current,\s*\[normalizedDestinationDirectoryPath\]: true,\s*\}\)\);/,
  );
  assert.match(
    source,
    /await Promise\.all\(\s*refreshTargets\.map\(\(targetPath\) => refreshDirectoryEntries\(targetPath\)\),\s*\);/,
  );
});

test("file explorer does not expose a pane-level close action", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /interface FileExplorerPaneProps \{\s*focusRequest\?: FileExplorerFocusRequest \| null;\s*onFocusRequestConsumed\?: \(requestKey: number\) => void;\s*previewInPane\?: boolean;\s*onFileOpen\?: \(path: string\) => void;\s*embedded\?: boolean;\s*\}/,
  );
  assert.match(
    source,
    /export function FileExplorerPane\(\{\s*focusRequest = null,\s*onFocusRequestConsumed,\s*previewInPane = true,\s*onFileOpen,\s*embedded = false,\s*}: FileExplorerPaneProps\)/,
  );
  assert.doesNotMatch(source, /label="Close file explorer"/);
  assert.doesNotMatch(source, /icon=\{<X size=\{1[23]\} \/>/);
});
