import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, Globe, LoaderCircle, Plug, RefreshCw, Trash2 } from "lucide-react";
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState("");
  const label = app?.label ?? appId;
  const ready = app && "ready" in app ? app.ready : false;
  const error = app && "error" in app && typeof app.error === "string" ? app.error : null;
  const summary = app?.summary ?? "";
  const accentClassName = app && "accentClassName" in app ? app.accentClassName : "bg-muted-foreground/40";

  const viewLabel = view ? view.charAt(0).toUpperCase() + view.slice(1) : "Home";
  const addressText = resourceId
    ? `${label.toLowerCase()}://workspace/${viewLabel.toLowerCase()}/${resourceId}`
    : `${label.toLowerCase()}://workspace/${viewLabel.toLowerCase()}`;

  // Integration connection status for this app
  const [integrationStatus, setIntegrationStatus] = useState<{ connected: boolean; providerName: string } | null>(null);

  const checkIntegration = useCallback(async () => {
    if (!selectedWorkspaceId) return;
    try {
      const { connections } = await window.electronAPI.workspace.listIntegrationConnections();
      const { providers } = await window.electronAPI.workspace.listIntegrationCatalog();
      // Find provider required by this app via bindings or catalog lookup
      const bindings = await window.electronAPI.workspace.listIntegrationBindings(selectedWorkspaceId);
      const appBinding = bindings.bindings.find(
        (b) => b.target_type === "app" && b.target_id === appId,
      );
      if (appBinding) {
        const conn = connections.find((c) => c.connection_id === appBinding.connection_id);
        const provider = providers.find((p) => p.provider_id === appBinding.integration_key);
        setIntegrationStatus({
          connected: conn?.status === "active",
          providerName: provider?.display_name ?? appBinding.integration_key,
        });
      } else {
        // No binding yet — check if there's a workspace-level default for a known provider
        const knownProviders: Record<string, string> = { gmail: "gmail", sheets: "googlesheets", github: "github", reddit: "reddit", twitter: "twitter", linkedin: "linkedin" };
        const expectedProvider = knownProviders[appId.toLowerCase()];
        if (expectedProvider) {
          const conn = connections.find((c) => c.provider_id === expectedProvider && c.status === "active");
          const provider = providers.find((p) => p.provider_id === expectedProvider);
          setIntegrationStatus({
            connected: Boolean(conn),
            providerName: provider?.display_name ?? expectedProvider,
          });
        }
      }
    } catch {
      // Non-fatal
    }
  }, [appId, selectedWorkspaceId]);

  useEffect(() => {
    void checkIntegration();
  }, [checkIntegration]);

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

  // Navigate BrowserView when app is ready and appId/resourceId/view changes.
  useEffect(() => {
    if (!ready || !selectedWorkspaceId) return;
    const urlPath = resolveAppSurfacePath({ view, resourceId });
    void window.electronAPI.appSurface.navigate(selectedWorkspaceId, appId, urlPath);
    return () => {
      void window.electronAPI.appSurface.destroy(appId);
    };
  }, [appId, ready, selectedWorkspaceId, resourceId, view]);

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
            {integrationStatus ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Plug size={11} />
                  {integrationStatus.providerName}
                </span>
                <span className={`flex items-center gap-1.5 text-xs font-medium ${integrationStatus.connected ? "text-primary" : "text-destructive"}`}>
                  <span className={`size-1.5 rounded-full ${integrationStatus.connected ? "bg-primary" : "bg-destructive"}`} />
                  {integrationStatus.connected ? "Connected" : "Not connected"}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Actions pinned to bottom */}
        <div className="border-t border-border p-3">
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => window.electronAPI.appSurface.reload(appId)}
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

        {/* Viewport — inset so native BrowserView doesn't cover card corners */}
        <div className="relative min-h-0 flex-1 p-1.5 pb-1.5">
          <div ref={viewportRef} className="h-full w-full rounded-lg" />
          <div className="pointer-events-none absolute inset-1.5 flex items-center justify-center rounded-lg">
            <div className="flex flex-col items-center gap-2">
              <LoaderCircle size={16} className="animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading {label}...</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
