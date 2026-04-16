import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, FileWarning, Loader2, Save } from "lucide-react";
import {
  areTablePreviewSheetsEqual,
  cloneTablePreviewSheets,
  SpreadsheetEditor,
} from "@/components/panes/SpreadsheetEditor";
import { Button } from "@/components/ui/button";
import { SimpleMarkdown } from "@/components/marketplace/SimpleMarkdown";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

type InternalSurfaceType = "document" | "preview" | "file" | "event";

interface InternalSurfacePaneProps {
  surface: InternalSurfaceType;
  resourceId?: string | null;
  htmlContent?: string | null;
  onResourceMissing?: (resourceId: string) => void;
  onOpenLinkInBrowser?: (url: string) => void;
}

const MARKDOWN_PREVIEW_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);
const HTML_PREVIEW_EXTENSIONS = new Set([".html", ".htm"]);
type TextPreviewMode = "edit" | "preview";

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

function isHtmlPreviewPayload(
  preview: Pick<FilePreviewPayload, "kind" | "extension"> | null | undefined,
): boolean {
  if (!preview || preview.kind !== "text") {
    return false;
  }
  return HTML_PREVIEW_EXTENSIONS.has(preview.extension.trim().toLowerCase());
}

function isMissingFilePreviewError(cause: unknown) {
  if (!(cause instanceof Error)) {
    return false;
  }
  return (
    /\bENOENT\b/i.test(cause.message) ||
    /no such file or directory/i.test(cause.message)
  );
}

