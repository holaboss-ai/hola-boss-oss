import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import {
  ArrowLeft,
  ArrowUp,
  Eye,
  FileText,
  Folder,
  Forward,
  Home,
  PencilLine,
  Save,
  Search,
  Star,
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

export function FileExplorerPane() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewDraft, setPreviewDraft] = useState("");
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
      return;
    }

    let cancelled = false;

    async function loadWorkspaceDirectory() {
      try {
        const workspaceRoot = await window.electronAPI.workspace.getWorkspaceRoot(selectedWorkspaceId);
        if (!workspaceRoot || cancelled || currentPath === workspaceRoot) {
          return;
        }
        await loadDirectory(workspaceRoot, true);
      } catch {
        // The workspace directory may not exist yet while provisioning.
      }
    }

    void loadWorkspaceDirectory();
    return () => {
      cancelled = true;
    };
  }, [currentPath, loadDirectory, selectedWorkspaceId]);

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

  return (
    <PaneCard
      title={preview || previewLoading || previewError ? "File Preview" : ""}
      actions={
        preview || previewLoading || previewError ? (
          <>
            <button
              type="button"
              onClick={closePreview}
              className="inline-flex items-center gap-1 rounded-lg border border-panel-border bg-obsidian-soft/80 px-2.5 py-1.5 text-[11px] text-text-muted/85 transition hover:border-neon-green/45 hover:text-neon-green"
            >
              <ArrowLeft size={12} />
              Files
            </button>
            <IconButton
              icon={<Star size={12} className={activeBookmark ? "fill-current" : ""} />}
              label={activeBookmark ? "Remove bookmark" : "Add bookmark"}
              className="h-7 w-7"
              active={Boolean(activeBookmark)}
              onClick={() => void toggleBookmark()}
              disabled={!bookmarkTargetPath}
            />
            {preview?.kind === "text" ? (
              <button
                type="button"
                onClick={() => setTextPreviewMode((mode) => (mode === "preview" ? "edit" : "preview"))}
                className="inline-flex items-center gap-2 rounded-lg border border-neon-green/35 bg-neon-green/8 px-2.5 py-1.5 text-[11px] text-text-main/90 transition hover:border-neon-green/55 hover:bg-neon-green/12 hover:text-neon-green"
              >
                <span className="rounded-full border border-panel-border/50 bg-[var(--theme-subtle-bg)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text-dim/80">
                  {textPreviewMode}
                </span>
                <span className="inline-flex items-center gap-1">
                  {textPreviewMode === "preview" ? <PencilLine size={12} /> : <Eye size={12} />}
                  {textPreviewMode === "preview" ? "Switch to edit" : "Switch to preview"}
                </span>
              </button>
            ) : null}
            {preview?.isEditable ? (
              <button
                type="button"
                onClick={() => void savePreview()}
                disabled={!isDirty || saving}
                className="inline-flex items-center gap-1 rounded-lg border border-panel-border bg-obsidian-soft/80 px-2.5 py-1.5 text-[11px] text-text-muted/85 transition hover:border-neon-green/45 hover:text-neon-green disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="shrink-0 border-b border-neon-green/20 px-4 py-3">
            <div className="truncate text-sm font-semibold text-text-main/92">
              {preview?.name || selectedEntry?.name || "Preview"}
              {isDirty ? <span className="ml-2 text-xs text-neon-green/85">• unsaved</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted/72">
              {preview?.absolutePath ? <span>{preview.absolutePath}</span> : null}
              {preview?.size != null ? <span>{formatFileSize(preview.size)}</span> : null}
              {preview?.modifiedAt ? <span>{formatModified(preview.modifiedAt)}</span> : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden p-3">
            {previewLoading ? (
              <div className="theme-subtle-surface grid h-full place-items-center rounded-xl border border-panel-border/60 text-sm text-text-muted/75">
                Loading preview...
              </div>
            ) : previewError ? (
              <div className="theme-subtle-surface grid h-full place-items-center rounded-xl border border-rose-300/30 px-4 text-center text-sm text-rose-200/85">
                {previewError}
              </div>
            ) : preview?.kind === "text" && textPreviewMode === "preview" ? (
              <div className="theme-control-surface h-full overflow-auto rounded-xl border border-panel-border/60">
                <pre className="m-0 min-h-full overflow-auto p-4 font-mono text-[12px] leading-6 text-text-main/92">
                  <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
                </pre>
              </div>
            ) : preview?.kind === "text" ? (
              <textarea
                value={previewDraft}
                onChange={(event) => setPreviewDraft(event.target.value)}
                spellCheck={false}
                className="theme-control-surface h-full w-full resize-none rounded-xl border border-panel-border/60 p-4 font-mono text-[12px] leading-6 text-text-main/92 outline-none transition focus:border-neon-green/45"
              />
            ) : preview?.kind === "image" && preview.dataUrl ? (
              <div className="theme-subtle-surface flex h-full items-center justify-center overflow-auto rounded-xl border border-panel-border/60 p-3">
                <img src={preview.dataUrl} alt={preview.name} className="max-h-full max-w-full rounded-lg object-contain" />
              </div>
            ) : preview?.kind === "pdf" && preview.dataUrl ? (
              <div className="h-full overflow-hidden rounded-xl border border-panel-border/60 bg-white">
                <iframe src={preview.dataUrl} title={preview.name} className="h-full w-full border-0" />
              </div>
            ) : (
              <div className="theme-subtle-surface flex h-full flex-col items-center justify-center rounded-xl border border-panel-border/60 px-5 text-center">
                <FileText size={22} className="mb-3 text-text-muted/65" />
                <div className="text-sm font-medium text-text-main/88">Preview unavailable</div>
                <div className="mt-2 max-w-xs text-xs leading-6 text-text-muted/70">
                  {preview?.unsupportedReason || "This file type is not supported for inline preview yet."}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="flex h-full min-h-0">
          {fileBookmarks.length > 0 ? (
            <aside className="theme-subtle-surface flex w-12 flex-col items-center gap-2 border-r border-neon-green/15 py-3">
              <div className="chat-scrollbar-hidden flex min-h-0 flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto px-1">
                {fileBookmarks.map((bookmark) => {
                  const isActive = activeBookmarkId === bookmark.targetPath;
                  const Icon = bookmark.isDirectory ? Folder : FileText;
                  return (
                    <button
                      key={bookmark.id}
                      type="button"
                      onClick={() => void openBookmarkedTarget(bookmark)}
                      title={bookmark.label}
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition ${
                        isActive
                          ? "border-neon-green/55 bg-neon-green/12 text-neon-green shadow-glow"
                          : "theme-control-surface border-panel-border text-text-muted/82 hover:border-neon-green/50 hover:text-neon-green"
                      }`}
                    >
                      <Icon size={14} />
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-neon-green/20 px-3 py-2">
              <div className="mb-2 flex min-w-0 items-center gap-1">
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton icon={<Undo2 size={13} />} label="Back" className="h-7 w-7" onClick={() => void onBack()} disabled={!canGoBack} />
                  <IconButton
                    icon={<Forward size={13} />}
                    label="Forward"
                    className="h-7 w-7"
                    onClick={() => void onForward()}
                    disabled={!canGoForward}
                  />
                  <IconButton
                    icon={<ArrowUp size={13} />}
                    label="Up"
                    className="h-7 w-7"
                    onClick={() => parentPath && void openPath(parentPath)}
                    disabled={!parentPath}
                  />
                  {!isVeryCompact ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirmDiscardIfDirty()) {
                          return;
                        }

                        void loadDirectory(null, true);
                      }}
                      className="theme-control-surface grid h-7 w-7 place-items-center rounded-lg border border-panel-border text-text-muted/85 transition hover:border-neon-green/50 hover:text-neon-green"
                    >
                      <Home size={13} />
                    </button>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1" />
                <IconButton
                  icon={<Star size={13} className={activeBookmark ? "fill-current" : ""} />}
                  label={activeBookmark ? "Remove bookmark" : "Add bookmark"}
                  className="h-7 w-7 shrink-0"
                  active={Boolean(activeBookmark)}
                  onClick={() => void toggleBookmark()}
                  disabled={!bookmarkTargetPath}
                />
              </div>
              <div className="glass-field flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-text-muted/85">
                <Search size={13} className="text-neon-green/85" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="embedded-input w-full bg-transparent text-xs text-text-main/90 outline-none placeholder:text-text-muted/40"
                  placeholder="Search files"
                />
              </div>
              <div className="mt-2 truncate text-[10px] uppercase tracking-[0.16em] text-text-muted/50">
                {isCompact ? getFolderName(currentPath) : currentPath}
              </div>
            </div>

            {!isCompact ? (
              <div className="shrink-0 grid grid-cols-[minmax(0,1fr)_110px] border-b border-neon-green/10 px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-text-muted/50 lg:grid-cols-[minmax(0,1fr)_140px_90px]">
                <span>Name</span>
                <span>Modified</span>
                <span className="hidden lg:block">Size</span>
              </div>
            ) : null}

            <div className="chat-scrollbar-hidden min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2 pt-1">
              {loading ? <div className="px-3 py-4 text-xs text-text-muted/75">Loading directory...</div> : null}

              {error ? <div className="px-3 py-3 text-xs text-rose-300/90">{error}</div> : null}

              {!loading && !error && filteredEntries.length === 0 ? (
                <div className="px-3 py-4 text-xs text-text-muted/70">No files matched your search.</div>
              ) : null}

              {!loading && !error
                ? filteredEntries.map((entry) => {
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
                        className={`group mb-1 w-full rounded-lg border px-2 py-2 text-left transition-all duration-150 ${
                          selected
                            ? "border-neon-green/35 bg-neon-green/10 text-neon-green"
                            : "border-transparent text-text-main/78 hover:bg-white/5"
                        } ${entry.isDirectory ? "" : "cursor-grab active:cursor-grabbing"}`}
                        title={entry.isDirectory ? entry.name : `${entry.name} • drag into chat to attach`}
                      >
                        {isCompact ? (
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="flex min-w-0 items-center gap-2">
                              {entry.isDirectory ? (
                                <Folder size={14} className="shrink-0 text-neon-green/90" />
                              ) : (
                                <FileText size={14} className="shrink-0 text-text-muted/78" />
                              )}
                              <span className="truncate text-[12px] font-medium">{entry.name}</span>
                            </span>
                            <span className="flex min-w-0 items-center gap-2 pl-6 text-[11px] text-text-muted/72 group-hover:text-text-main/84">
                              <span className="truncate">{formatModified(entry.modifiedAt)}</span>
                              {!entry.isDirectory ? <span className="shrink-0">{formatFileSize(entry.size)}</span> : null}
                            </span>
                          </span>
                        ) : (
                          <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_110px] items-center lg:grid-cols-[minmax(0,1fr)_140px_90px]">
                            <span className="flex min-w-0 items-center gap-2">
                              {entry.isDirectory ? (
                                <Folder size={14} className="text-neon-green/90" />
                              ) : (
                                <FileText size={14} className="text-text-muted/78" />
                              )}
                              <span className="truncate text-[12px] font-medium">{entry.name}</span>
                            </span>
                            <span className="truncate text-[11px] text-text-muted/75 group-hover:text-text-main/88">
                              {formatModified(entry.modifiedAt)}
                            </span>
                            <span className="hidden text-[11px] text-text-muted/70 group-hover:text-text-main/82 lg:block">
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
