import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import {
  ArrowLeft,
  ArrowUp,
  Eye,
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
  Forward,
  Home,
  PencilLine,
  Save,
  Search,
  Shield,
  Star,
  type LucideIcon,
  Undo2
} from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { PaneCard } from "@/components/ui/PaneCard";
import {
  EXPLORER_ATTACHMENT_DRAG_TYPE,
  inferDraggedAttachmentKind,
  serializeExplorerAttachmentDragPayload
} from "@/lib/attachmentDrag";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

type TextPreviewMode = "preview" | "edit";
export type FileExplorerFocusRequest = {
  path: string;
  requestKey: number;
};

interface FileExplorerPaneProps {
  focusRequest?: FileExplorerFocusRequest | null;
  onFocusRequestConsumed?: (requestKey: number) => void;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".html": "xml",
  ".xml": "xml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".py": "python",
  ".sh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".sql": "sql",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".php": "php",
  ".swift": "swift",
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".h": "cpp",
  ".hpp": "cpp",
  ".txt": "plaintext",
  ".log": "plaintext",
  ".toml": "ini",
  ".ini": "ini",
  ".env": "bash",
  ".csv": "plaintext"
};

const SPREADSHEET_EXTENSIONS = new Set([
  ".csv",
  ".tsv",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".ods"
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
  ".heic"
]);

const ARCHIVE_EXTENSIONS = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar"
]);

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac"
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".m4v"
]);

const JSON_EXTENSIONS = new Set([
  ".json",
  ".jsonl"
]);

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
  ".hpp"
]);

const CONFIG_EXTENSIONS = new Set([
  ".yml",
  ".yaml",
  ".toml",
  ".ini"
]);

const SPECIAL_CODE_FILENAMES = new Set([
  "dockerfile",
  "makefile"
]);

const SPECIAL_POLICY_FILENAMES = new Set([
  "agents.md"
]);

type ExplorerIconDescriptor = {
  Icon: LucideIcon;
  className: string;
};

function getComparableFileName(targetName: string) {
  const normalized = targetName.trim().toLowerCase().replace(/[\\/]+$/, "");
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

function getExplorerIconDescriptor(targetName: string, isDirectory: boolean): ExplorerIconDescriptor {
  if (isDirectory) {
    return {
      Icon: Folder,
      className: "text-primary"
    };
  }

  const normalizedFileName = getComparableFileName(targetName);
  const extension = getFileExtension(normalizedFileName);

  if (SPECIAL_POLICY_FILENAMES.has(normalizedFileName)) {
    return {
      Icon: Shield,
      className: "text-cyan-700 dark:text-cyan-300"
    };
  }

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return {
      Icon: FileSpreadsheet,
      className: "text-emerald-600 dark:text-emerald-400"
    };
  }

  if (extension === ".pdf") {
    return {
      Icon: FileBadge2,
      className: "text-rose-600 dark:text-rose-400"
    };
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      Icon: FileImage,
      className: "text-sky-600 dark:text-sky-400"
    };
  }

  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return {
      Icon: FileArchive,
      className: "text-amber-600 dark:text-amber-400"
    };
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return {
      Icon: FileAudio2,
      className: "text-teal-600 dark:text-teal-400"
    };
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return {
      Icon: FileVideoCamera,
      className: "text-orange-600 dark:text-orange-400"
    };
  }

  if (JSON_EXTENSIONS.has(extension)) {
    return {
      Icon: FileJson,
      className: "text-amber-700 dark:text-amber-300"
    };
  }

  if (
    CODE_EXTENSIONS.has(extension) ||
    SPECIAL_CODE_FILENAMES.has(normalizedFileName)
  ) {
    return {
      Icon: FileCode2,
      className: "text-sky-700 dark:text-sky-300"
    };
  }

  if (CONFIG_EXTENSIONS.has(extension) || normalizedFileName.startsWith(".env")) {
    return {
      Icon: FileCog,
      className: "text-slate-600 dark:text-slate-400"
    };
  }

  return {
    Icon: FileText,
    className: "text-muted-foreground"
  };
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

  const lastSeparatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
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
    minute: "2-digit"
  }).format(date);
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
  preview.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  preview.style.pointerEvents = "none";
  preview.style.zIndex = "2147483647";

  const badge = document.createElement("span");
  badge.textContent = inferDraggedAttachmentKind(entry.name) === "image" ? "IMG" : "FILE";
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
  label.textContent = `${entry.name} ${entry.isDirectory ? "" : `(${formatFileSize(entry.size)})`}`.trim();
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";
  label.style.fontSize = "12px";
  label.style.fontWeight = "600";

  preview.append(badge, label);
  document.body.append(preview);
  return preview;
}

