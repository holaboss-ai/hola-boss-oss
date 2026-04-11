import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, FileWarning, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleMarkdown } from "@/components/marketplace/SimpleMarkdown";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

type InternalSurfaceType = "document" | "preview" | "file" | "event";

interface InternalSurfacePaneProps {
  surface: InternalSurfaceType;
  resourceId?: string | null;
  htmlContent?: string | null;
}

const MARKDOWN_PREVIEW_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);
type TextPreviewMode = "edit" | "preview";

function resolveWorkspaceTargetPath(
  workspaceRoot: string,
  resourceId: string,
): string {
  const trimmedRoot = workspaceRoot.trim();
  const trimmedResource = resourceId.trim();
  if (!trimmedRoot) {
    return trimmedResource;
  }
  if (/^(?:[a-zA-Z]:[\\/]|\/)/.test(trimmedResource)) {
    return trimmedResource;
  }
  const separator = trimmedRoot.includes("\\") ? "\\" : "/";
  const normalizedRoot = trimmedRoot.replace(/[\\/]+$/, "");
  const normalizedResource = trimmedResource.replace(/^[\\/]+/, "");
  return `${normalizedRoot}${separator}${normalizedResource}`;
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

export function InternalSurfacePane({
  surface,
  resourceId,
  htmlContent,
}: InternalSurfacePaneProps) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewDraft, setPreviewDraft] = useState("");
  const [textPreviewMode, setTextPreviewMode] =
    useState<TextPreviewMode>("edit");
  const [activeTableSheetIndex, setActiveTableSheetIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const openPreviewLink = useCallback((url: string) => {
    void window.electronAPI.ui.openExternalUrl(url);
  }, []);

  useEffect(() => {
    if (
      typeof resourceId !== "string" ||
      !resourceId ||
      (surface !== "document" && surface !== "file")
    ) {
      setPreview(null);
      setPreviewDraft("");
      setTextPreviewMode("edit");
      setActiveTableSheetIndex(0);
      setErrorMessage("");
      setIsLoading(false);
      setIsSaving(false);
      return;
    }

    const targetResource: string = resourceId;

    let cancelled = false;

    async function loadPreview() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        let targetPath = targetResource;
        if (selectedWorkspaceId) {
          const workspaceRoot =
            await window.electronAPI.workspace.getWorkspaceRoot(
              selectedWorkspaceId,
            );
          if (cancelled) {
            return;
          }
          targetPath = resolveWorkspaceTargetPath(
            workspaceRoot,
            targetResource,
          );
        }
        const nextPreview = await window.electronAPI.fs.readFilePreview(
          targetPath,
          selectedWorkspaceId ?? null,
        );
        if (!cancelled) {
          setPreview(nextPreview);
          setPreviewDraft(nextPreview.content ?? "");
          setTextPreviewMode("edit");
          setActiveTableSheetIndex(0);
          setIsSaving(false);
        }
      } catch (error) {
        if (!cancelled) {
          setPreview(null);
          setPreviewDraft("");
          setTextPreviewMode("edit");
          setActiveTableSheetIndex(0);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load output preview.",
          );
          setIsSaving(false);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [resourceId, selectedWorkspaceId, surface]);

  const isMarkdownPreview = isMarkdownPreviewPayload(preview);
  const isDirty =
    preview?.kind === "text" && preview.isEditable
      ? previewDraft !== (preview.content ?? "")
      : false;

  const savePreview = useCallback(async () => {
    if (!preview || preview.kind !== "text" || !preview.isEditable) {
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      const nextPreview = await window.electronAPI.fs.writeTextFile(
        preview.absolutePath,
        previewDraft,
        selectedWorkspaceId ?? null,
      );
      setPreview(nextPreview);
      setPreviewDraft(nextPreview.content ?? "");
      setTextPreviewMode(
        isMarkdownPreviewPayload(nextPreview) ? textPreviewMode : "edit",
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save file.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [preview, previewDraft, selectedWorkspaceId, textPreviewMode]);

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
              {isMarkdownPreview ? (
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
        preview.tableSheets[
          Math.min(activeTableSheetIndex, preview.tableSheets.length - 1)
        ];
      if (activeSheet) {
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {preview.tableSheets.length > 1 ? (
              <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 px-3 py-2">
                {preview.tableSheets.map((sheet, index) => {
                  const isActive = index === activeTableSheetIndex;
                  return (
                    <Button
                      key={`${sheet.name}-${sheet.index}`}
                      type="button"
                      variant={isActive ? "secondary" : "ghost"}
                      size="xs"
                      onClick={() => setActiveTableSheetIndex(index)}
                    >
                      {sheet.name}
                    </Button>
                  );
                })}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-max min-w-full border-collapse text-xs">
                <thead className="sticky top-0 z-[1] bg-muted">
                  <tr>
                    <th className="border-b border-r border-border/30 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">
                      #
                    </th>
                    {activeSheet.columns.map((column, columnIndex) => (
                      <th
                        key={`${column}-${columnIndex}`}
                        className="border-b border-r border-border/30 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSheet.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={activeSheet.columns.length + 1}
                        className="px-3 py-6 text-center text-xs text-muted-foreground"
                      >
                        No rows in this sheet.
                      </td>
                    </tr>
                  ) : (
                    activeSheet.rows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`} className="hover:bg-muted/30">
                        <td className="border-b border-r border-border/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                          {rowIndex + 1}
                        </td>
                        {row.map((value, columnIndex) => (
                          <td
                            key={`cell-${rowIndex}-${columnIndex}`}
                            className="max-w-[320px] border-b border-r border-border/20 px-2.5 py-1.5"
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
          </div>
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
