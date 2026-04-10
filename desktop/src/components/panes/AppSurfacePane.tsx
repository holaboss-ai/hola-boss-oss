import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, LoaderCircle, Plug, RefreshCw, Trash2 } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";
import { getWorkspaceAppDefinition, type WorkspaceAppDefinition, type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";
import { resolveAppSurfacePath } from "./appSurfaceRoute";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState("");
  const [frameUrl, setFrameUrl] = useState("");
  const [frameLoading, setFrameLoading] = useState(false);
  const [frameError, setFrameError] = useState("");

  const label = app?.label ?? appId;
  const ready = app && "ready" in app ? app.ready : false;
  const error = app && "error" in app && typeof app.error === "string" ? app.error : null;
  const summary = app?.summary ?? "";
  const accentClassName = app && "accentClassName" in app ? app.accentClassName : "bg-muted-foreground/40";

  const routePath = useMemo(
    () => resolveAppSurfacePath({ resourceId, view }),
    [resourceId, view],
  );

  // Integration connection status for this app
  const [integrationStatus, setIntegrationStatus] = useState<{ connected: boolean; providerName: string } | null>(null);

  const checkIntegration = useCallback(async () => {
    if (!selectedWorkspaceId) return;
    try {
      const { connections } = await window.electronAPI.workspace.listIntegrationConnections();
      const { providers } = await window.electronAPI.workspace.listIntegrationCatalog();
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

  // Resolve iframe URL when app is ready
  useEffect(() => {
    if (!ready || !selectedWorkspaceId) {
      setFrameUrl("");
      setFrameLoading(false);
      setFrameError("");
      return;
    }

    let cancelled = false;
    setFrameLoading(true);
    setFrameError("");

    void window.electronAPI.appSurface.resolveUrl(
      selectedWorkspaceId,
      appId,
      routePath,
    )
      .then((url) => {
        if (!cancelled) setFrameUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFrameError(err instanceof Error ? err.message : "Failed to resolve app URL.");
          setFrameLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [appId, ready, reloadKey, routePath, selectedWorkspaceId]);

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
    setFrameError("");
    try {
      await refreshInstalledApps();
      setReloadKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setIsRetrying(false);
    }
  }

  // Initializing state
  if (!ready && !error) {
    return (
      <div className="flex h-full min-h-0 gap-2">
        <Card className="flex w-[260px] shrink-0 items-center justify-center shadow-md backdrop-blur-sm bg-card/80">
          <div className="max-w-[200px] text-center">
            <LoaderCircle size={20} className="mx-auto animate-spin text-muted-foreground" />
            <div className="mt-3 text-sm font-medium text-foreground">{label}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Initializing... This may take a few minutes on first setup.
            </div>
          </div>
        </Card>
        <Card className="flex min-w-0 flex-1 items-center justify-center shadow-md backdrop-blur-sm bg-card/80">
          <div className="text-center">
            <LoaderCircle size={16} className="mx-auto animate-spin text-muted-foreground" />
            <div className="mt-2 text-xs text-muted-foreground">Waiting for app...</div>
          </div>
        </Card>
      </div>
    );
  }

  // Error state
  if (!ready && error) {
    return (
      <div className="flex h-full min-h-0 gap-2">
        <Card className="w-[260px] shrink-0 p-4 shadow-md backdrop-blur-sm bg-card/80">
          <div className="flex items-center gap-2 text-destructive">
            <Activity size={14} />
            <span className="text-[10px] uppercase tracking-widest">App error</span>
          </div>
          <div className="mt-3 text-sm font-semibold text-foreground">{label}</div>
          <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
            <div className="text-xs leading-5 text-foreground">{error}</div>
          </div>
          <div className="mt-3">
            <Button
              variant="outline"
              onClick={() => void handleRemove()}
              disabled={isRemoving}
              className="gap-2 text-xs text-muted-foreground"
            >
              {isRemoving ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Remove
            </Button>
          </div>
          {actionError ? (
            <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {actionError}
            </div>
          ) : null}
        </Card>
        <Card className="flex min-w-0 flex-1 items-center justify-center shadow-md backdrop-blur-sm bg-card/80">
          <div className="text-center">
            <Activity size={18} className="mx-auto text-destructive" />
            <div className="mt-2 text-xs text-muted-foreground">App failed to start</div>
          </div>
        </Card>
      </div>
    );
  }

  // Ready state — left info card + right iframe
  return (
    <div className="flex h-full min-h-0 gap-2">
      {/* Left: App info card */}
      <Card className="w-[260px] shrink-0 shadow-md backdrop-blur-sm bg-card/80">
        <div className="chat-scrollbar-hidden flex-1 overflow-y-auto p-4">
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
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Running
              </span>
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
                <span className={`flex items-center gap-1.5 text-xs font-medium ${integrationStatus.connected ? "text-emerald-500" : "text-destructive"}`}>
                  <span className={`size-1.5 rounded-full ${integrationStatus.connected ? "bg-emerald-500" : "bg-destructive"}`} />
                  {integrationStatus.connected ? "Connected" : "Not connected"}
                </span>
              </div>
            ) : null}
          </div>

          {app && "tools" in app && app.tools && app.tools.length > 0 ? (
            <div className="mt-4">
              <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Tools ({app.tools.length})
              </div>
              <div className="mt-2 space-y-0.5">
                {app.tools.map((tool) => (
                  <div key={tool.name} className="rounded-md px-2 py-1.5">
                    <div className="text-[11px] font-medium text-foreground/80">{tool.name}</div>
                    <div className="text-[10px] leading-relaxed text-muted-foreground">{tool.description}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Actions pinned to bottom */}
        <div className="border-t border-border p-3">
          <div className="flex flex-col gap-1.5">
            <Button
              variant="outline"
              onClick={() => setReloadKey((k) => k + 1)}
              className="w-full gap-2 text-xs text-muted-foreground"
            >
              <RefreshCw size={12} />
              Reload
            </Button>
            {confirmRemove ? (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="destructive"
                  onClick={() => void handleRemove()}
                  disabled={isRemoving}
                  className="flex-1 gap-2 text-xs"
                >
                  {isRemoving ? "Removing..." : "Confirm"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirmRemove(false)}
                  className="flex-1 text-xs text-muted-foreground"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setConfirmRemove(true)}
                className="w-full gap-2 text-xs text-muted-foreground"
              >
                <Trash2 size={12} />
                Remove app
              </Button>
            )}
          </div>

          {actionError ? (
            <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {actionError}
            </div>
          ) : null}
        </div>
      </Card>

      {/* Right: App iframe */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-md shadow-black/5">
        <div className="relative min-h-0 flex-1 ring-1 ring-inset ring-border/50 shadow-[inset_0_2px_6px_rgba(0,0,0,0.08)]" style={{ borderRadius: "inherit" }}>
          {frameUrl ? (
            <iframe
              key={`${frameUrl}:${reloadKey}`}
              src={frameUrl}
              title={`${label} surface`}
              className="h-full w-full border-0"
              onLoad={() => {
                setFrameLoading(false);
                setFrameError("");
              }}
            />
          ) : null}
          {frameLoading ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80">
              <div className="text-center">
                <LoaderCircle size={18} className="mx-auto animate-spin text-muted-foreground" />
                <div className="mt-2 text-xs text-muted-foreground">Loading {label}...</div>
              </div>
            </div>
          ) : null}
          {frameError ? (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="max-w-sm rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-center">
                <div className="text-sm font-medium text-foreground">App preview unavailable</div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">{frameError}</div>
                <Button
                  variant="outline"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="mt-3 gap-2 text-xs text-foreground"
                >
                  <RefreshCw size={12} />
                  Retry
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
