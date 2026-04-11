import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ChevronRight,
  FileArchive,
  FileAudio2,
  FileBadge2,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Folder,
  Save,
  Search,
  Shield,
  Star,
  type LucideIcon,
} from "lucide-react";
import { SimpleMarkdown } from "@/components/marketplace/SimpleMarkdown";
import { Button } from "@/components/ui/button";
import { PaneCard } from "@/components/ui/PaneCard";
import {
  EXPLORER_ATTACHMENT_DRAG_TYPE,
  inferDraggedAttachmentKind,
  serializeExplorerAttachmentDragPayload,
} from "@/lib/attachmentDrag";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

export type FileExplorerFocusRequest = {
  path: string;
  requestKey: number;
};

interface FileExplorerPaneProps {
  focusRequest?: FileExplorerFocusRequest | null;
  onFocusRequestConsumed?: (requestKey: number) => void;
  previewInPane?: boolean;
  onFileOpen?: (path: string) => void;
  embedded?: boolean;
}

const SPREADSHEET_EXTENSIONS = new Set([
  ".csv",
  ".tsv",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".ods",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".avif",
  ".heic",
]);

const ARCHIVE_EXTENSIONS = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
]);

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".m4v",
]);

const JSON_EXTENSIONS = new Set([".json", ".jsonl"]);

const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".py",
  ".sh",
  ".sql",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".php",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
]);

const CONFIG_EXTENSIONS = new Set([".yml", ".yaml", ".toml", ".ini"]);

const SPECIAL_CODE_FILENAMES = new Set(["dockerfile", "makefile"]);

const SPECIAL_POLICY_FILENAMES = new Set(["agents.md"]);

const MARKDOWN_PREVIEW_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);

type TextPreviewMode = "edit" | "preview";

type ExplorerIconDescriptor = {
  Icon: LucideIcon;
  className: string;
};

type FileExplorerContextMenuState = {
  entry: LocalFileEntry;
  x: number;
  y: number;
  paneBounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
};

type FileExplorerVisibleRow =
  | {
      type: "entry";
      entry: LocalFileEntry;
      depth: number;
      isExpanded: boolean;
      isLoadingChildren: boolean;
      childError: string;
    }
  | {
      type: "feedback";
      id: string;
      depth: number;
      tone: "loading" | "error";
      message: string;
    };

function getComparableFileName(targetName: string) {
  const normalized = targetName
    .trim()
    .toLowerCase()
    .replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function getFileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const lastDotIndex = normalized.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return "";
  }
  return normalized.slice(lastDotIndex);
}

function getExplorerIconDescriptor(
  targetName: string,
  isDirectory: boolean,
): ExplorerIconDescriptor {
  if (isDirectory) {
    return {
      Icon: Folder,
      className: "text-primary",
    };
  }

  const normalizedFileName = getComparableFileName(targetName);
  const extension = getFileExtension(normalizedFileName);

  if (SPECIAL_POLICY_FILENAMES.has(normalizedFileName)) {
    return {
      Icon: Shield,
      className: "text-cyan-700 dark:text-cyan-300",
    };
  }

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return {
      Icon: FileSpreadsheet,
      className: "text-emerald-600 dark:text-emerald-400",
    };
  }

  if (extension === ".pdf") {
    return {
      Icon: FileBadge2,
      className: "text-rose-600 dark:text-rose-400",
    };
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      Icon: FileImage,
      className: "text-sky-600 dark:text-sky-400",
    };
  }

  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return {
      Icon: FileArchive,
      className: "text-amber-600 dark:text-amber-400",
    };
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return {
      Icon: FileAudio2,
      className: "text-teal-600 dark:text-teal-400",
    };
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return {
      Icon: FileVideoCamera,
      className: "text-orange-600 dark:text-orange-400",
    };
  }

  if (JSON_EXTENSIONS.has(extension)) {
    return {
      Icon: FileJson,
      className: "text-amber-700 dark:text-amber-300",
    };
  }

  if (
    CODE_EXTENSIONS.has(extension) ||
    SPECIAL_CODE_FILENAMES.has(normalizedFileName)
  ) {
    return {
      Icon: FileCode2,
      className: "text-sky-700 dark:text-sky-300",
    };
  }

  if (
    CONFIG_EXTENSIONS.has(extension) ||
    normalizedFileName.startsWith(".env")
  ) {
    return {
      Icon: FileCog,
      className: "text-slate-600 dark:text-slate-400",
    };
  }

  return {
    Icon: FileText,
    className: "text-muted-foreground",
  };
}

function isMarkdownPreviewPayload(
  preview: Pick<FilePreviewPayload, "kind" | "extension"> | null | undefined,
): boolean {
  if (!preview || preview.kind !== "text") {
    return false;
  }
  return MARKDOWN_PREVIEW_EXTENSIONS.has(
    preview.extension.trim().toLowerCase(),
  );
}

function getFolderName(targetPath: string) {
  const normalized = targetPath.replace(/[\\/]+$/, "");
  if (/^[a-zA-Z]:$/.test(normalized)) {
    return normalized;
  }

  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || targetPath;
}

function getParentFolderPath(targetPath: string) {
  const normalized = targetPath.replace(/[\\/]+$/, "");
  const windowsRootMatch = normalized.match(/^[a-zA-Z]:$/);
  if (windowsRootMatch) {
    return null;
  }

  if (normalized === "/") {
    return null;
  }

  const lastSeparatorIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (lastSeparatorIndex <= 0) {
    return normalized.includes("\\") ? normalized.slice(0, 3) : "/";
  }

  return normalized.slice(0, lastSeparatorIndex);
}

