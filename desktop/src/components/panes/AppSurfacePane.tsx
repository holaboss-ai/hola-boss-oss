import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, Globe, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";
import { getWorkspaceAppDefinition, type WorkspaceAppDefinition, type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState("");
  const label = app?.label ?? appId;
  const ready = app && "ready" in app ? app.ready : false;
  const error = app && "error" in app && typeof app.error === "string" ? app.error : null;
  const summary = app?.summary ?? "";
  const accentClassName = app && "accentClassName" in app ? app.accentClassName : "bg-text-dim/40";

  const viewLabel = view ? view.charAt(0).toUpperCase() + view.slice(1) : "Home";
  const addressText = resourceId
    ? `${label.toLowerCase()}://workspace/${viewLabel.toLowerCase()}/${resourceId}`
    : `${label.toLowerCase()}://workspace/${viewLabel.toLowerCase()}`;

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
    if (!ready || !selectedWorkspaceId) return;
    const urlPath = resourceId ? `/posts/${resourceId}` : "/";
    void window.electronAPI.appSurface.navigate(selectedWorkspaceId, appId, urlPath);
    return () => {
      void window.electronAPI.appSurface.destroy(appId);
    };
  }, [appId, ready, selectedWorkspaceId, resourceId]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !ready) return;

    let rafId = 0;
    const syncBounds = () => {
      const rect = viewport.getBoundingClientRect();
      void window.electronAPI.appSurface.setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    const queueSync = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(syncBounds);
    };
    queueSync();

    const observer = new ResizeObserver(queueSync);
    observer.observe(viewport);
    window.addEventListener("resize", queueSync);
    window.setTimeout(queueSync, 100);
    window.setTimeout(queueSync, 400);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", queueSync);
      window.cancelAnimationFrame(rafId);
      void window.electronAPI.appSurface.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    };
  }, [ready]);

  // Initializing state
  if (!ready && !error) {
    return (
      <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden">
        <div className="flex flex-col items-center gap-4">
          <LoaderCircle size={20} className="animate-spin text-text-dim/60" />
          <div className="text-[15px] font-medium text-text-main">{label}</div>
          <div className="max-w-[300px] text-center text-[13px] leading-6 text-text-muted/70">
            Initializing... This may take a few minutes on first setup.
          </div>
        </div>
      </section>
    );
  }

  // Error state
  if (!ready && error) {
    return (
      <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-4">
        <div className="flex items-center gap-2 text-rose-400">
          <Activity size={14} />
          <span className="text-[11px] uppercase tracking-[0.16em]">App error</span>
        </div>
        <div className="mt-3 text-[17px] font-medium text-text-main">{label}</div>
        <div className="mt-4 rounded-[14px] border border-rose-400/25 bg-rose-400/8 p-4">
          <div className="text-[13px] leading-6 text-text-main/80">{error}</div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={isRetrying}
              className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-panel-border/45 px-3 text-[12px] text-text-main transition-colors hover:bg-[var(--theme-hover-bg)] disabled:opacity-50"
            >
              {isRetrying ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={isRemoving}
              className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-panel-border/45 px-3 text-[12px] text-text-muted transition-colors hover:text-text-main disabled:opacity-50"
            >
              {isRemoving ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
              <span>Remove</span>
            </button>
          </div>
        </div>
        {actionError ? (
          <div className="mt-3 rounded-[12px] border border-rose-400/25 bg-rose-400/8 px-3 py-2 text-[12px] text-text-main/80">
            {actionError}
          </div>
        ) : null}
      </section>
    );
  }

  // Ready state — left info + right browser preview
  return (
    <section className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
      {/* Left: App info */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-panel-border/30 p-4">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${accentClassName}`} />
          <span className="text-[15px] font-medium text-text-main">{label}</span>
        </div>

        {summary ? (
          <p className="mt-3 text-[12px] leading-5 text-text-muted/75">{summary}</p>
        ) : null}

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-[10px] border border-panel-border/30 bg-[var(--theme-subtle-bg)] px-3 py-2">
            <span className="text-[11px] text-text-dim/70">Status</span>
            <span className="flex items-center gap-1.5 text-[11px] text-neon-green">
              <span className="h-1.5 w-1.5 rounded-full bg-neon-green" />
              Running
            </span>
          </div>
          <div className="flex items-center justify-between rounded-[10px] border border-panel-border/30 bg-[var(--theme-subtle-bg)] px-3 py-2">
            <span className="text-[11px] text-text-dim/70">View</span>
            <span className="text-[11px] text-text-main">{viewLabel}</span>
          </div>
          {resourceId ? (
            <div className="flex items-center justify-between rounded-[10px] border border-panel-border/30 bg-[var(--theme-subtle-bg)] px-3 py-2">
              <span className="text-[11px] text-text-dim/70">Resource</span>
              <span className="max-w-[140px] truncate text-[11px] text-text-main">{resourceId}</span>
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="mt-auto flex flex-col gap-2 pt-4">
          <button
            type="button"
            onClick={() => window.electronAPI.appSurface.reload(appId)}
            className="flex h-9 items-center justify-center gap-2 rounded-[10px] border border-panel-border/35 text-[12px] text-text-muted transition-colors hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
          >
            <RefreshCw size={12} />
            <span>Reload</span>
          </button>
          {confirmRemove ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={isRemoving}
                className="flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] border border-rose-400/30 bg-rose-400/10 text-[12px] text-rose-400 transition-colors hover:bg-rose-400/16 disabled:opacity-50"
              >
                {isRemoving ? "Removing..." : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="flex h-9 flex-1 items-center justify-center rounded-[10px] border border-panel-border/35 text-[12px] text-text-muted transition-colors hover:text-text-main"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="flex h-9 items-center justify-center gap-2 rounded-[10px] border border-panel-border/35 text-[12px] text-text-muted transition-colors hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
            >
              <Trash2 size={12} />
              <span>Remove app</span>
            </button>
          )}
        </div>

        {actionError ? (
          <div className="mt-2 rounded-[10px] border border-rose-400/25 bg-rose-400/8 px-3 py-2 text-[11px] text-rose-400">
            {actionError}
          </div>
        ) : null}
      </div>

      {/* Right: Browser preview */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-panel-border/30 px-3 py-2">
          <div className="flex items-center gap-1.5 pr-1">
            <span className="h-[10px] w-[10px] rounded-full bg-[#ff5f57]/80" />
            <span className="h-[10px] w-[10px] rounded-full bg-[#febc2e]/80" />
            <span className="h-[10px] w-[10px] rounded-full bg-[#28c840]/80" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-3 py-1">
            <Globe size={11} className="shrink-0 text-text-dim/45" />
            <span className="truncate text-[11px] text-text-muted/60">{addressText}</span>
          </div>
        </div>

        {/* Viewport — BrowserView renders on top */}
        <div className="relative min-h-0 flex-1 p-2 pb-2 pr-2">
          <div className="relative h-full w-full overflow-hidden rounded-[12px] border border-panel-border/25">
            <div ref={viewportRef} className="h-full w-full" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[12px]">
              <div className="flex flex-col items-center gap-2">
                <LoaderCircle size={16} className="animate-spin text-text-dim/40" />
                <span className="text-[12px] text-text-dim/50">Loading {label}...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
