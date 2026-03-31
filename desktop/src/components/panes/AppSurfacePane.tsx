import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, ExternalLink, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";
import { getWorkspaceAppDefinition, type WorkspaceAppDefinition, type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";
import { buildAppSurfacePresentation } from "./appSurfacePresentation";

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
  const presentation = buildAppSurfacePresentation({
    appId,
    label,
    summary: app?.summary,
    resourceId,
    view
  });

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
      <div className="flex items-center gap-3 border-b border-panel-border/35 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-neon-green" />
          <div className="min-w-0">
            <div className="truncate text-[11px] uppercase tracking-[0.18em] text-text-dim/76">{presentation.eyebrow}</div>
            <div className="truncate text-[14px] font-semibold text-text-main">{presentation.headline}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-right text-[11px] text-text-dim/72">{presentation.focusLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => window.electronAPI.appSurface.reload(appId)}
          className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-panel-border/35 text-text-dim/70 transition-colors hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
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
            className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-panel-border/35 text-text-dim/70 transition-colors hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
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
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto grid min-h-full max-w-[1320px] gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="theme-subtle-surface hidden min-h-0 flex-col rounded-[26px] border border-panel-border/35 p-5 xl:flex">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-neon-green/12 text-[13px] font-semibold text-neon-green">
                {label.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim/72">{presentation.eyebrow}</div>
                <div className="truncate text-[20px] font-semibold tracking-[-0.03em] text-text-main">{presentation.headline}</div>
              </div>
            </div>
            <p className="mt-4 text-[13px] leading-6 text-text-muted/82">{presentation.description}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {presentation.highlights.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center rounded-full border border-panel-border/35 bg-panel-bg/60 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-text-dim/78"
                >
                  {item}
                </span>
              ))}
            </div>
            <div className="mt-auto rounded-[22px] border border-panel-border/30 bg-panel-bg/42 p-4">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-text-dim/72">
                <ExternalLink size={12} />
                <span>Contained viewport</span>
              </div>
              <p className="mt-3 text-[12px] leading-6 text-text-muted/82">
                The native app surface stays framed inside the workspace stage so the shell keeps its own hierarchy instead
                of feeling covered by the embedded app.
              </p>
            </div>
          </aside>

          <div className="flex min-h-[520px] min-w-0 flex-col rounded-[30px] border border-panel-border/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.58),rgba(255,255,255,0.18))] p-3 shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
            <div className="xl:hidden rounded-[22px] border border-panel-border/30 bg-panel-bg/42 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim/72">{presentation.eyebrow}</div>
              <div className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-text-main">{presentation.headline}</div>
              <p className="mt-2 text-[12px] leading-6 text-text-muted/82">{presentation.description}</p>
            </div>

            <div className="flex items-center justify-between gap-3 px-2 pb-3 pt-2">
              <div className="min-w-0">
                <div className="truncate text-[11px] uppercase tracking-[0.16em] text-text-dim/72">{presentation.focusLabel}</div>
                <div className="truncate text-[13px] text-text-main/88">Embedded workspace stage</div>
              </div>
              <div className="hidden flex-wrap justify-end gap-2 sm:flex">
                {presentation.highlights.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center rounded-full border border-panel-border/30 bg-white/55 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-text-dim/76"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[24px] border border-panel-border/35 bg-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              {/* Viewport placeholder — Electron BrowserView renders on top of this div */}
              <div ref={viewportRef} className="relative h-full min-h-[420px] w-full" />
              {/* Loading fallback visible until BrowserView covers this div */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
                <LoaderCircle size={20} className="animate-spin text-text-dim/50" />
                <span className="text-[12px] text-text-dim/60">Loading {label}...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