export function InternalSurfacePane({
  surface,
  resourceId,
  htmlContent,
  onResourceMissing,
  onOpenLinkInBrowser,
}: InternalSurfacePaneProps) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(
    null,
  );
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewDraft, setPreviewDraft] = useState("");
  const [tablePreviewDraft, setTablePreviewDraft] = useState<
    FilePreviewTableSheetPayload[]
  >([]);
  const [textPreviewMode, setTextPreviewMode] =
    useState<TextPreviewMode>("edit");
  const [activeTableSheetIndex, setActiveTableSheetIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const isDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  const pendingExternalRefreshPathRef = useRef<string | null>(null);
  const openPreviewLink = useCallback((url: string) => {
    if (onOpenLinkInBrowser) {
      onOpenLinkInBrowser(url);
      return;
    }
    void window.electronAPI.ui.openExternalUrl(url);
  }, [onOpenLinkInBrowser]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setWorkspaceRootPath(null);
      return;
    }

    let cancelled = false;

    void window.electronAPI.workspace
      .getWorkspaceRoot(selectedWorkspaceId)
      .then((workspaceRoot) => {
        if (cancelled) {
          return;
        }
        setWorkspaceRootPath(workspaceRoot || null);
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceRootPath(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceId]);

  const resolveWorkspacePreviewPath = useCallback(
    async (targetPath: string) => {
      const normalizedTargetPath = targetPath.trim();
      const normalizedWorkspaceId = selectedWorkspaceId?.trim() || "";

      if (
        !normalizedWorkspaceId ||
        !normalizedTargetPath ||
        !isAbsolutePath(normalizedTargetPath)
      ) {
        return normalizedTargetPath;
      }

      let resolvedWorkspaceRoot = workspaceRootPath?.trim() || "";
      if (!resolvedWorkspaceRoot) {
        try {
          resolvedWorkspaceRoot = (
            await window.electronAPI.workspace.getWorkspaceRoot(
              normalizedWorkspaceId,
            )
          ).trim();
        } catch {
          resolvedWorkspaceRoot = "";
        }
      }

      if (
        !resolvedWorkspaceRoot ||
        !isPathWithin(resolvedWorkspaceRoot, normalizedTargetPath)
      ) {
        return null;
      }

      return normalizedTargetPath;
    },
    [selectedWorkspaceId, workspaceRootPath],
  );

  const loadPreviewFromDisk = useCallback(
    async (
      targetPath: string,
      options?: {
        preserveViewState?: boolean;
        showLoading?: boolean;
      },
    ) => {
      const preserveViewState = options?.preserveViewState ?? false;
      const showLoading = options?.showLoading ?? true;
      if (showLoading) {
        setIsLoading(true);
      }
      setErrorMessage("");
      try {
        const resolvedTargetPath = await resolveWorkspacePreviewPath(targetPath);
        if (!resolvedTargetPath) {
          setPreview(null);
          setPreviewDraft("");
          setTablePreviewDraft([]);
          setTextPreviewMode("edit");
          setActiveTableSheetIndex(0);
          setErrorMessage("");
          setIsSaving(false);
          return;
        }
        const nextPreview = await window.electronAPI.fs.readFilePreview(
          resolvedTargetPath,
          selectedWorkspaceId ?? null,
        );
        setPreview(nextPreview);
        setPreviewDraft(nextPreview.content ?? "");
        setTablePreviewDraft(cloneTablePreviewSheets(nextPreview.tableSheets));
        setTextPreviewMode((currentMode) =>
          preserveViewState &&
          (isMarkdownPreviewPayload(nextPreview) ||
            isHtmlPreviewPayload(nextPreview))
            ? currentMode
            : isMarkdownPreviewPayload(nextPreview) ||
                isHtmlPreviewPayload(nextPreview)
              ? "preview"
              : "edit",
        );
        if (!preserveViewState) {
          setActiveTableSheetIndex(0);
        }
        setIsSaving(false);
      } catch (error) {
        setPreview(null);
        setPreviewDraft("");
        setTablePreviewDraft([]);
        setTextPreviewMode("edit");
        setActiveTableSheetIndex(0);
        if (isMissingFilePreviewError(error)) {
          setErrorMessage("");
          onResourceMissing?.(targetPath);
          setIsSaving(false);
          return;
        }
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load output preview.",
        );
        setIsSaving(false);
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [onResourceMissing, resolveWorkspacePreviewPath, selectedWorkspaceId],
  );

  useEffect(() => {
    if (
      typeof resourceId !== "string" ||
      !resourceId ||
      (surface !== "document" && surface !== "file")
    ) {
      setPreview(null);
      setPreviewDraft("");
      setTablePreviewDraft([]);
      setTextPreviewMode("edit");
      setActiveTableSheetIndex(0);
      setErrorMessage("");
      setIsLoading(false);
      setIsSaving(false);
      pendingExternalRefreshPathRef.current = null;
      return;
    }

    pendingExternalRefreshPathRef.current = null;
    void loadPreviewFromDisk(resourceId, { showLoading: true });
    return () => {
      pendingExternalRefreshPathRef.current = null;
    };
  }, [loadPreviewFromDisk, resourceId, surface]);

  const isMarkdownPreview = isMarkdownPreviewPayload(preview);
  const isHtmlPreview = isHtmlPreviewPayload(preview);
  const supportsRenderedTextPreview = isMarkdownPreview || isHtmlPreview;
  const isDirty =
    preview?.kind === "text" && preview.isEditable
      ? previewDraft !== (preview.content ?? "")
      : preview?.kind === "table" && preview.isEditable
        ? !areTablePreviewSheetsEqual(tablePreviewDraft, preview.tableSheets)
        : false;

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    const watchedPath = preview?.absolutePath?.trim() || "";
    if (!watchedPath || (surface !== "document" && surface !== "file")) {
      return;
    }

    let cancelled = false;
    let subscriptionId = "";
    const unsubscribe = window.electronAPI.fs.onFileChange((payload) => {
      const changedPath = payload.absolutePath.trim();
      if (cancelled || changedPath !== watchedPath) {
        return;
      }
      if (isSavingRef.current) {
        return;
      }
      if (isDirtyRef.current) {
        pendingExternalRefreshPathRef.current = changedPath;
        return;
      }
      pendingExternalRefreshPathRef.current = null;
      void loadPreviewFromDisk(changedPath, {
        preserveViewState: true,
        showLoading: false,
      });
    });

    void (async () => {
      const resolvedWatchedPath =
        await resolveWorkspacePreviewPath(watchedPath);
      if (!resolvedWatchedPath) {
        return;
      }
      const subscription = await window.electronAPI.fs.watchFile(
        resolvedWatchedPath,
        selectedWorkspaceId ?? null,
      );
      if (cancelled) {
        void window.electronAPI.fs.unwatchFile(subscription.subscriptionId);
        return;
      }
      subscriptionId = subscription.subscriptionId;
    })().catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe();
      if (subscriptionId) {
        void window.electronAPI.fs.unwatchFile(subscriptionId);
      }
    };
  }, [
    loadPreviewFromDisk,
    preview?.absolutePath,
    resolveWorkspacePreviewPath,
    selectedWorkspaceId,
    surface,
  ]);

  useEffect(() => {
    if (isDirty || isSaving) {
      return;
    }
    const pendingPath = pendingExternalRefreshPathRef.current;
    if (!pendingPath) {
      return;
    }
    pendingExternalRefreshPathRef.current = null;
    void loadPreviewFromDisk(pendingPath, {
      preserveViewState: true,
      showLoading: false,
    });
  }, [isDirty, isSaving, loadPreviewFromDisk]);

  const savePreview = useCallback(async () => {
    if (!preview || !preview.isEditable) {
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      const nextPreview =
        preview.kind === "table"
          ? await window.electronAPI.fs.writeTableFile(
              preview.absolutePath,
              tablePreviewDraft,
              selectedWorkspaceId ?? null,
            )
          : await window.electronAPI.fs.writeTextFile(
              preview.absolutePath,
              previewDraft,
              selectedWorkspaceId ?? null,
            );
      setPreview(nextPreview);
      setPreviewDraft(nextPreview.content ?? "");
      setTablePreviewDraft(cloneTablePreviewSheets(nextPreview.tableSheets));
      setTextPreviewMode(
        isMarkdownPreviewPayload(nextPreview) || isHtmlPreviewPayload(nextPreview)
          ? textPreviewMode
          : "edit",
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save file.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    preview,
    previewDraft,
    selectedWorkspaceId,
    tablePreviewDraft,
    textPreviewMode,
  ]);

  const body = useMemo(() => {
    if (surface === "event") {
      return (
        <EmptyState
          title="Event detail"
          detail="This output remains inside Holaboss and does not resolve to a file-backed preview."
        />
      );
    }

    if (surface === "preview") {
      if (htmlContent && htmlContent.trim()) {
        return (
          <div className="grid min-h-0 gap-3">
            <iframe
              title="Output preview"
              sandbox=""
              srcDoc={htmlContent}
              className="min-h-[60vh] w-full rounded-[18px] border border-border/35 bg-white"
            />
          </div>
        );
      }
      return (
        <EmptyState
          title="Preview surface"
          detail="Structured preview rendering is not available for this output."
        />
      );
    }

    if (!resourceId) {
      return (
        <EmptyState
          title="No target"
          detail="This output does not include a file target yet."
        />
      );
    }

    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading file preview...</span>
          </div>
        </div>
      );
    }

    if (errorMessage) {
      return (
        <EmptyState title="Preview failed" detail={errorMessage} tone="error" />
      );
    }

    if (!preview) {
      return (
        <EmptyState
          title="No preview"
          detail="File preview is not available yet."
        />
      );
    }

    if (preview.kind === "text") {
      return (
        <div className="flex h-full min-h-0 flex-col">
          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 px-4 py-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">{preview.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {new Date(preview.modifiedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                {preview.size != null ? ` · ${formatPreviewSize(preview.size)}` : ""}
                {isDirty ? " · Unsaved changes" : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {supportsRenderedTextPreview ? (
                <div className="inline-flex items-center rounded-md border border-border bg-muted/50 p-0.5">
                  <Button
                    type="button"
                    variant={textPreviewMode === "preview" ? "secondary" : "ghost"}
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
              {preview.isEditable ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void savePreview()}
                  disabled={!isDirty || isSaving}
                >
                  <Save size={12} />
                  {isSaving ? "Saving" : "Save"}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-auto">
            {isMarkdownPreview && textPreviewMode === "preview" ? (
              <div className="mx-auto max-w-2xl px-6 py-6">
                {previewDraft.trim() ? (
                  <SimpleMarkdown
                    className="chat-markdown text-sm leading-7 text-foreground"
                    onLinkClick={openPreviewLink}
                  >
                    {previewDraft}
                  </SimpleMarkdown>
                ) : (
                  <div className="py-12 text-center text-xs text-muted-foreground">
                    Empty file — switch to Edit to add content.
                  </div>
                )}
              </div>
            ) : isHtmlPreview && textPreviewMode === "preview" ? (
              previewDraft.trim() ? (
                <div className="h-full overflow-hidden bg-muted/20 p-4">
                  <iframe
                    title={preview.name}
                    sandbox=""
                    srcDoc={previewDraft}
                    className="h-full w-full rounded-lg border border-border bg-white"
                  />
                </div>
              ) : (
                <div className="grid h-full place-items-center px-6 text-center">
                  <div className="text-xs text-muted-foreground">
                    Empty file — switch to Edit to add markup.
                  </div>
                </div>
              )
            ) : (
              <textarea
                value={previewDraft}
                onChange={(event) => setPreviewDraft(event.target.value)}
                readOnly={!preview.isEditable}
                spellCheck={false}
                className={`h-full min-h-full w-full resize-none border-0 bg-transparent px-6 py-5 font-mono text-[13px] leading-6 text-foreground outline-none ${
                  preview.isEditable ? "" : "cursor-default opacity-80"
                }`}
              />
            )}
          </div>
        </div>
      );
    }

    if (preview.kind === "image" && preview.dataUrl) {
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-muted/20 p-6">
          <img
            src={preview.dataUrl}
            alt={preview.name}
            className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
          />
        </div>
      );
    }

    if (preview.kind === "pdf" && preview.dataUrl) {
      return (
        <iframe
          title={preview.name}
          src={preview.dataUrl}
          className="h-full w-full border-0"
        />
      );
    }

    if (
      preview.kind === "table" &&
      preview.tableSheets &&
      preview.tableSheets.length > 0
    ) {
      const activeSheet =
        tablePreviewDraft[
          Math.min(activeTableSheetIndex, tablePreviewDraft.length - 1)
        ];
      if (activeSheet) {
        return (
          <SpreadsheetEditor
            sheets={tablePreviewDraft}
            activeSheetIndex={activeTableSheetIndex}
            onActiveSheetIndexChange={setActiveTableSheetIndex}
            editable={preview.isEditable}
            readOnlyReason={
              activeSheet.truncated
                ? "Trimmed previews are read-only"
                : preview.extension === ".xls"
                  ? "Legacy .xls files are read-only"
                  : null
            }
            onChange={setTablePreviewDraft}
          />
        );
      }
    }

    return (
      <EmptyState
        title="Preview unavailable"
        detail={
          preview.unsupportedReason ||
          "This file type is not yet previewable."
        }
      />
    );
  }, [
    activeTableSheetIndex,
    errorMessage,
    htmlContent,
    isHtmlPreview,
    isLoading,
    isDirty,
    isMarkdownPreview,
    isSaving,
    openPreviewLink,
    preview,
    previewDraft,
    resourceId,
    savePreview,
    surface,
    supportsRenderedTextPreview,
    tablePreviewDraft,
    textPreviewMode,
  ]);

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-background">
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </section>
  );
}

function formatPreviewSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/50 px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 break-all text-xs text-foreground">
        {value}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  tone = "neutral",
}: {
  title: string;
  detail: string;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      className={`flex h-full items-center justify-center rounded-[20px] border px-6 py-8 text-center ${
        tone === "error"
          ? "border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.08)]"
          : "border-border/35 bg-black/10"
      }`}
    >
      <div className="max-w-[520px]">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-border/35 text-primary/80">
          {tone === "error" ? (
            <FileWarning size={18} />
          ) : (
            <FileText size={18} />
          )}
        </div>
        <div className="mt-3 text-[16px] font-medium text-foreground">
          {title}
        </div>
        <div className="mt-2 text-[12px] leading-6 text-muted-foreground/82">
          {detail}
        </div>
      </div>
    </div>
  );
}