function getHighlightedHtml(preview: FilePreviewPayload | null, draft: string) {
  if (!preview || preview.kind !== "text") {
    return "";
  }

  const source = draft || "";
  const language = LANGUAGE_BY_EXTENSION[preview.extension.toLowerCase()];

  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(source, { language }).value;
  }

  return hljs.highlightAuto(source).value;
}

export function FileExplorerPane({
  focusRequest = null,
  onFocusRequestConsumed,
}: FileExplorerPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedWorkspaceRootRef = useRef<{ workspaceId: string; rootPath: string } | null>(null);
  const lastProcessedFocusRequestKeyRef = useRef<number | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewDraft, setPreviewDraft] = useState("");
  const [activeTableSheetIndex, setActiveTableSheetIndex] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(false);
  const [textPreviewMode, setTextPreviewMode] = useState<TextPreviewMode>("preview");
  const [fileBookmarks, setFileBookmarks] = useState<FileBookmarkPayload[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const { selectedWorkspaceId } = useWorkspaceSelection();

  const loadDirectory = useCallback(async (targetPath?: string | null, pushHistory = true) => {
    setLoading(true);
    setError("");

    try {
      const payload = await window.electronAPI.fs.listDirectory(targetPath ?? null);
      setCurrentPath(payload.currentPath);
      setParentPath(payload.parentPath);
      setEntries(payload.entries);

      if (pushHistory) {
        const currentHistory = historyRef.current;
        const currentIndex = historyIndexRef.current;
        const base = currentIndex >= 0 ? currentHistory.slice(0, currentIndex + 1) : currentHistory;
        const last = base[base.length - 1];

        if (last === payload.currentPath) {
          historyRef.current = base;
          historyIndexRef.current = base.length - 1;
          setHistory(base);
          setHistoryIndex(base.length - 1);
        } else {
          const next = [...base, payload.currentPath];
          historyRef.current = next;
          historyIndexRef.current = next.length - 1;
          setHistory(next);
          setHistoryIndex(next.length - 1);
        }
      }

      setSelectedPath((prev) =>
        !prev || !payload.entries.some((entry) => entry.absolutePath === prev) ? (payload.entries[0]?.absolutePath ?? "") : prev
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to open directory.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

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
        const workspaceRoot = await window.electronAPI.workspace.getWorkspaceRoot(selectedWorkspaceId);
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
          rootPath: workspaceRoot
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
        const payload = await window.electronAPI.fs.listDirectory(currentPath);
        if (cancelled || payload.currentPath !== currentPath) {
          return;
        }
        setParentPath(payload.parentPath);
        setEntries(payload.entries);
        setSelectedPath((prev) =>
          !prev || !payload.entries.some((entry) => entry.absolutePath === prev) ? (payload.entries[0]?.absolutePath ?? "") : prev
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
  }, [currentPath]);

  useEffect(() => {
    let mounted = true;

    void window.electronAPI.fs.getBookmarks().then((bookmarks) => {
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
  }, []);

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

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;
  const isAtWorkspaceRoot = workspaceRootPath
    ? normalizeComparablePath(currentPath) === normalizeComparablePath(workspaceRootPath)
    : false;

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(normalizedQuery));
  }, [entries, query]);

  const selectedEntry = entries.find((entry) => entry.absolutePath === selectedPath);
  const isDirty = preview?.isEditable ? previewDraft !== (preview.content ?? "") : false;

  const confirmDiscardIfDirty = useCallback(() => {
    if (!isDirty) {
      return true;
    }

    return window.confirm("You have unsaved changes. Discard them?");
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

  const openPath = async (targetPath: string) => {
    if (!confirmDiscardIfDirty()) {
      return;
    }

    setPreview(null);
    setPreviewDraft("");
    setPreviewError("");
    await loadDirectory(targetPath, true);
  };

  const openSelectedDirectory = async () => {
    const targetEntry = entries.find((entry) => entry.absolutePath === selectedPath);
    if (targetEntry?.isDirectory) {
      await openPath(targetEntry.absolutePath);
    }
  };

  const openHomeDirectory = async () => {
    if (!confirmDiscardIfDirty()) {
      return;
    }

    if (selectedWorkspaceId) {
      try {
        const workspaceRoot = await window.electronAPI.workspace.getWorkspaceRoot(selectedWorkspaceId);
        if (workspaceRoot) {
          setPreview(null);
          setPreviewDraft("");
          setPreviewError("");
          await loadDirectory(workspaceRoot, true);
          return;
        }
      } catch {
        // Fall through to default home root.
      }
    }

    setPreview(null);
    setPreviewDraft("");
    setPreviewError("");
    await loadDirectory(null, true);
  };

  const openFilePreview = async (targetPath: string, options?: { skipConfirm?: boolean; syncDirectory?: boolean }) => {
    const skipConfirm = options?.skipConfirm ?? false;
    if (!skipConfirm && !confirmDiscardIfDirty()) {
      return;
    }

    if (options?.syncDirectory) {
      const parentFolderPath = getParentFolderPath(targetPath);
      if (parentFolderPath && parentFolderPath !== currentPath) {
        await loadDirectory(parentFolderPath, true);
      }
    }

    setSelectedPath(targetPath);
    setPreviewLoading(true);
    setPreviewError("");
    setTextPreviewMode("preview");
    setActiveTableSheetIndex(0);

    try {
      const payload = await window.electronAPI.fs.readFilePreview(targetPath);
      setPreview(payload);
      setPreviewDraft(payload.content ?? "");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to open file.";
      setPreview(null);
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (!confirmDiscardIfDirty()) {
      return;
    }

    setPreview(null);
    setPreviewDraft("");
    setActiveTableSheetIndex(0);
    setPreviewError("");
    setSaving(false);
    setTextPreviewMode("preview");
  };

  const savePreview = async () => {
    if (!preview?.isEditable) {
      return;
    }

    setSaving(true);
    setPreviewError("");

    try {
      const nextPreview = await window.electronAPI.fs.writeTextFile(preview.absolutePath, previewDraft);
      setPreview(nextPreview);
      setPreviewDraft(nextPreview.content ?? "");
      await loadDirectory(currentPath, false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to save file.";
      setPreviewError(message);
    } finally {
      setSaving(false);
    }
  };

  const onBack = async () => {
    if (!canGoBack || !confirmDiscardIfDirty()) return;
    const targetIndex = historyIndex - 1;
    const targetPath = history[targetIndex];
    if (!targetPath) return;

    historyIndexRef.current = targetIndex;
    setHistoryIndex(targetIndex);
    setPreview(null);
    setPreviewDraft("");
    setPreviewError("");
    await loadDirectory(targetPath, false);
  };

  const onForward = async () => {
    if (!canGoForward || !confirmDiscardIfDirty()) return;
    const targetIndex = historyIndex + 1;
    const targetPath = history[targetIndex];
    if (!targetPath) return;

    historyIndexRef.current = targetIndex;
    setHistoryIndex(targetIndex);
    setPreview(null);
    setPreviewDraft("");
    setPreviewError("");
    await loadDirectory(targetPath, false);
  };

  const highlightedHtml = useMemo(() => getHighlightedHtml(preview, previewDraft), [preview, previewDraft]);
  const previewTableSheets =
    preview?.kind === "table" && Array.isArray(preview.tableSheets)
      ? preview.tableSheets
      : [];
  const activeTableSheet =
    previewTableSheets.length > 0
      ? previewTableSheets[Math.min(activeTableSheetIndex, previewTableSheets.length - 1)]
      : null;
  const bookmarkTargetPath = preview?.absolutePath ?? currentPath;
  const bookmarkTargetLabel = preview?.name ?? getFolderName(currentPath);
  const activeBookmark = fileBookmarks.find((bookmark) => bookmark.targetPath === bookmarkTargetPath);
  const activeBookmarkId = preview?.absolutePath ?? currentPath;
  const isCompact = containerWidth > 0 && containerWidth < 420;
  const isVeryCompact = containerWidth > 0 && containerWidth < 320;

  const toggleBookmark = async () => {
    if (!bookmarkTargetPath) {
      return;
    }

    if (activeBookmark) {
      await window.electronAPI.fs.removeBookmark(activeBookmark.id);
      return;
    }

    await window.electronAPI.fs.addBookmark(bookmarkTargetPath, bookmarkTargetLabel);
  };

  const openBookmarkedTarget = async (bookmark: FileBookmarkPayload) => {
    if (bookmark.isDirectory) {
      await openPath(bookmark.targetPath);
      return;
    }

    await openFilePreview(bookmark.targetPath, { skipConfirm: false, syncDirectory: true });
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
          (await window.electronAPI.workspace.getWorkspaceRoot(selectedWorkspaceId));
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
        await openFilePreview(targetPath, { syncDirectory: true });
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
    openFilePreview,
    selectedWorkspaceId,
    workspaceRootPath,
  ]);

  return (
    <PaneCard
      title={preview || previewLoading || previewError ? "File Preview" : ""}
      actions={
        preview || previewLoading || previewError ? (
          <>
            <button
              type="button"
              onClick={closePreview}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ArrowLeft size={12} />
              Files
            </button>
            <IconButton
              icon={<Star size={12} className={activeBookmark ? "fill-current" : ""} />}
              label={activeBookmark ? "Remove bookmark" : "Add bookmark"}
              active={Boolean(activeBookmark)}
              onClick={() => void toggleBookmark()}
              disabled={!bookmarkTargetPath}
            />
            {preview?.kind === "text" ? (
              <button
                type="button"
                onClick={() => setTextPreviewMode((mode) => (mode === "preview" ? "edit" : "preview"))}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/8 px-2 py-1 text-xs text-foreground transition-colors hover:bg-primary/15"
              >
                <span className="rounded-sm border border-border bg-muted px-1.5 py-px text-[10px] uppercase tracking-wider text-muted-foreground">
                  {textPreviewMode}
                </span>
                {textPreviewMode === "preview" ? <PencilLine size={11} /> : <Eye size={11} />}
              </button>
            ) : null}
            {preview?.isEditable ? (
              <button
                type="button"
                onClick={() => void savePreview()}
                disabled={!isDirty || saving}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={12} />
                {saving ? "Saving" : "Save"}
              </button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {preview || previewLoading || previewError ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-border px-4 py-2.5">
            <div className="truncate text-sm font-semibold text-foreground">
              {preview?.name || selectedEntry?.name || "Preview"}
              {isDirty ? <span className="ml-2 text-xs text-primary">unsaved</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {preview?.absolutePath ? <span>{preview.absolutePath}</span> : null}
              {preview?.size != null ? <span>{formatFileSize(preview.size)}</span> : null}
              {preview?.modifiedAt ? <span>{formatModified(preview.modifiedAt)}</span> : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden p-2.5">
            {previewLoading ? (
              <div className="grid h-full place-items-center rounded-lg border border-border bg-muted text-sm text-muted-foreground">
                Loading preview...
              </div>
            ) : previewError ? (
              <div className="grid h-full place-items-center rounded-lg border border-destructive/30 bg-destructive/5 px-4 text-center text-sm text-destructive">
                {previewError}
              </div>
            ) : preview?.kind === "text" && textPreviewMode === "preview" ? (
              <div className="h-full overflow-auto rounded-lg border border-border bg-muted">
                <pre className="m-0 min-h-full overflow-auto p-4 font-mono text-xs leading-6 text-foreground">
                  <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
                </pre>
              </div>
            ) : preview?.kind === "text" ? (
              <textarea
                value={previewDraft}
                onChange={(event) => setPreviewDraft(event.target.value)}
                spellCheck={false}
                className="h-full w-full resize-none rounded-lg border border-border bg-muted p-4 font-mono text-xs leading-6 text-foreground outline-none transition-colors focus:border-ring"
              />
            ) : preview?.kind === "image" && preview.dataUrl ? (
              <div className="flex h-full items-center justify-center overflow-auto rounded-lg border border-border bg-muted p-3">
                <img src={preview.dataUrl} alt={preview.name} className="max-h-full max-w-full rounded-md object-contain" />
              </div>
            ) : preview?.kind === "pdf" && preview.dataUrl ? (
              <div className="h-full overflow-hidden rounded-lg border border-border bg-white">
                <iframe src={preview.dataUrl} title={preview.name} className="h-full w-full border-0" />
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
                          <tr key={`row-${rowIndex}`} className="odd:bg-background/20 even:bg-transparent">
                            <td className="border-b border-r border-border px-2 py-1.5 align-top text-[11px] text-muted-foreground">
                              {rowIndex + 1}
                            </td>
                            {row.map((value, columnIndex) => (
                              <td
                                key={`cell-${rowIndex}-${columnIndex}`}
                                className="max-w-[320px] border-b border-r border-border px-2 py-1.5 align-top"
                              >
                                <div className="break-words whitespace-pre-wrap">{value || "\u00a0"}</div>
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
                    Showing {activeTableSheet.rows.length} of {activeTableSheet.totalRows} rows and{" "}
                    {Math.min(activeTableSheet.columns.length, activeTableSheet.totalColumns)} of{" "}
                    {Math.max(activeTableSheet.totalColumns, activeTableSheet.columns.length)} columns.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-lg border border-border bg-muted px-5 text-center">
                <FileText size={22} className="mb-3 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">Preview unavailable</div>
                <div className="mt-2 max-w-xs text-xs leading-6 text-muted-foreground">
                  {preview?.unsupportedReason || "This file type is not supported for inline preview yet."}
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
                    bookmark.isDirectory
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
              <div className="mb-2 flex min-w-0 items-center gap-0.5">
                <IconButton icon={<Undo2 size={13} />} label="Back" onClick={() => void onBack()} disabled={!canGoBack} />
                <IconButton icon={<Forward size={13} />} label="Forward" onClick={() => void onForward()} disabled={!canGoForward} />
                <IconButton
                  icon={<ArrowUp size={13} />}
                  label="Up"
                  onClick={() => parentPath && !isAtWorkspaceRoot && void openPath(parentPath)}
                  disabled={!parentPath || isAtWorkspaceRoot}
                />
                {!isVeryCompact ? (
                  <IconButton
                    icon={<Home size={13} />}
                    label="Home"
                    onClick={() => {
                      void openHomeDirectory();
                    }}
                    disabled={isAtWorkspaceRoot}
                  />
                ) : null}
                <div className="min-w-0 flex-1" />
                <IconButton
                  icon={<Star size={13} className={activeBookmark ? "fill-current" : ""} />}
                  label={activeBookmark ? "Remove bookmark" : "Add bookmark"}
                  active={Boolean(activeBookmark)}
                  onClick={() => void toggleBookmark()}
                  disabled={!bookmarkTargetPath}
                />
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
              <div className="mt-1.5 truncate text-[10px] uppercase tracking-widest text-muted-foreground/60">
                {isCompact ? getFolderName(currentPath) : currentPath}
              </div>
            </div>

            {!isCompact ? (
              <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_110px] border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/60 lg:grid-cols-[minmax(0,1fr)_140px_90px]">
                <span>Name</span>
                <span>Modified</span>
                <span className="hidden lg:block">Size</span>
              </div>
            ) : null}

            <div className="chat-scrollbar-hidden min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 pb-1.5 pt-1">
              {loading ? <div className="px-2 py-4 text-xs text-muted-foreground">Loading directory...</div> : null}

              {error ? <div className="px-2 py-3 text-xs text-destructive">{error}</div> : null}

              {!loading && !error && filteredEntries.length === 0 ? (
                <div className="px-2 py-4 text-xs text-muted-foreground">No files matched your search.</div>
              ) : null}

              {!loading && !error
                ? filteredEntries.map((entry) => {
                    const { Icon, className } = getExplorerIconDescriptor(
                      entry.name,
                      entry.isDirectory
                    );
                    const selected = selectedPath === entry.absolutePath;
                    return (
                      <button
                        type="button"
                        key={entry.absolutePath}
                        draggable={!entry.isDirectory}
                        onClick={() => {
                          setSelectedPath(entry.absolutePath);
                        }}
                        onDoubleClick={() => {
                          if (entry.isDirectory) {
                            void openPath(entry.absolutePath);
                            return;
                          }
                          void openFilePreview(entry.absolutePath);
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
                            })
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
                        className={`group mb-0.5 w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                          selected
                            ? "bg-primary/10 text-primary"
                            : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
                        } ${entry.isDirectory ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
                        title={
                          entry.isDirectory
                            ? `${entry.name} — double-click to open folder`
                            : `${entry.name} — drag into chat to attach`
                        }
                      >
                        {isCompact ? (
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex min-w-0 items-center gap-2">
                              <Icon size={14} className={`shrink-0 ${className}`} />
                              <span className="truncate text-xs font-medium">{entry.name}</span>
                            </span>
                            <span className="flex min-w-0 items-center gap-2 pl-6 text-[11px] text-muted-foreground">
                              <span className="truncate">{formatModified(entry.modifiedAt)}</span>
                              {!entry.isDirectory ? <span className="shrink-0">{formatFileSize(entry.size)}</span> : null}
                            </span>
                          </span>
                        ) : (
                          <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_110px] items-center lg:grid-cols-[minmax(0,1fr)_140px_90px]">
                            <span className="flex min-w-0 items-center gap-2">
                              <Icon size={14} className={className} />
                              <span className="truncate text-xs font-medium">{entry.name}</span>
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground">
                              {formatModified(entry.modifiedAt)}
                            </span>
                            <span className="hidden text-[11px] text-muted-foreground lg:block">
                              {entry.isDirectory ? "-" : formatFileSize(entry.size)}
                            </span>
                          </span>
                        )}
                      </button>
                    );
                  })
                : null}
            </div>

          </div>
        </div>
      )}
    </PaneCard>
  );
}
