import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, ExternalLink, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
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

  async function handleRemove() {
    if (isRemoving) {
      return;
    }
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
    if (isRetrying) {
      return;
    }
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

  // Navigate BrowserView when app is ready and appId/resourceId changes.
  useEffect(() => {
    if (!ready || !selectedWorkspaceId) {
      return;
    }
    const urlPath = resourceId ? `/posts/${resourceId}` : "/";
    void window.electronAPI.appSurface.navigate(selectedWorkspaceId, appId, urlPath);
    return () => {
      void window.electronAPI.appSurface.destroy(appId);
    };
  }, [appId, ready, selectedWorkspaceId, resourceId]);

  // Sync BrowserView bounds with viewport div.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !ready) {
      return;
    }

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

  // Initializing state.
  if (!ready && !error) {
    return (
      <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
        <div className="flex flex-col items-center gap-4">
          <LoaderCircle size={28} className="animate-spin text-neon-green/80" />
          <div className="text-[16px] font-medium text-text-main">{label}</div>
          <div className="max-w-[320px] text-center text-[13px] leading-6 text-text-muted/80">
            Initializing... This may take a few minutes on first setup.
          </div>
        </div>
      </section>
    );
  }

  // Error state.
  if (!ready && error) {
    return (
      <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex items-center gap-2 text-rose-400/86">
            <Activity size={16} />
            <span className="text-[11px] uppercase tracking-[0.16em]">App error</span>
          </div>
          <div className="mt-4 text-[28px] font-semibold tracking-[-0.03em] text-text-main">{label}</div>
          <div className="mt-6 rounded-[20px] border border-rose-400/30 bg-rose-400/10 p-5">
            <div className="text-[13px] leading-7 text-rose-200">{error}</div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={isRetrying}
                className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-neon-green/35 bg-neon-green/10 px-4 text-[12px] font-medium text-neon-green transition hover:bg-neon-green/16 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRetrying ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={isRemoving}
                className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-panel-border/45 px-4 text-[12px] font-medium text-text-muted transition hover:border-rose-400/35 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRemoving ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>Remove</span>
              </button>
            </div>
          </div>
          {actionError ? (
            <div className="mt-4 rounded-[16px] border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-[12px] leading-6 text-rose-200">
              {actionError}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  // Ready state — embedded module web UI.
  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="flex items-center gap-2 border-b border-panel-border/35 px-3 py-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-neon-green" />
        <span className="min-w-0 truncate text-[12px] font-medium text-text-main">{label}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => window.electronAPI.appSurface.reload(appId)}
          className="flex h-7 w-7 items-center justify-center rounded-[8px] text-text-dim/70 transition-colors hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
          aria-label="Reload app"
        >
          <RefreshCw size={13} />
        </button>
        {confirmRemove ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-muted">Remove?</span>
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={isRemoving}
              className="flex h-7 items-center gap-1 rounded-[8px] border border-rose-400/35 bg-rose-400/10 px-2 text-[11px] font-medium text-rose-200 transition hover:bg-rose-400/16 disabled:opacity-60"
            >
              {isRemoving ? <LoaderCircle size={11} className="animate-spin" /> : <Trash2 size={11} />}
              <span>Yes</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="flex h-7 items-center rounded-[8px] border border-panel-border/45 px-2 text-[11px] text-text-muted transition hover:text-text-main"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-text-dim/70 transition-colors hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
            aria-label="Remove app"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {actionError ? (
        <div className="border-b border-rose-400/20 bg-rose-400/8 px-3 py-2 text-[11px] leading-5 text-rose-200">
          {actionError}
        </div>
      ) : null}
      {/* Viewport placeholder — Electron BrowserView renders on top of this div */}
      <div ref={viewportRef} className="relative min-h-0 flex-1">
        {/* Loading fallback visible until BrowserView covers this div */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <LoaderCircle size={20} className="animate-spin text-text-dim/50" />
          <span className="text-[12px] text-text-dim/60">Loading {label}...</span>
        </div>
      </div>
    </section>
  );
}
