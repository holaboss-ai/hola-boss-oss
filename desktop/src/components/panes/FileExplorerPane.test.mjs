import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "FileExplorerPane.tsx");

test("file explorer syncs the workspace root only when the selected workspace changes", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const lastSyncedWorkspaceRootRef = useRef<\{[\s\S]*workspaceId: string;[\s\S]*rootPath: string;[\s\S]*\} \| null>\(null\);/,
  );
  assert.match(
    source,
    /window\.electronAPI\.fs\.listDirectory\(\s*targetPath \?\? null,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(
    source,
    /lastSyncedWorkspaceRootRef\.current = \{\s*workspaceId: selectedWorkspaceId,\s*rootPath: workspaceRoot,\s*\};/
  );
  assert.match(source, /\}, \[loadDirectory, selectedWorkspaceId\]\);/);
  assert.doesNotMatch(source, /\}, \[currentPath, loadDirectory, selectedWorkspaceId\]\);/);
  assert.doesNotMatch(source, /currentPath === workspaceRoot/);
});

test("file explorer refreshes the current directory and expanded folders to surface live file changes", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const refreshTargets = \[\s*currentPath,\s*\.\.\.Object\.entries\(expandedDirectoryPaths\)[\s\S]*\.filter\(\s*\(\[, isExpanded\]\) => isExpanded\s*\)[\s\S]*\.map\(\(\[targetPath\]\) => targetPath\),\s*\]\.filter\(/,
  );
  assert.match(source, /const refreshedDirectories = await Promise\.allSettled\(/);
  assert.match(source, /refreshTargets\.map\(\(targetPath\) =>/);
  assert.match(
    source,
    /window\.electronAPI\.fs\.listDirectory\(\s*targetPath,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(
    source,
    /setDirectoryEntriesByPath\(\(current\) => \(\{\s*\.\.\.current,\s*\.\.\.refreshedEntriesByPath,\s*\}\)\);/,
  );
  assert.match(source, /const timer = window\.setInterval\(\(\) => \{\s*void refreshLoadedDirectories\(\);\s*\}, 1200\);/);
  assert.match(source, /window\.clearInterval\(timer\);/);
  assert.match(source, /\}, \[currentPath, expandedDirectoryPaths, selectedWorkspaceId\]\);/);
});

test("file explorer live-refreshes inline previews from file watch events without overwriting dirty edits", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const isDirtyRef = useRef\(false\);/);
  assert.match(source, /const isSavingRef = useRef\(false\);/);
  assert.match(source, /isDirtyRef\.current = isDirty;/);
  assert.match(source, /isSavingRef\.current = saving;/);
  assert.match(
    source,
    /const watchedPath = preview\?\.absolutePath\?\.trim\(\) \|\| "";\s*if \(!previewInPane \|\| !watchedPath\) \{\s*return;\s*\}/,
  );
  assert.match(
    source,
    /window\.electronAPI\.fs\.onFileChange\(\(payload\) => \{\s*if \(\s*normalizeComparablePath\(payload\.absolutePath\) !==\s*normalizeComparablePath\(watchedPath\)\s*\) \{\s*return;\s*\}\s*void refreshPreviewFromDisk\(\);\s*\}\);/,
  );
  assert.match(
    source,
    /window\.electronAPI\.fs[\s\S]*\.watchFile\(/,
  );
  assert.match(source, /watchedPath,\s*selectedWorkspaceId \?\? null/);
  assert.match(
    source,
    /if \(\s*cancelled \|\|\s*refreshInFlight \|\|\s*isDirtyRef\.current \|\|\s*isSavingRef\.current\s*\) \{\s*return;\s*\}/,
  );
  assert.match(
    source,
    /const nextPreview = await window\.electronAPI\.fs\.readFilePreview\(\s*watchedPath,\s*selectedWorkspaceId \?\? null,\s*\);[\s\S]*setPreview\(nextPreview\);[\s\S]*setPreviewDraft\(nextPreview\.content \?\? ""\);/,
  );
  assert.match(source, /void window\.electronAPI\.fs\.unwatchFile\(subscriptionId\);/);
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
  assert.match(source, /click to open file, use @ to attach in chat/);
});

