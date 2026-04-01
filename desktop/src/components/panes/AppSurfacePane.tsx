import { useEffect, useMemo, useState } from "react";
import { Activity, Globe, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";
import { getWorkspaceAppDefinition, type WorkspaceAppDefinition, type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";
import { resolveAppSurfacePath } from "./appSurfaceRoute";

interface AppSurfacePaneProps {
  appId: string;
  app?: WorkspaceInstalledAppDefinition | WorkspaceAppDefinition | null;
  resourceId?: string | null;
  view?: string | null;
}

export function AppSurfacePane({ appId, app: providedApp, resourceId, view }: AppSurfacePaneProps) {
  const { refreshInstalledApps, removeInstalledApp } = useWorkspaceDesktop();
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const app = providedApp || getWorkspaceAppDefinition(appId);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState("");
  const [surfaceUrl, setSurfaceUrl] = useState("");
  const [surfaceError, setSurfaceError] = useState("");
  const [isSurfaceLoading, setIsSurfaceLoading] = useState(false);
  const [surfaceReloadKey, setSurfaceReloadKey] = useState(0);
  const label = app?.label ?? appId;
  const ready = app && "ready" in app ? app.ready : false;
  const error = app && "error" in app && typeof app.error === "string" ? app.error : null;
  const summary = app?.summary ?? "";
  const accentClassName = app && "accentClassName" in app ? app.accentClassName : "bg-muted-foreground/40";

  const viewLabel = view ? view.charAt(0).toUpperCase() + view.slice(1) : "Home";
  const addressText = resourceId
    ? `${label.toLowerCase()}://workspace/${viewLabel.toLowerCase()}/${resourceId}`
    : `${label.toLowerCase()}://workspace/${viewLabel.toLowerCase()}`;
  const urlPath = resolveAppSurfacePath({ resourceId, view });
  const iframeKey = useMemo(() => `${surfaceUrl}:${surfaceReloadKey}`, [surfaceReloadKey, surfaceUrl]);

  async function handleRemove() {
    if (isRemoving) return;
    setIsRemoving(true);
    setActionError("");
    try {
      await removeInstalledApp(appId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to remove app.");
    } finally {
      setIsRemoving(false);
      setConfirmRemove(false);
    }
  }

  async function handleRetry() {
    if (isRetrying) return;
    setIsRetrying(true);
    setActionError("");
    try {
      await refreshInstalledApps();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setIsRetrying(false);
    }
  }

  useEffect(() => {
    if (!ready || !selectedWorkspaceId) {
      setSurfaceUrl("");
      setSurfaceError("");
      setIsSurfaceLoading(false);
      setSurfaceReloadKey(0);
      return;
    }

    let cancelled = false;
    setSurfaceUrl("");
    setSurfaceError("");
    setIsSurfaceLoading(true);

    void window.electronAPI.appSurface.resolveUrl(selectedWorkspaceId, appId, urlPath)
      .then((nextUrl) => {
        if (cancelled) {
          return;
        }
        setSurfaceUrl(nextUrl);
        setSurfaceReloadKey(0);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setSurfaceUrl("");
        setSurfaceError(err instanceof Error ? err.message : `Failed to resolve ${label}.`);
      })
      .finally(() => {
        if (!cancelled) {
          setIsSurfaceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appId, label, ready, selectedWorkspaceId, urlPath]);

  // Initializing state
  if (!ready && !error) {
    return (
      <div className="flex h-full min-h-0 gap-2">
        <section className="flex w-[260px] shrink-0 items-center justify-center rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
          <div className="max-w-[200px] text-center">
            <LoaderCircle size={20} className="mx-auto animate-spin text-muted-foreground" />
            <div className="mt-3 text-sm font-medium text-foreground">{label}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Initializing... This may take a few minutes on first setup.
            </div>
          </div>
        </section>
        <section className="flex min-w-0 flex-1 items-center justify-center rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
          <div className="text-center">
            <LoaderCircle size={16} className="mx-auto animate-spin text-muted-foreground" />
            <div className="mt-2 text-xs text-muted-foreground">Waiting for app...</div>
          </div>
        </section>
      </div>
    );
  }

  // Error state
  if (!ready && error) {
    return (
      <div className="flex h-full min-h-0 gap-2">
        <section className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card/80 p-4 shadow-md backdrop-blur-sm">
          <div className="flex items-center gap-2 text-destructive">
            <Activity size={14} />
            <span className="text-[10px] uppercase tracking-widest">App error</span>
          </div>
          <div className="mt-3 text-sm font-semibold text-foreground">{label}</div>
          <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
            <div className="text-xs leading-5 text-foreground">{error}</div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={isRetrying}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {isRetrying ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Retry
            </button>
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={isRemoving}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {isRemoving ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Remove
            </button>
          </div>
          {actionError ? (
            <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {actionError}
            </div>
          ) : null}
        </section>
        <section className="flex min-w-0 flex-1 items-center justify-center rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
          <div className="text-center">
            <Activity size={18} className="mx-auto text-destructive" />
            <div className="mt-2 text-xs text-muted-foreground">App failed to start</div>
          </div>
        </section>
      </div>
    );
  }

  // Ready state — left info card + right browser card
  return (
    <div className="flex h-full min-h-0 gap-2">
      {/* Left: App info card */}
      <section className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
        <div className="flex-1 p-4">
          <div className="flex items-center gap-2.5">
            <span className={`size-2.5 shrink-0 rounded-full ${accentClassName}`} />
            <span className="text-sm font-semibold text-foreground">{label}</span>
          </div>

          {summary ? (
            <p className="mt-2.5 text-xs leading-5 text-muted-foreground">{summary}</p>
          ) : null}

          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">Status</span>
              <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                Running
              </span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">View</span>
              <span className="text-xs font-medium text-foreground">{viewLabel}</span>
            </div>
            {resourceId ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
                <span className="text-xs text-muted-foreground">Resource</span>
                <span className="max-w-[120px] truncate text-xs font-medium text-foreground">{resourceId}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Actions pinned to bottom */}
        <div className="border-t border-border p-3">
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!surfaceUrl) {
                  return;
                }
                setSurfaceError("");
                setIsSurfaceLoading(true);
                setSurfaceReloadKey((current) => current + 1);
              }}
              className="flex h-8 items-center justify-center gap-2 rounded-md border border-border text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <RefreshCw size={12} />
              Reload
            </button>
            {confirmRemove ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleRemove()}
                  disabled={isRemoving}
                  className="flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 text-xs text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-50"
                >
                  {isRemoving ? "Removing..." : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  className="flex h-8 flex-1 items-center justify-center rounded-md border border-border text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="flex h-8 items-center justify-center gap-2 rounded-md border border-border text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Trash2 size={12} />
                Remove app
              </button>
            )}
          </div>

          {actionError ? (
            <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {actionError}
            </div>
          ) : null}
        </div>
      </section>

      {/* Right: Browser card */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
        {/* Browser chrome bar */}
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="size-[10px] rounded-full bg-[#ff5f57]" />
            <span className="size-[10px] rounded-full bg-[#febc2e]" />
            <span className="size-[10px] rounded-full bg-[#28c840]" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1">
            <Globe size={11} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-[11px] text-muted-foreground">{addressText}</span>
          </div>
        </div>

        {/* Viewport */}
        <div className="relative min-h-0 flex-1 p-1.5 pb-1.5">
          <div className="relative h-full w-full overflow-hidden rounded-lg border border-border/35 bg-background">
            {surfaceUrl ? (
              <iframe
                key={iframeKey}
                title={`${label} app surface`}
                src={surfaceUrl}
                className="h-full w-full border-0 bg-white"
                onLoad={() => {
                  setIsSurfaceLoading(false);
                  setSurfaceError("");
                }}
                onError={() => {
                  setIsSurfaceLoading(false);
                  setSurfaceError(`Failed to load ${label}.`);
                }}
              />
            ) : null}

            {surfaceError ? (
              <div className="absolute inset-0 flex items-center justify-center bg-card/96 p-6 text-center">
                <div className="max-w-[320px]">
                  <Activity size={18} className="mx-auto text-destructive" />
                  <div className="mt-3 text-sm font-medium text-foreground">Couldn't open {label}</div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">{surfaceError}</div>
                </div>
              </div>
            ) : null}

            {isSurfaceLoading ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-card/78 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-2">
                  <LoaderCircle size={16} className="animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading {label}...</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