function normalizeComparablePath(targetPath: string) {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    return "";
  }

  let normalized = trimmed.replace(/\\/g, "/");
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, "");
  }
  if (/^[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

function isPathWithin(parentPath: string, targetPath: string) {
  const normalizedParent = normalizeComparablePath(parentPath);
  const normalizedTarget = normalizeComparablePath(targetPath);
  if (!normalizedParent || !normalizedTarget) {
    return false;
  }
  return (
    normalizedTarget === normalizedParent ||
    normalizedTarget.startsWith(`${normalizedParent}/`)
  );
}

function isAbsolutePath(targetPath: string) {
  return /^(?:[a-zA-Z]:[\\/]|\/)/.test(targetPath.trim());
}

function resolveWorkspaceTargetPath(workspaceRoot: string, targetPath: string) {
  const trimmedRoot = workspaceRoot.trim();
  const trimmedTarget = targetPath.trim();
  if (!trimmedRoot) {
    return trimmedTarget;
  }
  if (isAbsolutePath(trimmedTarget)) {
    return trimmedTarget;
  }
  const separator = trimmedRoot.includes("\\") ? "\\" : "/";
  const normalizedRoot = trimmedRoot.replace(/[\\/]+$/, "");
  const normalizedTarget = trimmedTarget.replace(/^[\\/]+/, "");
  return `${normalizedRoot}${separator}${normalizedTarget}`;
}

function findLoadedEntry(
  entries: LocalFileEntry[],
  targetPath: string,
  directoryEntriesByPath: Record<string, LocalFileEntry[]>,
): LocalFileEntry | null {
  const normalizedTargetPath = normalizeComparablePath(targetPath);
  if (!normalizedTargetPath) {
    return null;
  }

  const stack = [...entries];
  while (stack.length > 0) {
    const entry = stack.shift();
    if (!entry) {
      continue;
    }

    if (normalizeComparablePath(entry.absolutePath) === normalizedTargetPath) {
      return entry;
    }

    if (!entry.isDirectory) {
      continue;
    }

    const childEntries = directoryEntriesByPath[entry.absolutePath];
    if (childEntries?.length) {
      stack.unshift(...childEntries);
    }
  }

  return null;
}

function buildVisibleExplorerRows(
  entries: LocalFileEntry[],
  directoryEntriesByPath: Record<string, LocalFileEntry[]>,
  expandedDirectoryPaths: Record<string, boolean>,
  directoryLoadingByPath: Record<string, boolean>,
  directoryErrorByPath: Record<string, string>,
  query: string,
  depth = 0,
): FileExplorerVisibleRow[] {
  const rows: FileExplorerVisibleRow[] = [];

  for (const entry of entries) {
    const isExpanded = Boolean(expandedDirectoryPaths[entry.absolutePath]);
    const isLoadingChildren = Boolean(
      directoryLoadingByPath[entry.absolutePath],
    );
    const childError = directoryErrorByPath[entry.absolutePath] ?? "";
    const shouldSearchChildren =
      entry.isDirectory && (isExpanded || query.length > 0);
    const childEntries = shouldSearchChildren
      ? (directoryEntriesByPath[entry.absolutePath] ?? [])
      : [];
    const childRows = shouldSearchChildren
      ? buildVisibleExplorerRows(
          childEntries,
          directoryEntriesByPath,
          expandedDirectoryPaths,
          directoryLoadingByPath,
          directoryErrorByPath,
          query,
          depth + 1,
        )
      : [];
    const matchesSelf =
      query.length === 0 || entry.name.toLowerCase().includes(query);
    const hasMatchingDescendants = childRows.length > 0;

    if (query.length > 0 && !matchesSelf && !hasMatchingDescendants) {
      continue;
    }

    rows.push({
      type: "entry",
      entry,
      depth,
      isExpanded,
      isLoadingChildren,
      childError,
    });

    const shouldShowChildren = entry.isDirectory
      ? query.length > 0
        ? hasMatchingDescendants
        : isExpanded
      : false;
    if (!shouldShowChildren) {
      continue;
    }

    if (isLoadingChildren) {
      rows.push({
        type: "feedback",
        id: `loading:${entry.absolutePath}`,
        depth: depth + 1,
        tone: "loading",
        message: "Loading folder...",
      });
      continue;
    }

    if (childError) {
      rows.push({
        type: "feedback",
        id: `error:${entry.absolutePath}`,
        depth: depth + 1,
        tone: "error",
        message: childError,
      });
      continue;
    }

    rows.push(...childRows);
  }

  return rows;
}

function formatFileSize(size: number) {
  if (size <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatModified(ts: string) {
  const date = new Date(ts);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renameSelectionEnd(targetName: string, isDirectory: boolean) {
  if (isDirectory) {
    return targetName.length;
  }
  const lastDotIndex = targetName.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return targetName.length;
  }
  return lastDotIndex;
}

function createAttachmentDragPreview(entry: LocalFileEntry) {
  const preview = document.createElement("div");
  preview.style.position = "fixed";
  preview.style.top = "-1000px";
  preview.style.left = "-1000px";
  preview.style.display = "inline-flex";
  preview.style.alignItems = "center";
  preview.style.gap = "8px";
  preview.style.maxWidth = "280px";
  preview.style.padding = "8px 12px";
  preview.style.border = "1px solid rgba(252, 127, 120, 0.34)";
  preview.style.borderRadius = "999px";
  preview.style.background = "rgba(255, 248, 247, 0.96)";
  preview.style.boxShadow = "0 12px 30px rgba(45, 18, 16, 0.16)";
  preview.style.backdropFilter = "blur(10px)";
  preview.style.color = "rgba(49, 32, 29, 0.96)";
  preview.style.fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  preview.style.pointerEvents = "none";
  preview.style.zIndex = "2147483647";

  const badge = document.createElement("span");
  badge.textContent =
    inferDraggedAttachmentKind(entry.name) === "image" ? "IMG" : "FILE";
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.justifyContent = "center";
  badge.style.height = "20px";
  badge.style.padding = "0 8px";
  badge.style.borderRadius = "999px";
  badge.style.background = "rgba(252, 127, 120, 0.12)";
  badge.style.color = "rgba(209, 71, 63, 0.92)";
  badge.style.fontSize = "10px";
  badge.style.fontWeight = "700";
  badge.style.letterSpacing = "0.12em";

  const label = document.createElement("span");
  label.textContent =
    `${entry.name} ${entry.isDirectory ? "" : `(${formatFileSize(entry.size)})`}`.trim();
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";
  label.style.fontSize = "12px";
  label.style.fontWeight = "600";

  preview.append(badge, label);
  document.body.append(preview);
  return preview;
}

export function FileExplorerPane({
  focusRequest = null,
  onFocusRequestConsumed,
  previewInPane = true,
  onFileOpen,
  embedded = false,
}: FileExplorerPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameInFlightRef = useRef(false);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedWorkspaceRootRef = useRef<{
    workspaceId: string;
    rootPath: string;
  } | null>(null);
  const lastProcessedFocusRequestKeyRef = useRef<number | null>(null);
  const currentPathRef = useRef("");
  const [currentPath, setCurrentPath] = useState<string>("");
  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [directoryEntriesByPath, setDirectoryEntriesByPath] = useState<
    Record<string, LocalFileEntry[]>
  >({});
  const [expandedDirectoryPaths, setExpandedDirectoryPaths] = useState<
    Record<string, boolean>
  >({});
  const [directoryLoadingByPath, setDirectoryLoadingByPath] = useState<
    Record<string, boolean>
  >({});
  const [directoryErrorByPath, setDirectoryErrorByPath] = useState<
    Record<string, string>
  >({});
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewDraft, setPreviewDraft] = useState("");
  const [textPreviewMode, setTextPreviewMode] =
    useState<TextPreviewMode>("edit");
  const [activeTableSheetIndex, setActiveTableSheetIndex] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fileBookmarks, setFileBookmarks] = useState<FileBookmarkPayload[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [contextMenu, setContextMenu] =
    useState<FileExplorerContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const { selectedWorkspaceId } = useWorkspaceSelection();

  currentPathRef.current = currentPath;

  const loadDirectory = useCallback(
    async (targetPath?: string | null, pushHistory = true) => {
      setLoading(true);
      setError("");

      try {
        const payload = await window.electronAPI.fs.listDirectory(
          targetPath ?? null,
          selectedWorkspaceId ?? null,
        );
        const previousCurrentPath = currentPathRef.current;
        const shouldResetTree =
          pushHistory ||
          normalizeComparablePath(previousCurrentPath) !==
            normalizeComparablePath(payload.currentPath);
        setCurrentPath(payload.currentPath);
        currentPathRef.current = payload.currentPath;
        setEntries(payload.entries);
        setDirectoryEntriesByPath((current) =>
          shouldResetTree
            ? { [payload.currentPath]: payload.entries }
            : { ...current, [payload.currentPath]: payload.entries },
        );
        if (shouldResetTree) {
          setExpandedDirectoryPaths({});
          setDirectoryLoadingByPath({});
          setDirectoryErrorByPath({});
        }

        setSelectedPath((prev) =>
          !prev ||
          (!payload.entries.some((entry) => entry.absolutePath === prev) &&
            !isPathWithin(payload.currentPath, prev))
            ? (payload.entries[0]?.absolutePath ?? "")
            : prev,
        );
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Failed to open directory.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [selectedWorkspaceId],
  );

  useEffect(() => {
    void loadDirectory(null, true);
  }, [loadDirectory]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      lastSyncedWorkspaceRootRef.current = null;
      setWorkspaceRootPath(null);
      return;
    }
    setWorkspaceRootPath(null);

    let cancelled = false;

    async function loadWorkspaceDirectory() {
      try {
        const workspaceRoot =
          await window.electronAPI.workspace.getWorkspaceRoot(
            selectedWorkspaceId,
          );
        if (workspaceRoot) {
          setWorkspaceRootPath(workspaceRoot);
        }
        const lastSyncedWorkspaceRoot = lastSyncedWorkspaceRootRef.current;
        if (
          !workspaceRoot ||
          cancelled ||
          (lastSyncedWorkspaceRoot?.workspaceId === selectedWorkspaceId &&
            lastSyncedWorkspaceRoot.rootPath === workspaceRoot)
        ) {
          return;
        }
        lastSyncedWorkspaceRootRef.current = {
          workspaceId: selectedWorkspaceId,
          rootPath: workspaceRoot,
        };
        await loadDirectory(workspaceRoot, true);
      } catch {
        // The workspace directory may not exist yet while provisioning.
      }
    }

    void loadWorkspaceDirectory();
    return () => {
      cancelled = true;
    };
  }, [loadDirectory, selectedWorkspaceId]);

  useEffect(() => {
    if (!currentPath) {
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;

    const refreshCurrentDirectory = async () => {
      if (cancelled || refreshInFlight) {
        return;
      }

      refreshInFlight = true;
      try {
        const payload = await window.electronAPI.fs.listDirectory(
          currentPath,
          selectedWorkspaceId ?? null,
        );
        if (cancelled || payload.currentPath !== currentPath) {
          return;
        }
        setEntries(payload.entries);
        setDirectoryEntriesByPath((current) => ({
          ...current,
          [payload.currentPath]: payload.entries,
        }));
        setSelectedPath((prev) =>
          !prev ||
          (!payload.entries.some((entry) => entry.absolutePath === prev) &&
            !isPathWithin(payload.currentPath, prev))
            ? (payload.entries[0]?.absolutePath ?? "")
            : prev,
        );
      } catch {
        // Best-effort background refresh; keep current listing on transient failures.
      } finally {
        refreshInFlight = false;
      }
    };

    const timer = window.setInterval(() => {
      void refreshCurrentDirectory();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentPath, selectedWorkspaceId]);

  useEffect(() => {
    let mounted = true;

    void window.electronAPI.fs
      .getBookmarks(selectedWorkspaceId ?? null)
      .then((bookmarks) => {
        if (mounted) {
          setFileBookmarks(bookmarks);
        }
      });

    const unsubscribe = window.electronAPI.fs.onBookmarksChange((bookmarks) => {
      setFileBookmarks(bookmarks);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [selectedWorkspaceId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const syncWidth = () => {
      setContainerWidth(container.getBoundingClientRect().width);
    };

    syncWidth();

    const observer = new ResizeObserver(syncWidth);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      dragPreviewRef.current?.remove();
      dragPreviewRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        contextMenuRef.current &&
        event.target instanceof Node &&
        contextMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setContextMenu(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    const closeMenu = () => {
      setContextMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("blur", closeMenu);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [contextMenu]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return buildVisibleExplorerRows(
      entries,
      directoryEntriesByPath,
      expandedDirectoryPaths,
      directoryLoadingByPath,
      directoryErrorByPath,
      normalizedQuery,
    );
  }, [
    directoryEntriesByPath,
    directoryErrorByPath,
    directoryLoadingByPath,
    entries,
    expandedDirectoryPaths,
    query,
  ]);

  const selectedEntry = useMemo(
    () => findLoadedEntry(entries, selectedPath, directoryEntriesByPath),
    [directoryEntriesByPath, entries, selectedPath],
  );
  const renamingEntry = renamingPath
    ? findLoadedEntry(entries, renamingPath, directoryEntriesByPath)
    : null;
  const isDirty = preview?.isEditable
    ? previewDraft !== (preview.content ?? "")
    : false;
  const isMarkdownPreview = isMarkdownPreviewPayload(preview);

  const openPreviewLink = useCallback((url: string) => {
    void window.electronAPI.ui.openExternalUrl(url);
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const ensureDirectoryEntriesLoaded = useCallback(
    async (targetPath: string) => {
      const normalizedTargetPath = targetPath.trim();
      if (!normalizedTargetPath) {
        return null;
      }

      if (directoryEntriesByPath[normalizedTargetPath]) {
        return directoryEntriesByPath[normalizedTargetPath];
      }

      setDirectoryLoadingByPath((current) => ({
        ...current,
        [normalizedTargetPath]: true,
      }));
      setDirectoryErrorByPath((current) => {
        if (!current[normalizedTargetPath]) {
          return current;
        }
        const next = { ...current };
        delete next[normalizedTargetPath];
        return next;
      });

      try {
        const payload = await window.electronAPI.fs.listDirectory(
          normalizedTargetPath,
          selectedWorkspaceId ?? null,
        );
        setDirectoryEntriesByPath((current) => ({
          ...current,
          [payload.currentPath]: payload.entries,
        }));
        return payload.entries;
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Failed to open directory.";
        setDirectoryErrorByPath((current) => ({
          ...current,
          [normalizedTargetPath]: message,
        }));
        return null;
      } finally {
        setDirectoryLoadingByPath((current) => {
          if (!current[normalizedTargetPath]) {
            return current;
          }
          const next = { ...current };
          delete next[normalizedTargetPath];
          return next;
        });
      }
    },
    [directoryEntriesByPath, selectedWorkspaceId],
  );

  const refreshDirectoryEntries = useCallback(
    async (targetPath: string) => {
      const normalizedTargetPath = targetPath.trim();
      if (!normalizedTargetPath) {
        return;
      }

      if (
        normalizeComparablePath(normalizedTargetPath) ===
        normalizeComparablePath(currentPathRef.current)
      ) {
        await loadDirectory(currentPathRef.current, false);
        return;
      }

      const payload = await window.electronAPI.fs.listDirectory(
        normalizedTargetPath,
        selectedWorkspaceId ?? null,
      );
      setDirectoryEntriesByPath((current) => ({
        ...current,
        [payload.currentPath]: payload.entries,
      }));
      setDirectoryErrorByPath((current) => {
        if (!current[payload.currentPath]) {
          return current;
        }
        const next = { ...current };
        delete next[payload.currentPath];
        return next;
      });
    },
    [loadDirectory, selectedWorkspaceId],
  );

  const revealPathInTree = useCallback(
    async (targetPath: string) => {
      const parentFolderPath = getParentFolderPath(targetPath);
      if (!parentFolderPath) {
        return;
      }

      const treeRootPath = currentPathRef.current;
      if (!treeRootPath || !isPathWithin(treeRootPath, parentFolderPath)) {
        await loadDirectory(parentFolderPath, true);
        return;
      }

      const ancestorPaths: string[] = [];
      const normalizedTreeRoot = normalizeComparablePath(treeRootPath);
      let cursor: string | null = parentFolderPath;

      while (cursor && normalizeComparablePath(cursor) !== normalizedTreeRoot) {
        ancestorPaths.unshift(cursor);
        const nextParent = getParentFolderPath(cursor);
        if (
          !nextParent ||
          normalizeComparablePath(nextParent) ===
            normalizeComparablePath(cursor)
        ) {
          break;
        }
        cursor = nextParent;
      }

      for (const ancestorPath of ancestorPaths) {
        const childEntries = await ensureDirectoryEntriesLoaded(ancestorPath);
        if (childEntries === null) {
          return;
        }
        setExpandedDirectoryPaths((current) => ({
          ...current,
          [ancestorPath]: true,
        }));
      }
    },
    [ensureDirectoryEntriesLoaded, loadDirectory],
  );

  const toggleDirectoryExpansion = useCallback(
    async (entry: LocalFileEntry) => {
      setSelectedPath(entry.absolutePath);
      closeContextMenu();

      if (expandedDirectoryPaths[entry.absolutePath]) {
        setExpandedDirectoryPaths((current) => ({
          ...current,
          [entry.absolutePath]: false,
        }));
        return;
      }

      const childEntries = await ensureDirectoryEntriesLoaded(
        entry.absolutePath,
      );
      if (childEntries === null) {
        return;
      }

      setExpandedDirectoryPaths((current) => ({
        ...current,
        [entry.absolutePath]: true,
      }));
    },
    [closeContextMenu, ensureDirectoryEntriesLoaded, expandedDirectoryPaths],
  );

  const confirmDiscardIfDirty = useCallback(() => {
    if (!isDirty) {
      return true;
    }

    return window.confirm(
      "You have unsaved changes. Press Cancel to go back and save them, or OK to discard them.",
    );
  }, [isDirty]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!renamingEntry || !renameInputRef.current) {
      return;
    }

    const input = renameInputRef.current;
    const selectionEnd = renameSelectionEnd(
      renamingEntry.name,
      renamingEntry.isDirectory,
    );
    input.focus();
    input.setSelectionRange(0, selectionEnd);
  }, [renamingEntry]);

  const stopRenamingEntry = useCallback(() => {
    setRenamingPath(null);
    setRenameDraft("");
    setRenameSaving(false);
  }, []);

  const startRenamingEntry = useCallback(
    (entry: LocalFileEntry) => {
      closeContextMenu();
      setError("");
      setSelectedPath(entry.absolutePath);
      setRenamingPath(entry.absolutePath);
      setRenameDraft(entry.name);
    },
    [closeContextMenu],
  );

  const openFilePreview = async (
    targetPath: string,
    options?: { skipConfirm?: boolean; syncDirectory?: boolean },
  ) => {
    const skipConfirm = options?.skipConfirm ?? false;
    if (!skipConfirm && !confirmDiscardIfDirty()) {
      return;
    }

    if (options?.syncDirectory) {
      await revealPathInTree(targetPath);
    }

    setSelectedPath(targetPath);
    setPreviewLoading(true);
    setPreviewError("");
    setActiveTableSheetIndex(0);

    try {
      const payload = await window.electronAPI.fs.readFilePreview(
        targetPath,
        selectedWorkspaceId ?? null,
      );
      setPreview(payload);
      setPreviewDraft(payload.content ?? "");
      setTextPreviewMode(
        isMarkdownPreviewPayload(payload) ? "preview" : "edit",
      );
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to open file.";
      setPreview(null);
      setTextPreviewMode("edit");
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const openFileTarget = useCallback(
    async (
      targetPath: string,
      options?: { skipConfirm?: boolean; syncDirectory?: boolean },
    ) => {
      if (previewInPane || !onFileOpen) {
        await openFilePreview(targetPath, options);
        return;
      }

      const skipConfirm = options?.skipConfirm ?? false;
      if (!skipConfirm && !confirmDiscardIfDirty()) {
        return;
      }

      if (options?.syncDirectory) {
        await revealPathInTree(targetPath);
      }

      setSelectedPath(targetPath);
      setPreview(null);
      setPreviewDraft("");
      setTextPreviewMode("edit");
      setActiveTableSheetIndex(0);
      setPreviewError("");
      setPreviewLoading(false);
      setSaving(false);
      onFileOpen(targetPath);
    },
    [
      confirmDiscardIfDirty,
      onFileOpen,
      openFilePreview,
      previewInPane,
      revealPathInTree,
    ],
  );

  const closePreview = () => {
    if (!confirmDiscardIfDirty()) {
      return;
    }

    setPreview(null);
    setPreviewDraft("");
    setTextPreviewMode("edit");
    setActiveTableSheetIndex(0);
    setPreviewError("");
    setSaving(false);
  };

  const savePreview = async () => {
    if (!preview?.isEditable) {
      return;
    }

    setSaving(true);
    setPreviewError("");

    try {
      const nextPreview = await window.electronAPI.fs.writeTextFile(
        preview.absolutePath,
        previewDraft,
        selectedWorkspaceId ?? null,
      );
      setPreview(nextPreview);
      setPreviewDraft(nextPreview.content ?? "");
      await loadDirectory(currentPath, false);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to save file.";
      setPreviewError(message);
    } finally {
      setSaving(false);
    }
  };

  const previewTableSheets =
    preview?.kind === "table" && Array.isArray(preview.tableSheets)
      ? preview.tableSheets
      : [];
  const activeTableSheet =
    previewTableSheets.length > 0
      ? previewTableSheets[
          Math.min(activeTableSheetIndex, previewTableSheets.length - 1)
        ]
      : null;
  const showInlinePreview =
    previewInPane && Boolean(preview || previewLoading || previewError);
  const selectedFileEntry =
    !previewInPane && selectedEntry && !selectedEntry.isDirectory
      ? selectedEntry
      : null;
  const bookmarkTargetPath =
    preview?.absolutePath ?? selectedFileEntry?.absolutePath ?? currentPath;
  const bookmarkTargetLabel =
    preview?.name ?? selectedFileEntry?.name ?? getFolderName(currentPath);
  const activeBookmark = fileBookmarks.find(
    (bookmark) => bookmark.targetPath === bookmarkTargetPath,
  );
  const activeBookmarkId =
    preview?.absolutePath ?? selectedFileEntry?.absolutePath ?? currentPath;
  const isCompact = containerWidth > 0 && containerWidth < 420;
  const normalizedQuery = query.trim().toLowerCase();

  const toggleBookmark = async () => {
    if (!bookmarkTargetPath) {
      return;
    }

    if (activeBookmark) {
      await window.electronAPI.fs.removeBookmark(activeBookmark.id);
      return;
    }

    await window.electronAPI.fs.addBookmark(
      bookmarkTargetPath,
      bookmarkTargetLabel,
      selectedWorkspaceId ?? null,
    );
  };

  const openBookmarkedTarget = async (bookmark: FileBookmarkPayload) => {
    if (bookmark.isDirectory) {
      setSelectedPath(bookmark.targetPath);
      if (
        !currentPathRef.current ||
        !isPathWithin(currentPathRef.current, bookmark.targetPath)
      ) {
        await loadDirectory(bookmark.targetPath, true);
        return;
      }

      await revealPathInTree(
        `${bookmark.targetPath}${bookmark.targetPath.includes("\\") ? "\\" : "/"}.__bookmark__`,
      );
      const childEntries = await ensureDirectoryEntriesLoaded(
        bookmark.targetPath,
      );
      if (childEntries !== null) {
        setExpandedDirectoryPaths((current) => ({
          ...current,
          [bookmark.targetPath]: true,
        }));
      }
      return;
    }

    await openFileTarget(bookmark.targetPath, {
      skipConfirm: false,
      syncDirectory: true,
    });
  };

  useEffect(() => {
    if (!focusRequest?.path?.trim()) {
      return;
    }
    const request = focusRequest;
    if (lastProcessedFocusRequestKeyRef.current === request.requestKey) {
      return;
    }
    lastProcessedFocusRequestKeyRef.current = request.requestKey;

    let cancelled = false;

    async function openRequestedArtifact() {
      let targetPath = request.path.trim();
      if (!isAbsolutePath(targetPath) && selectedWorkspaceId) {
        const workspaceRoot =
          workspaceRootPath ??
          (await window.electronAPI.workspace.getWorkspaceRoot(
            selectedWorkspaceId,
          ));
        if (cancelled) {
          return;
        }
        if (workspaceRoot) {
          setWorkspaceRootPath(workspaceRoot);
          targetPath = resolveWorkspaceTargetPath(workspaceRoot, targetPath);
        }
      }

      if (cancelled) {
        return;
      }

      try {
        await openFileTarget(targetPath, { syncDirectory: true });
      } finally {
        if (!cancelled) {
          onFocusRequestConsumed?.(request.requestKey);
        }
      }
    }

    void openRequestedArtifact();
    return () => {
      cancelled = true;
    };
  }, [
    focusRequest,
    onFocusRequestConsumed,
    openFileTarget,
    selectedWorkspaceId,
    workspaceRootPath,
  ]);

  const openEntryFromContextMenu = useCallback(
    async (entry: LocalFileEntry) => {
      closeContextMenu();
      if (entry.isDirectory) {
        await toggleDirectoryExpansion(entry);
        return;
      }
      await openFileTarget(entry.absolutePath);
    },
    [closeContextMenu, openFileTarget, toggleDirectoryExpansion],
  );

  const submitRenameEntry = useCallback(async () => {
    if (!renamingEntry || renameInFlightRef.current) {
      return;
    }

    const nextName = renameDraft.trim();
    if (!nextName || nextName === renamingEntry.name) {
      stopRenamingEntry();
      return;
    }

    setError("");
    renameInFlightRef.current = true;
    setRenameSaving(true);
    try {
      const payload = await window.electronAPI.fs.renamePath(
        renamingEntry.absolutePath,
        nextName,
        selectedWorkspaceId ?? null,
      );
      const parentPath =
        getParentFolderPath(renamingEntry.absolutePath) ??
        currentPathRef.current;
      await refreshDirectoryEntries(parentPath);
      setSelectedPath(payload.absolutePath);
      stopRenamingEntry();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to rename item.";
      setError(message);
      window.setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
    } finally {
      renameInFlightRef.current = false;
      setRenameSaving(false);
    }
  }, [
    renameDraft,
    renamingEntry,
    refreshDirectoryEntries,
    selectedWorkspaceId,
    stopRenamingEntry,
  ]);

  const renameEntryFromContextMenu = useCallback(
    (entry: LocalFileEntry) => {
      startRenamingEntry(entry);
    },
    [startRenamingEntry],
  );

  const cancelRenameEntry = useCallback(() => {
    if (renameInFlightRef.current) {
      return;
    }
    stopRenamingEntry();
  }, [stopRenamingEntry]);

  const deleteEntryFromContextMenu = useCallback(
    async (entry: LocalFileEntry) => {
      closeContextMenu();
      const confirmed = window.confirm(
        entry.isDirectory
          ? `Delete folder "${entry.name}" and all of its contents? This cannot be undone.`
          : `Delete file "${entry.name}"? This cannot be undone.`,
      );
      if (!confirmed) {
        return;
      }

      setError("");
      try {
        await window.electronAPI.fs.deletePath(
          entry.absolutePath,
          selectedWorkspaceId ?? null,
        );
        const parentPath =
          getParentFolderPath(entry.absolutePath) ?? currentPathRef.current;
        await refreshDirectoryEntries(parentPath);
        setSelectedPath("");
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Failed to delete file.";
        setError(message);
      }
    },
    [closeContextMenu, refreshDirectoryEntries, selectedWorkspaceId],
  );

  const contextMenuPosition = useMemo(() => {
    if (!contextMenu) {
      return null;
    }
    const menuWidth = Math.min(
      196,
      Math.max(160, contextMenu.paneBounds.width - 16),
    );
    const menuHeight = 124;
    return {
      left: Math.max(
        contextMenu.paneBounds.left + 8,
        Math.min(contextMenu.x, contextMenu.paneBounds.right - menuWidth - 8),
      ),
      top: Math.max(
        contextMenu.paneBounds.top + 8,
        Math.min(contextMenu.y, contextMenu.paneBounds.bottom - menuHeight - 8),
      ),
      width: menuWidth,
    };
  }, [contextMenu]);

  const content = showInlinePreview ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2.5">
        <div className="truncate text-sm font-semibold text-foreground">
          {preview?.name || selectedEntry?.name || "Preview"}
          {isDirty ? (
            <span className="ml-2 text-xs text-primary">unsaved</span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {preview?.size != null ? (
            <span>{formatFileSize(preview.size)}</span>
          ) : null}
          {preview?.modifiedAt ? (
            <span>{formatModified(preview.modifiedAt)}</span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-2.5">
        {previewLoading ? (
          <div className="grid h-full place-items-center rounded-lg border border-border bg-muted text-sm text-muted-foreground">
            Loading file...
          </div>
        ) : previewError ? (
          <div className="grid h-full place-items-center rounded-lg border border-destructive/30 bg-destructive/5 px-4 text-center text-sm text-destructive">
            {previewError}
          </div>
        ) : preview?.kind === "text" ? (
          isMarkdownPreview && textPreviewMode === "preview" ? (
            <div className="h-full overflow-auto rounded-lg border border-border bg-muted/55 p-4">
              {previewDraft.trim() ? (
                <SimpleMarkdown
                  className="chat-markdown text-sm text-foreground"
                  onLinkClick={openPreviewLink}
                >
                  {previewDraft}
                </SimpleMarkdown>
              ) : (
                <div className="grid h-full min-h-[120px] place-items-center text-sm text-muted-foreground">
                  Nothing to preview yet.
                </div>
              )}
            </div>
          ) : (
            <textarea
              value={previewDraft}
              onChange={(event) => setPreviewDraft(event.target.value)}
              readOnly={!preview.isEditable}
              spellCheck={false}
              className={`h-full w-full resize-none rounded-lg border border-border bg-muted p-4 font-mono text-xs leading-6 text-foreground outline-none transition-colors ${
                preview.isEditable
                  ? "embedded-input focus:border-border/70"
                  : "cursor-default opacity-90"
              }`}
            />
          )
        ) : preview?.kind === "image" && preview.dataUrl ? (
          <div className="flex h-full items-center justify-center overflow-auto rounded-lg border border-border bg-muted p-3">
            <img
              src={preview.dataUrl}
              alt={preview.name}
              className="max-h-full max-w-full rounded-md object-contain"
            />
          </div>
        ) : preview?.kind === "pdf" && preview.dataUrl ? (
          <div className="h-full overflow-hidden rounded-lg border border-border bg-white">
            <iframe
              src={preview.dataUrl}
              title={preview.name}
              className="h-full w-full border-0"
            />
          </div>
        ) : preview?.kind === "table" && activeTableSheet ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-muted">
            {previewTableSheets.length > 1 ? (
              <div className="chat-scrollbar-hidden flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border p-2">
                {previewTableSheets.map((sheet, index) => {
                  const isActive = index === activeTableSheetIndex;
                  return (
                    <button
                      key={`${sheet.name}-${sheet.index}`}
                      type="button"
                      onClick={() => setActiveTableSheetIndex(index)}
                      className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                        isActive
                          ? "border-primary/35 bg-primary/12 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      {sheet.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-max min-w-full border-collapse text-xs text-foreground">
                <thead className="sticky top-0 z-[1] bg-muted">
                  <tr>
                    <th className="border-b border-r border-border bg-muted px-2 py-1.5 text-left text-[11px] text-muted-foreground">
                      #
                    </th>
                    {activeTableSheet.columns.map((column, columnIndex) => (
                      <th
                        key={`${column}-${columnIndex}`}
                        className="border-b border-r border-border bg-muted px-2 py-1.5 text-left text-[11px] text-muted-foreground"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeTableSheet.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={activeTableSheet.columns.length + 1}
                        className="px-3 py-4 text-center text-xs text-muted-foreground"
                      >
                        No rows in this sheet.
                      </td>
                    </tr>
                  ) : (
                    activeTableSheet.rows.map((row, rowIndex) => (
                      <tr
                        key={`row-${rowIndex}`}
                        className="odd:bg-background/20 even:bg-transparent"
                      >
                        <td className="border-b border-r border-border px-2 py-1.5 align-top text-[11px] text-muted-foreground">
                          {rowIndex + 1}
                        </td>
                        {row.map((value, columnIndex) => (
                          <td
                            key={`cell-${rowIndex}-${columnIndex}`}
                            className="max-w-[320px] border-b border-r border-border px-2 py-1.5 align-top"
                          >
                            <div className="break-words whitespace-pre-wrap">
                              {value || "\u00a0"}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {activeTableSheet.truncated ? (
              <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                Showing {activeTableSheet.rows.length} of{" "}
                {activeTableSheet.totalRows} rows and{" "}
                {Math.min(
                  activeTableSheet.columns.length,
                  activeTableSheet.totalColumns,
                )}{" "}
                of{" "}
                {Math.max(
                  activeTableSheet.totalColumns,
                  activeTableSheet.columns.length,
                )}{" "}
                columns.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-lg border border-border bg-muted px-5 text-center">
            <FileText size={22} className="mb-3 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">
              Preview unavailable
            </div>
            <div className="mt-2 max-w-xs text-xs leading-6 text-muted-foreground">
              {preview?.unsupportedReason ||
                "This file type is not supported for inline preview yet."}
            </div>
          </div>
        )}
      </div>
    </div>
  ) : (
    <div ref={containerRef} className="flex h-full min-h-0">
      {fileBookmarks.length > 0 ? (
        <aside className="flex w-11 flex-col items-center gap-1.5 border-r border-border py-2.5">
          <div className="chat-scrollbar-hidden flex min-h-0 flex-1 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto px-1">
            {fileBookmarks.map((bookmark) => {
              const isActive = activeBookmarkId === bookmark.targetPath;
              const { Icon, className } = getExplorerIconDescriptor(
                bookmark.targetPath,
                bookmark.isDirectory,
              );
              return (
                <button
                  key={bookmark.id}
                  type="button"
                  onClick={() => void openBookmarkedTarget(bookmark)}
                  title={bookmark.label}
                  className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors ${
                    isActive
                      ? "bg-primary/12 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <Icon size={14} className={className} />
                </button>
              );
            })}
          </div>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/72">
                Files
              </div>
            </div>
            <Button
              variant={activeBookmark ? "outline" : "ghost"}
              size="icon-sm"
              aria-label={activeBookmark ? "Remove bookmark" : "Add bookmark"}
              onClick={() => void toggleBookmark()}
              disabled={!bookmarkTargetPath}
              className={
                activeBookmark
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "text-muted-foreground"
              }
            >
              <Star
                size={13}
                className={activeBookmark ? "fill-current" : ""}
              />
            </Button>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs transition-colors focus-within:border-ring">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="embedded-input w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
              placeholder="Search files"
            />
          </div>
        </div>

        <div className="chat-scrollbar-hidden min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 pb-1.5 pt-1">
          {loading ? (
            <div className="px-2 py-4 text-xs text-muted-foreground">
              Loading directory...
            </div>
          ) : null}

          {error ? (
            <div className="px-2 py-3 text-xs text-destructive">{error}</div>
          ) : null}

          {!loading && !error && filteredEntries.length === 0 ? (
            <div className="px-2 py-4 text-xs text-muted-foreground">
              No files matched your search.
            </div>
          ) : null}

          {!loading && !error
            ? filteredEntries.map((row) => {
                if (row.type === "feedback") {
                  return (
                    <div
                      key={row.id}
                      className={`mb-0.5 rounded-md px-2 py-1.5 text-[11px] ${
                        row.tone === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                      style={{ paddingLeft: `${8 + row.depth * 16}px` }}
                    >
                      {row.message}
                    </div>
                  );
                }

                const { entry, depth, isExpanded, isLoadingChildren } = row;
                const { Icon, className } = getExplorerIconDescriptor(
                  entry.name,
                  entry.isDirectory,
                );
                const selected = selectedPath === entry.absolutePath;
                const isRenaming = renamingPath === entry.absolutePath;
                const rowClassName = `group mb-0.5 w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                  selected
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
                } ${isRenaming ? "cursor-default" : "cursor-pointer"}`;
                const nameField = isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => {
                      void submitRenameEntry();
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitRenameEntry();
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRenameEntry();
                      }
                    }}
                    disabled={renameSaving}
                    className="embedded-input h-6 min-w-0 flex-1 rounded-sm border border-border/70 bg-background px-1.5 text-xs font-medium text-foreground outline-none focus:border-ring disabled:opacity-60"
                  />
                ) : (
                  <span className="truncate text-xs font-medium">
                    {entry.name}
                  </span>
                );
                const disclosureControl = entry.isDirectory ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleDirectoryExpansion(entry);
                    }}
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={
                      isExpanded ? "Collapse folder" : "Expand folder"
                    }
                  >
                    <ChevronRight
                      size={12}
                      className={`transition-transform duration-200 ${
                        isExpanded ? "rotate-90" : ""
                      } ${isLoadingChildren ? "opacity-60" : ""}`}
                    />
                  </button>
                ) : (
                  <span className="size-4 shrink-0" />
                );
                const rowContent = (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className="flex min-w-0 items-center gap-2"
                      style={{ paddingLeft: `${depth * 16}px` }}
                    >
                      {disclosureControl}
                      <Icon size={14} className={`shrink-0 ${className}`} />
                      {nameField}
                    </span>
                    <span
                      className="flex min-w-0 items-center gap-2 pl-6 text-[11px] text-muted-foreground"
                      style={{ paddingLeft: `${depth * 16 + 24}px` }}
                    >
                      <span className="truncate">
                        {formatModified(entry.modifiedAt)}
                      </span>
                      {!entry.isDirectory ? (
                        <span className="shrink-0">
                          {formatFileSize(entry.size)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                );
                return (
                  <div
                    key={entry.absolutePath}
                    className={rowClassName}
                    title={
                      entry.isDirectory
                        ? `${entry.name} — click to ${isExpanded ? "collapse" : "expand"} folder`
                        : previewInPane
                          ? `${entry.name} — drag into chat to attach`
                          : `${entry.name} — click to open file, drag into chat to attach`
                    }
                  >
                    {isRenaming ? (
                      <div className="w-full">{rowContent}</div>
                    ) : (
                      <button
                        type="button"
                        draggable={!entry.isDirectory}
                        onClick={() => {
                          setSelectedPath(entry.absolutePath);
                          closeContextMenu();
                          if (entry.isDirectory) {
                            void toggleDirectoryExpansion(entry);
                            return;
                          }
                          if (!previewInPane) {
                            void openFileTarget(entry.absolutePath);
                          }
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          const paneRect =
                            containerRef.current?.getBoundingClientRect();
                          if (!paneRect) {
                            return;
                          }
                          setSelectedPath(entry.absolutePath);
                          setContextMenu({
                            entry,
                            x: event.clientX,
                            y: event.clientY,
                            paneBounds: {
                              left: paneRect.left,
                              top: paneRect.top,
                              right: paneRect.right,
                              bottom: paneRect.bottom,
                              width: paneRect.width,
                              height: paneRect.height,
                            },
                          });
                        }}
                        onDoubleClick={() => {
                          if (!entry.isDirectory && previewInPane) {
                            void openFilePreview(entry.absolutePath);
                          }
                        }}
                        onDragStart={(event) => {
                          if (entry.isDirectory) {
                            event.preventDefault();
                            return;
                          }

                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.setData(
                            EXPLORER_ATTACHMENT_DRAG_TYPE,
                            serializeExplorerAttachmentDragPayload({
                              absolutePath: entry.absolutePath,
                              name: entry.name,
                              size: entry.size,
                            }),
                          );
                          event.dataTransfer.setData("text/plain", entry.name);
                          const preview = createAttachmentDragPreview(entry);
                          dragPreviewRef.current?.remove();
                          dragPreviewRef.current = preview;
                          event.dataTransfer.setDragImage(preview, 18, 18);
                        }}
                        onDragEnd={() => {
                          dragPreviewRef.current?.remove();
                          dragPreviewRef.current = null;
                        }}
                        className="w-full cursor-pointer text-left"
                        title={
                          entry.isDirectory
                            ? `${entry.name} — click to ${isExpanded ? "collapse" : "expand"} folder`
                            : previewInPane
                              ? `${entry.name} — drag into chat to attach`
                              : `${entry.name} — click to open file, drag into chat to attach`
                        }
                      >
                        {rowContent}
                      </button>
                    )}
                  </div>
                );
              })
            : null}
        </div>
      </div>
    </div>
  );

  const explorerPane = embedded ? (
    content
  ) : (
    <PaneCard
      title={showInlinePreview ? "File" : ""}
      actions={
        showInlinePreview ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closePreview}
            >
              <ArrowLeft size={12} />
              Files
            </Button>
            <Button
              variant={activeBookmark ? "outline" : "ghost"}
              size="icon-sm"
              aria-label={activeBookmark ? "Remove bookmark" : "Add bookmark"}
              onClick={() => void toggleBookmark()}
              disabled={!bookmarkTargetPath}
              className={
                activeBookmark
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "text-muted-foreground"
              }
            >
              <Star
                size={12}
                className={activeBookmark ? "fill-current" : ""}
              />
            </Button>
            {isMarkdownPreview ? (
              <div className="inline-flex items-center rounded-md border border-border bg-muted/50 p-0.5">
                <Button
                  type="button"
                  variant={
                    textPreviewMode === "preview" ? "secondary" : "ghost"
                  }
                  size="xs"
                  onClick={() => setTextPreviewMode("preview")}
                  className={textPreviewMode === "preview" ? "shadow-sm" : ""}
                >
                  Preview
                </Button>
                <Button
                  type="button"
                  variant={textPreviewMode === "edit" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setTextPreviewMode("edit")}
                  className={textPreviewMode === "edit" ? "shadow-sm" : ""}
                >
                  Edit
                </Button>
              </div>
            ) : null}
            {preview?.isEditable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void savePreview()}
                disabled={!isDirty || saving}
              >
                <Save size={12} />
                {saving ? "Saving" : "Save"}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {content}
    </PaneCard>
  );

  return (
    <>
      {explorerPane}
      {contextMenu && contextMenuPosition
        ? createPortal(
            <div
              ref={contextMenuRef}
              style={contextMenuPosition}
              className="fixed z-[80] rounded-xl border border-border/70 bg-popover/92 p-1.5 text-popover-foreground shadow-xl ring-1 ring-foreground/10 backdrop-blur-xl"
            >
              <Button
                type="button"
                variant="ghost"
                size="default"
                onClick={() => {
                  void openEntryFromContextMenu(contextMenu.entry);
                }}
                className="w-full justify-start"
              >
                {contextMenu.entry.isDirectory
                  ? expandedDirectoryPaths[contextMenu.entry.absolutePath]
                    ? "Collapse folder"
                    : "Expand folder"
                  : "Open file"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="default"
                onClick={() => {
                  void renameEntryFromContextMenu(contextMenu.entry);
                }}
                className="w-full justify-start"
              >
                Rename…
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="default"
                onClick={() => {
                  void deleteEntryFromContextMenu(contextMenu.entry);
                }}
                className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Delete…
              </Button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