test("file explorer adds explicit @ references and keeps drag gestures scoped to internal moves", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /import \{\s*inferDraggedAttachmentKind,\s*\} from "@\/lib\/attachmentDrag";/);
  assert.match(source, /function buildChatReferenceText\(/);
  assert.match(source, /const entryIsProtected = isProtectedWorkspacePath\(\s*workspaceRootPath,\s*entry\.absolutePath,\s*\);/);
  assert.match(source, /const referenceEntryInChat = useCallback\(/);
  assert.match(
    source,
    /const referenceText = buildChatReferenceText\(\s*workspaceRootPath,\s*entry\.absolutePath,\s*\);/,
  );
  assert.match(source, /onReferenceInChat\?\.\(entry, referenceText\);/);
  assert.match(
    source,
    /aria-label=\{\s*entry\.isDirectory\s*\?\s*`Reference \$\{entry\.name\} in chat`\s*:\s*`Attach \$\{entry\.name\} to chat`\s*\}/,
  );
  assert.match(source, /<AtSign size=\{12\} \/>/);
  assert.match(source, /const EXPLORER_INTERNAL_MOVE_DRAG_TYPE =\s*"application\/x-holaboss-file-explorer-move";/);
  assert.match(source, /const rowClassName = `group mb-0\.5 w-full rounded-md px-2 py-1\.5 text-left transition-colors/);
  assert.match(source, /\$\{isRenaming \? "cursor-default" : "cursor-pointer"\}/);
  assert.match(source, /className="w-full min-w-0 cursor-pointer text-left"/);
  assert.match(source, /draggable=\{!entry\.isDirectory && !entryIsProtected\}/);
  assert.match(source, /event\.dataTransfer\.effectAllowed = "move";/);
  assert.match(
    source,
    /event\.dataTransfer\.setData\(\s*EXPLORER_INTERNAL_MOVE_DRAG_TYPE,\s*entry\.absolutePath,\s*\);/,
  );
  assert.match(source, /if \(entry\.isDirectory \|\| entryIsProtected\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/);
  assert.match(source, /const preview = createAttachmentDragPreview\(entry\);/);
  assert.doesNotMatch(source, /serializeExplorerAttachmentDragPayload/);
  assert.doesNotMatch(source, /EXPLORER_ATTACHMENT_DRAG_TYPE/);
  assert.doesNotMatch(source, /event\.dataTransfer\.setData\(\s*"text\/plain"/);
  assert.doesNotMatch(source, /cursor-grab/);
  assert.doesNotMatch(source, /cursor-grabbing/);
});

test("file explorer groups protected workspace system entries into a dedicated root section", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /type FileExplorerVisibleSection = \{/);
  assert.match(source, /id: "protected" \| "workspace";/);
  assert.match(source, /rows: FileExplorerVisibleRow\[];/);
  assert.match(source, /function isWorkspaceRootExplorerView\(/);
  assert.match(
    source,
    /if \(!isWorkspaceRootExplorerView\(currentPath, workspaceRootPath\)\) \{\s*return \[\s*\{\s*id: "workspace" as const,\s*rows: buildRows\(entries\),\s*\},\s*\];\s*\}/,
  );
  assert.match(
    source,
    /const protectedRootEntries = entries\.filter\(\(entry\) =>\s*isProtectedWorkspacePath\(workspaceRootPath, entry\.absolutePath\),\s*\);/,
  );
  assert.match(
    source,
    /sections\.push\(\{\s*id: "protected",\s*rows: protectedRows,\s*\}\);/,
  );
  assert.match(
    source,
    /const visibleRows = useMemo\(\s*\(\) => filteredEntries\.flatMap\(\(section\) => section\.rows\),\s*\[filteredEntries\],\s*\);/,
  );
  assert.doesNotMatch(source, /label: "System"/);
  assert.doesNotMatch(source, /badgeLabel: "Protected"/);
  assert.doesNotMatch(source, /No rename, move, or delete\./);
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
    /interface FileExplorerPaneProps \{\s*focusRequest\?: FileExplorerFocusRequest \| null;\s*onFocusRequestConsumed\?: \(requestKey: number\) => void;\s*previewInPane\?: boolean;\s*onFileOpen\?: \(path: string\) => void;\s*onReferenceInChat\?: \(entry: LocalFileEntry, referenceText: string\) => void;\s*onOpenLinkInBrowser\?: \(url: string\) => void;\s*embedded\?: boolean;\s*\}/,
  );
  assert.match(source, /const request = focusRequest;\s*if \(lastProcessedFocusRequestKeyRef\.current === request\.requestKey\) \{\s*return;\s*\}/);
  assert.match(
    source,
    /const workspaceRoot =[\s\S]*workspaceRootPath \?\?[\s\S]*await window\.electronAPI\.workspace\.getWorkspaceRoot\(\s*selectedWorkspaceId,\s*\)\);/,
  );
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
  assert.match(source, />\s*Preview\s*<\/Button>/);
  assert.match(source, />\s*Edit\s*<\/Button>/);
  assert.match(source, /if \(onOpenLinkInBrowser\) \{\s*onOpenLinkInBrowser\(url\);\s*return;\s*\}/);
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

  assert.match(source, /FileBadge2,/);
  assert.match(source, /FileSpreadsheet,/);
  assert.match(source, /FileVideoCamera,/);
  assert.match(source, /Shield,/);
  assert.match(source, /const SPECIAL_POLICY_FILENAMES = new Set\(\[\s*"agents\.md"\s*\]\);/);
  assert.match(source, /const normalizedFileName = getComparableFileName\(targetName\);/);
  assert.match(source, /if \(SPECIAL_POLICY_FILENAMES\.has\(normalizedFileName\)\) \{\s*return \{\s*Icon: Shield,/);
  assert.match(source, /if \(SPREADSHEET_EXTENSIONS\.has\(extension\)\) \{\s*return \{\s*Icon: FileSpreadsheet,/);
  assert.match(source, /if \(extension === ".pdf"\) \{\s*return \{\s*Icon: FileBadge2,/);
  assert.match(source, /if \(JSON_EXTENSIONS\.has\(extension\)\) \{\s*return \{\s*Icon: FileJson,/);
  assert.match(
    source,
    /const \{ Icon, className \} = getExplorerIconDescriptor\(\s*entry\.name,\s*entry\.isDirectory,\s*\);/,
  );
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
  assert.match(source, /disabled=\{!creationTargetDirectoryPath \|\| renameSaving\}/);
  assert.match(source, /setRenamingPath\(payload\.absolutePath\);/);
  assert.match(source, /setRenameDraft\(getFolderName\(payload\.absolutePath\)\);/);
  assert.match(source, /New file/);
  assert.match(source, /New folder/);
});

test("file explorer blocks renaming deleting and moving protected system entries", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function getProtectedWorkspacePathLabel\(/);
  assert.match(source, /function protectedWorkspacePathMessage\(/);
  assert.match(source, /function isProtectedWorkspacePath\(/);
  assert.match(
    source,
    /if \(relativePath === "workspace\.yaml"\) \{\s*return "workspace\.yaml";\s*\}/,
  );
  assert.match(
    source,
    /if \(relativePath === "agents\.md"\) \{\s*return "AGENTS\.md";\s*\}/,
  );
  assert.match(
    source,
    /if \(relativePath === "skills"\) \{\s*return "skills";\s*\}/,
  );
  assert.doesNotMatch(source, /relativePath\.startsWith\("skills\/"\)/);
  assert.match(
    source,
    /const protectedMessage = protectedWorkspacePathMessage\(\s*workspaceRootPath,\s*entry\.absolutePath,\s*\);\s*if \(protectedMessage\) \{\s*closeContextMenu\(\);\s*setError\(protectedMessage\);\s*return;\s*\}/,
  );
  assert.match(
    source,
    /const protectedMessage =\s*protectedWorkspacePathMessage\(workspaceRootPath, normalizedSourcePath\) \|\|\s*protectedWorkspacePathMessage\(\s*workspaceRootPath,\s*normalizedDestinationDirectoryPath,\s*\);\s*if \(protectedMessage\) \{\s*setError\(protectedMessage\);\s*return;\s*\}/,
  );
  assert.match(
    source,
    /if \(\s*isProtectedWorkspacePath\(workspaceRootPath, normalizedDraggedEntryPath\) \|\|\s*isProtectedWorkspacePath\(workspaceRootPath, normalizedTargetPath\)\s*\) \{\s*return false;\s*\}/,
  );
  assert.match(
    source,
    /disabled=\{contextMenuEntryIsProtected\}[\s\S]*Rename…[\s\S]*disabled=\{contextMenuEntryIsProtected\}[\s\S]*Delete…/,
  );
  assert.match(
    source,
    /The skills folder cannot be renamed, moved, or deleted from the file explorer\./,
  );
  assert.match(
    source,
    /return `\$\{protectedPathLabel\} cannot be renamed, moved, or deleted from the file explorer\.`;/,
  );
  assert.doesNotMatch(source, /creationTargetDirectoryIsProtected/);
  assert.doesNotMatch(source, /contextMenuTargetDirectoryIsProtected/);
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
  assert.match(
    source,
    /event\.dataTransfer\.dropEffect = canMoveDraggedEntry\s*\?\s*"move"\s*:\s*"copy";/,
  );
  assert.match(
    source,
    /entry\.isDirectory &&\s*hasExternalExplorerDropData\(event\.dataTransfer\)/,
  );
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

test("file explorer imports dragged external files and folders into the tree", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /type ExplorerExternalImportEntry =/);
  assert.match(source, /webkitGetAsEntry\?: \(\) => ExplorerExternalDropEntry \| null;/);
  assert.match(source, /async function collectDroppedExternalEntriesFromEntry\(/);
  assert.match(
    source,
    /const childEntries = await readExternalDropDirectoryEntries\(\s*entry as FileSystemDirectoryEntry,\s*\);/,
  );
  assert.match(source, /content: new Uint8Array\(await file\.arrayBuffer\(\)\),/);
  assert.match(source, /function hasExternalExplorerDropData\(dataTransfer: DataTransfer \| null\)/);
  assert.match(source, /const \[paneExternalDropTarget, setPaneExternalDropTarget\] = useState\(false\);/);
  assert.match(source, /const importExternalEntriesToDirectory = useCallback\(/);
  assert.match(
    source,
    /window\.electronAPI\.fs\.importExternalEntries\(\s*normalizedDestinationDirectoryPath,\s*importedEntries,\s*selectedWorkspaceId \?\? null,\s*\)/,
  );
  assert.match(
    source,
    /const refreshTargets = \[\s*normalizedDestinationDirectoryPath\s*\]\.filter\(/,
  );
  assert.match(source, /event\.dataTransfer\.dropEffect = canMoveDraggedEntry\s*\?\s*"move"\s*:\s*"copy";/);
  assert.match(
    source,
    /entry\.isDirectory &&\s*hasExternalExplorerDropData\(event\.dataTransfer\)/,
  );
  assert.match(
    source,
    /void importExternalEntriesToDirectory\(\s*event\.dataTransfer,\s*entry\.absolutePath,\s*\);/,
  );
  assert.match(
    source,
    /className=\{`chat-scrollbar-hidden min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1\.5 pb-1\.5 pt-1 \$\{[\s\S]*paneExternalDropTarget[\s\S]*"rounded-md bg-emerald-500\/10 ring-1 ring-emerald-500\/30"[\s\S]*\}`\}/,
  );
  assert.match(source, /onDragOver=\{onPaneDragOver\}/);
  assert.match(source, /onDrop=\{onPaneDrop\}/);
});

test("file explorer preserves multi-file external drops when entry-backed items are incomplete", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function droppedFileRelativePath\(file: File\)/);
  assert.match(
    source,
    /"webkitRelativePath" in file && typeof file\.webkitRelativePath === "string"/,
  );
  assert.match(source, /const file = item\.getAsFile\(\);/);
  assert.match(
    source,
    /if \(importedEntries\.length === 0\) \{\s*return dedupeExplorerExternalImportEntries\(fileEntries\);\s*\}/,
  );
  assert.match(
    source,
    /const hasImportedDirectories = importedEntries\.some\(\s*\(entry\) => entry\.kind === "directory",\s*\);/,
  );
  assert.match(
    source,
    /if \(hasImportedDirectories\) \{\s*return dedupeExplorerExternalImportEntries\(importedEntries\);\s*\}/,
  );
  assert.match(
    source,
    /const importedFilePaths = new Set\(\s*importedEntries[\s\S]*\.map\(\(entry\) => entry\.relativePath\),\s*\);/,
  );
  assert.match(
    source,
    /const hasUnmatchedDroppedFiles = fileEntries\.some\(\s*\(entry\) => !importedFilePaths\.has\(entry\.relativePath\),\s*\);/,
  );
  assert.match(
    source,
    /return dedupeExplorerExternalImportEntries\(\[\s*\.\.\.importedEntries,\s*\.\.\.fileEntries,\s*\]\);/,
  );
});

test("file explorer does not expose a pane-level close action", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /interface FileExplorerPaneProps \{\s*focusRequest\?: FileExplorerFocusRequest \| null;\s*onFocusRequestConsumed\?: \(requestKey: number\) => void;\s*previewInPane\?: boolean;\s*onFileOpen\?: \(path: string\) => void;\s*onReferenceInChat\?: \(entry: LocalFileEntry, referenceText: string\) => void;\s*onOpenLinkInBrowser\?: \(url: string\) => void;\s*embedded\?: boolean;\s*\}/,
  );
  assert.match(
    source,
    /export function FileExplorerPane\(\{\s*focusRequest = null,\s*onFocusRequestConsumed,\s*previewInPane = true,\s*onFileOpen,\s*onReferenceInChat,\s*onOpenLinkInBrowser,\s*embedded = false,\s*}: FileExplorerPaneProps\)/,
  );
  assert.doesNotMatch(source, /label="Close file explorer"/);
  assert.doesNotMatch(source, /icon=\{<X size=\{1[23]\} \/>/);
});
