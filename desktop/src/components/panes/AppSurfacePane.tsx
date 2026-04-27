import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, LoaderCircle, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providerIcon } from "@/components/onboarding/constants";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";
import {
  getWorkspaceAppDefinition,
  type WorkspaceAppDefinition,
  type WorkspaceInstalledAppDefinition,
} from "@/lib/workspaceApps";
import { resolveAppSurfacePath } from "./appSurfaceRoute";

interface AppSurfacePaneProps {
  appId: string;
  app?: WorkspaceInstalledAppDefinition | WorkspaceAppDefinition | null;
  path?: string | null;
  resourceId?: string | null;
  view?: string | null;
}

export function AppSurfacePane({
  appId,
  app: providedApp,
  path,
  resourceId,
  view,
}: AppSurfacePaneProps) {
  const { refreshInstalledApps, removeInstalledApp } = useWorkspaceDesktop();
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const app = providedApp || getWorkspaceAppDefinition(appId);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState("");
  const [wasRemoved, setWasRemoved] = useState(false);
  const [frameUrl, setFrameUrl] = useState("");
  const [frameLoading, setFrameLoading] = useState(false);
  const [frameError, setFrameError] = useState("");

  const label = app?.label ?? appId;
  const ready = app && "ready" in app ? app.ready : false;
  const error =
    app && "error" in app && typeof app.error === "string" ? app.error : null;
  const summary = app?.summary ?? "";
  const brandIcon = providerIcon(appId, 22);
  const iconFallback = label.slice(0, 2).toUpperCase();

  const routePath = useMemo(
    () => resolveAppSurfacePath({ path, resourceId, view }),
    [path, resourceId, view],
  );

  // Per-app integration binding: which user-global account this workspace's
  // copy of the app should use. Connections are user-global; the binding
  // (target_type="app") is workspace+app scoped.
  const [integrationContext, setIntegrationContext] = useState<{
    providerId: string;
    providerName: string;
    candidates: IntegrationConnectionPayload[];
    currentBindingId: string | null;
    currentConnectionId: string | null;
  } | null>(null);
  const [bindingBusy, setBindingBusy] = useState(false);

  const checkIntegration = useCallback(async () => {
    if (!selectedWorkspaceId) return;
    try {
      const [{ connections }, { providers }, bindingsResult] =
        await Promise.all([
          window.electronAPI.workspace.listIntegrationConnections(),
          window.electronAPI.workspace.listIntegrationCatalog(),
          window.electronAPI.workspace.listIntegrationBindings(
            selectedWorkspaceId,
          ),
        ]);

      // Resolve the expected provider for this app: prefer any existing
      // app-level binding (which encodes the integration_key authoritatively),
      // otherwise fall back to a static appId → provider mapping.
      const knownProviders: Record<string, string> = {
        gmail: "gmail",
        sheets: "googlesheets",
        github: "github",
        reddit: "reddit",
        twitter: "twitter",
        linkedin: "linkedin",
      };
      const appBinding = bindingsResult.bindings.find(
        (b) => b.target_type === "app" && b.target_id === appId,
      );
      const providerId =
        appBinding?.integration_key ?? knownProviders[appId.toLowerCase()];
      if (!providerId) {
        setIntegrationContext(null);
        return;
      }

      const provider = providers.find((p) => p.provider_id === providerId);
      const candidates = connections.filter(
        (c) =>
          c.provider_id === providerId &&
          (c.status ?? "").toLowerCase() === "active",
      );

      // Current selection: app-level binding wins; fall back to the
      // workspace-default binding for this provider.
      const workspaceDefault = bindingsResult.bindings.find(
        (b) =>
          b.target_type === "workspace" &&
          b.target_id === "default" &&
          b.integration_key === providerId,
      );
      const currentConnectionId =
        appBinding?.connection_id ?? workspaceDefault?.connection_id ?? null;

      setIntegrationContext({
        providerId,
        providerName: provider?.display_name ?? providerId,
        candidates,
        currentBindingId: appBinding?.binding_id ?? null,
        currentConnectionId,
      });
    } catch {
      // Non-fatal — leave the previous context in place.
    }
  }, [appId, selectedWorkspaceId]);

  useEffect(() => {
    void checkIntegration();
  }, [checkIntegration]);

  const handleSelectBinding = useCallback(
    async (connectionId: string) => {
      if (!selectedWorkspaceId || !integrationContext) return;
      setBindingBusy(true);
      try {
        await window.electronAPI.workspace.upsertIntegrationBinding(
          selectedWorkspaceId,
          "app",
          appId,
          integrationContext.providerId,
          { connection_id: connectionId, is_default: false },
        );
        await checkIntegration();
      } catch {
        // Non-fatal — the dropdown will reflect server state on next refresh.
      } finally {
        setBindingBusy(false);
      }
    },
    [appId, checkIntegration, integrationContext, selectedWorkspaceId],
  );

  const handleConnectAccount = useCallback(() => {
    void window.electronAPI.ui.openSettingsPane("integrations");
  }, []);

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

    void window.electronAPI.appSurface
      .resolveUrl(selectedWorkspaceId, appId, routePath)
      .then((url) => {
        if (!cancelled) setFrameUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFrameError(
            err instanceof Error ? err.message : "Failed to resolve app URL.",
          );
          setFrameLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appId, ready, reloadKey, routePath, selectedWorkspaceId]);

  async function handleRemove() {
    if (isRemoving) return;
    setIsRemoving(true);
    setActionError("");
    try {
      await removeInstalledApp(appId);
      setWasRemoved(true);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to remove app.",
      );
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

  // Removed state — render blank after successful removal
  if (wasRemoved) {
    return <div className="h-full min-h-0" />;
  }

  // Initializing state
  if (!ready && !error) {
    return (
      <div className="flex h-full min-h-0 gap-2">
        <section className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-xl bg-card shadow-md backdrop-blur-sm">
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="max-w-[200px] text-center">
              <LoaderCircle
                size={20}
                className="mx-auto animate-spin text-muted-foreground"
              />
              <div className="mt-3 text-sm font-medium text-foreground">
                {label}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Initializing... This may take a few minutes on first setup.
              </div>
            </div>
          </div>
          <div className="border-t border-border p-3">
            {confirmRemove ? (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleRemove()}
                  disabled={isRemoving}
                  className="flex-1 justify-center"
                >
                  {isRemoving ? "Removing..." : "Confirm"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRemove(false)}
                  className="flex-1 justify-center"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmRemove(true)}
                className="w-full justify-center border border-destructive/30 font-semibold"
              >
                <Trash2 size={12} />
                Remove app
              </Button>
            )}
            {actionError ? (
              <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {actionError}
              </div>
            ) : null}
          </div>
        </section>
        <section className="flex min-w-0 flex-1 items-center justify-center rounded-xl bg-card shadow-md backdrop-blur-sm">
          <div className="text-center">
            <LoaderCircle
              size={16}
              className="mx-auto animate-spin text-muted-foreground"
            />
            <div className="mt-2 text-xs text-muted-foreground">
              Waiting for app...
            </div>
          </div>
        </section>
      </div>
    );
  }

  // Error state
  if (!ready && error) {
    return (
      <div className="flex h-full min-h-0 gap-2">
        <section className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-4 shadow-xs backdrop-blur-sm">
          <div className="flex shrink-0 items-center gap-2 text-destructive">
            <Activity size={14} />
            <span className="text-[10px] uppercase tracking-widest">
              App error
            </span>
          </div>
          <div className="mt-3 shrink-0 text-sm font-semibold text-foreground">
            {label}
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-destructive/25 bg-destructive/5 p-3">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
              {error}
            </pre>
          </div>
          <div className="mt-3 shrink-0">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void handleRemove()}
              disabled={isRemoving}
              className="border border-destructive/30 font-semibold"
            >
              {isRemoving ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : (
                <Trash2 size={13} />
              )}
              Remove
            </Button>
          </div>
          {actionError ? (
            <div className="mt-2 shrink-0 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {actionError}
            </div>
          ) : null}
        </section>
        <section className="flex min-w-0 flex-1 items-center justify-center rounded-xl bg-card shadow-md backdrop-blur-sm">
          <div className="text-center">
            <Activity size={18} className="mx-auto text-destructive" />
            <div className="mt-2 text-xs text-muted-foreground">
              App failed to start
            </div>
          </div>
        </section>
      </div>
    );
  }

  // Ready state — left info card + right iframe
  return (
    <div className="flex h-full min-h-0 gap-2">
      {/* Left: App info card */}
      <section className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-xl bg-card shadow-md backdrop-blur-sm">
        <div className="chat-scrollbar-hidden flex-1 overflow-y-auto p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted text-xs font-semibold uppercase text-muted-foreground">
              {brandIcon ?? iconFallback}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {label}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-success">
                <span className="size-1.5 rounded-full bg-success" />
                Running
              </div>
            </div>
          </div>

          {summary ? (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {summary}
            </p>
          ) : null}

          {resourceId || path ? (
            <div className="mt-4 flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {resourceId ? "Resource" : "Route"}
              </span>
              <span className="max-w-[120px] truncate text-xs font-medium text-foreground">
                {resourceId || path}
              </span>
            </div>
          ) : null}

          {integrationContext ? (
            <div className="mt-4">
              <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Integrations
              </div>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Plug size={11} />
                  {integrationContext.providerName}
                </span>
                <span className="text-muted-foreground">·</span>
                {integrationContext.candidates.length === 0 ? (
                  <Button
                    className="h-auto px-2 py-1 text-xs"
                    onClick={handleConnectAccount}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Plus size={12} />
                    Connect a {integrationContext.providerName} account
                  </Button>
                ) : (
                  <Select
                    disabled={bindingBusy}
                    onValueChange={(value) => {
                      if (!value) return;
                      if (value === "__connect_new__") {
                        handleConnectAccount();
                      } else {
                        void handleSelectBinding(value);
                      }
                    }}
                    value={integrationContext.currentConnectionId ?? ""}
                  >
                    <SelectTrigger
                      className="ml-auto h-7 min-w-[140px] gap-1.5 border-transparent bg-transparent px-2 text-xs hover:bg-accent"
                      size="sm"
                    >
                      <SelectValue placeholder="Pick an account" />
                    </SelectTrigger>
                    <SelectContent
                      align="end"
                      className="min-w-[200px] gap-0 rounded-lg p-1 shadow-subtle-sm"
                    >
                      {integrationContext.candidates.map((conn) => {
                        const labelText =
                          (conn.account_label?.trim() ?? "") ||
                          (conn.account_external_id?.trim() ?? "") ||
                          conn.connection_id;
                        return (
                          <SelectItem
                            className="rounded-md px-2.5 py-1.5 text-xs"
                            key={conn.connection_id}
                            value={conn.connection_id}
                          >
                            {labelText}
                          </SelectItem>
                        );
                      })}
                      <SelectItem
                        className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground"
                        value="__connect_new__"
                      >
                        + Connect new account
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ) : null}

          {app && "tools" in app && app.tools && app.tools.length > 0 ? (
            <div className="mt-4">
              <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Tools ({app.tools.length})
              </div>
              <div className="mt-2 space-y-0.5">
                {app.tools.map((tool) => (
                  <div key={tool.name} className="rounded-md px-2 py-1.5">
                    <div className="text-xs font-medium text-foreground">
                      {tool.name}
                    </div>
                    <div className="text-[10px] leading-relaxed text-muted-foreground">
                      {tool.description}
                    </div>
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
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReloadKey((k) => k + 1)}
              className="w-full justify-center"
            >
              <RefreshCw size={12} />
              Reload
            </Button>
            {confirmRemove ? (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleRemove()}
                  disabled={isRemoving}
                  className="flex-1 justify-center"
                >
                  {isRemoving ? "Removing..." : "Confirm"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRemove(false)}
                  className="flex-1 justify-center"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmRemove(true)}
                className="w-full justify-center border border-destructive/30 font-semibold"
              >
                <Trash2 size={12} />
                Remove app
              </Button>
            )}
          </div>

          {actionError ? (
            <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {actionError}
            </div>
          ) : null}
        </div>
      </section>

      {/* Right: App iframe */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-background shadow-md">
        <div
          className="relative min-h-0 flex-1"
          style={{ borderRadius: "inherit" }}
        >
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
                <LoaderCircle
                  size={18}
                  className="mx-auto animate-spin text-muted-foreground"
                />
                <div className="mt-2 text-xs text-muted-foreground">
                  Loading {label}...
                </div>
              </div>
            </div>
          ) : null}
          {frameError ? (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="max-w-sm rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-center">
                <div className="text-sm font-medium text-foreground">
                  App preview unavailable
                </div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">
                  {frameError}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="mt-3"
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
