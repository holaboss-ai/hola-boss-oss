import { useCallback, useEffect, useMemo, useState } from "react";
import { Cable, Check, FileWarning, Link2, Loader2, Search, Settings, Trash2, Unplug } from "lucide-react";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

type ProviderState = "not_connected" | "connected" | "needs_setup";

interface EnrichedProvider extends IntegrationCatalogProviderPayload {
  state: ProviderState;
  connections: IntegrationConnectionPayload[];
  bindings: IntegrationBindingPayload[];
}

function deriveProviderState(
  provider: IntegrationCatalogProviderPayload,
  connections: IntegrationConnectionPayload[],
  bindings: IntegrationBindingPayload[],
): ProviderState {
  const providerConnections = connections.filter((c) => c.provider_id === provider.provider_id);
  if (providerConnections.length === 0) {
    return "not_connected";
  }
  const providerBindings = bindings.filter((b) => b.integration_key === provider.provider_id);
  if (providerBindings.length === 0) {
    return "needs_setup";
  }
  return "connected";
}

export function IntegrationsPane() {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [catalog, setCatalog] = useState<IntegrationCatalogResponsePayload | null>(null);
  const [connections, setConnections] = useState<IntegrationConnectionPayload[]>([]);
  const [bindings, setBindings] = useState<IntegrationBindingPayload[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [query, setQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [composioConnecting, setComposioConnecting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importLabel, setImportLabel] = useState("");
  const [importToken, setImportToken] = useState("");

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [catalogResult, connectionsResult, bindingsResult] = await Promise.all([
        window.electronAPI.workspace.listIntegrationCatalog(),
        window.electronAPI.workspace.listIntegrationConnections(),
        selectedWorkspaceId
          ? window.electronAPI.workspace.listIntegrationBindings(selectedWorkspaceId)
          : Promise.resolve({ bindings: [] as IntegrationBindingPayload[] }),
      ]);
      setCatalog(catalogResult);
      setConnections(connectionsResult.connections);
      setBindings(bindingsResult.bindings);
      setSelectedProviderId((current) => {
        if (current && catalogResult.providers.some((p) => p.provider_id === current)) {
          return current;
        }
        return catalogResult.providers[0]?.provider_id || "";
      });
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [selectedWorkspaceId]);

  useEffect(() => {
    setCatalog(null);
    setConnections([]);
    setBindings([]);
    setSelectedProviderId("");
    setErrorMessage("");

    void loadAll();
  }, [loadAll]);

  const enrichedProviders: EnrichedProvider[] = useMemo(() => {
    if (!catalog) return [];
    return catalog.providers.map((provider) => ({
      ...provider,
      state: deriveProviderState(provider, connections, bindings),
      connections: connections.filter((c) => c.provider_id === provider.provider_id),
      bindings: bindings.filter((b) => b.integration_key === provider.provider_id),
    }));
  }, [catalog, connections, bindings]);

  const filteredProviders = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return enrichedProviders;
    return enrichedProviders.filter((p) =>
      [p.provider_id, p.display_name, p.description].some((v) => v.toLowerCase().includes(trimmedQuery)),
    );
  }, [enrichedProviders, query]);

  const selectedProvider = useMemo(
    () => enrichedProviders.find((p) => p.provider_id === selectedProviderId) ?? null,
    [enrichedProviders, selectedProviderId],
  );

  const handleBindConnection = async (connectionId: string) => {
    if (!selectedWorkspaceId || !selectedProvider) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const binding = await window.electronAPI.workspace.upsertIntegrationBinding(
        selectedWorkspaceId,
        "workspace",
        "default",
        selectedProvider.provider_id,
        { connection_id: connectionId, is_default: true },
      );
      setBindings((prev) => {
        const without = prev.filter(
          (b) =>
            !(b.workspace_id === binding.workspace_id && b.integration_key === binding.integration_key && b.target_type === "workspace" && b.target_id === "default"),
        );
        return [...without, binding];
      });
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnbind = async (bindingId: string) => {
    if (!selectedWorkspaceId) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      await window.electronAPI.workspace.deleteIntegrationBinding(bindingId, selectedWorkspaceId);
      setBindings((prev) => prev.filter((b) => b.binding_id !== bindingId));
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateConnection = async () => {
    if (!selectedProvider || !importToken.trim()) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const runtimeConfig = await window.electronAPI.runtime.getConfig();
      const connection = await window.electronAPI.workspace.createIntegrationConnection({
        provider_id: selectedProvider.provider_id,
        owner_user_id: runtimeConfig.userId ?? "local",
        account_label: importLabel.trim(),
        auth_mode: "manual_token",
        granted_scopes: selectedProvider.default_scopes,
        secret_ref: importToken.trim(),
      });
      setConnections((prev) => [...prev, connection]);
      setShowImportDialog(false);
      setImportLabel("");
      setImportToken("");
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    setIsSaving(true);
    setErrorMessage("");
    try {
      // Remove all bindings for this connection first
      const related = bindings.filter((b) => b.connection_id === connectionId);
      for (const binding of related) {
        try {
          await window.electronAPI.workspace.deleteIntegrationBinding(binding.binding_id, binding.workspace_id);
        } catch {
          // Binding may reference a deleted workspace — skip
        }
      }
      await window.electronAPI.workspace.deleteIntegrationConnection(connectionId);
      setConnections((prev) => prev.filter((c) => c.connection_id !== connectionId));
      setBindings((prev) => prev.filter((b) => b.connection_id !== connectionId));
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleOAuthConnect = async () => {
    if (!selectedProvider) return;
    setIsSaving(true);
    try {
      await window.electronAPI.workspace.startOAuthFlow(selectedProvider.provider_id);
      // Poll for new connection after OAuth completes in browser
      setTimeout(() => void loadAll(), 5000);
      setTimeout(() => void loadAll(), 10000);
      setTimeout(() => void loadAll(), 15000);
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleManagedConnect = async () => {
    if (!selectedProvider) return;
    setComposioConnecting(true);
    setErrorMessage("");
    try {
      const runtimeConfig = await window.electronAPI.runtime.getConfig();
      const userId = runtimeConfig.userId ?? "local";

      const link = await window.electronAPI.workspace.composioConnect({
        provider: selectedProvider.provider_id,
        owner_user_id: userId,
      });

      window.open(link.redirect_url, "composio-oauth", "width=600,height=700");

      let account: ComposioAccountStatus | null = null;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await window.electronAPI.workspace.composioAccountStatus(
          link.connected_account_id,
        );
        if (status.status === "ACTIVE") {
          account = status;
          break;
        }
      }

      if (!account) {
        setErrorMessage("OAuth timed out. Please try again.");
        return;
      }

      const connection = await window.electronAPI.workspace.composioFinalize({
        connected_account_id: link.connected_account_id,
        provider: selectedProvider.provider_id,
        owner_user_id: userId,
        account_label: `${selectedProvider.display_name} (Managed)`,
      });

      setConnections((prev) => [...prev, connection]);
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setComposioConnecting(false);
    }
  };

  const handleReconnect = async (connectionId: string) => {
    setIsSaving(true);
    try {
      const updated = await window.electronAPI.workspace.updateIntegrationConnection(connectionId, {
        status: "active",
      });
      setConnections((prev) => prev.map((c) => (c.connection_id === connectionId ? updated : c)));
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const hasProviders = Boolean(catalog?.providers.length);

  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.03),transparent_24%)]" />

      <div className="relative min-h-0 flex-1 p-4">
        {isLoading ? (
          <LoadingState label="Loading integrations..." />
        ) : errorMessage && !catalog ? (
          <EmptyState title="Integrations failed to load" detail={errorMessage} tone="error" />
        ) : !hasProviders ? (
          <EmptyState title="No integrations available" detail="No integration providers are available for this runtime." />
        ) : (
          <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            {/* Provider list sidebar */}
            <aside className="theme-subtle-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-panel-border/35 shadow-card">
              <div className="border-b border-panel-border/35 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">Integrations</div>
                    <div className="mt-1 text-[14px] font-medium text-text-main">Provider catalog</div>
                  </div>
                  <div className="rounded-full border border-panel-border/35 bg-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">
                    {filteredProviders.length} shown
                  </div>
                </div>

                <label className="theme-control-surface mt-4 flex items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 py-2.5 text-[12px] text-text-muted">
                  <Search size={13} className="text-text-dim/72" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search providers"
                    className="w-full bg-transparent text-text-main outline-none placeholder:text-text-dim/48"
                  />
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                {filteredProviders.length === 0 ? (
                  <div className="rounded-[18px] border border-panel-border/35 bg-black/10 px-4 py-5 text-[12px] leading-6 text-text-dim/76">
                    No providers match the current filter.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {filteredProviders.map((provider) => {
                      const active = provider.provider_id === selectedProviderId;
                      return (
                        <button
                          key={provider.provider_id}
                          type="button"
                          onClick={() => setSelectedProviderId(provider.provider_id)}
                          className={`group relative overflow-hidden rounded-[20px] border px-4 py-4 text-left transition-colors duration-200 ${
                            active
                              ? "border-neon-green/30 bg-neon-green/6 shadow-card"
                              : "border-panel-border/35 bg-panel-bg/18 hover:border-neon-green/24 hover:bg-[var(--theme-hover-bg)]"
                          }`}
                        >
                          <div
                            className={`absolute inset-y-4 left-0 w-1 rounded-r-full transition-colors duration-200 ${
                              active ? "bg-neon-green/82" : "bg-transparent group-hover:bg-neon-green/35"
                            }`}
                          />
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-medium text-text-main">{provider.display_name}</div>
                              <div className="mt-1 truncate text-[11px] uppercase tracking-[0.14em] text-text-dim/72">
                                {provider.provider_id}
                              </div>
                            </div>
                            <ProviderStateBadge state={provider.state} />
                          </div>
                          <div
                            className="mt-2 text-[12px] leading-6 text-text-muted/82"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {provider.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            {/* Provider detail panel */}
            <div className="theme-subtle-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-panel-border/35 shadow-card">
              {selectedProvider ? (
                <>
                  {/* Header */}
                  <div className="relative overflow-hidden border-b border-panel-border/35 px-5 py-5">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(64,201,162,0.08),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.04),transparent_32%)]" />
                    <div className="relative">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2 rounded-full border border-panel-border/35 bg-black/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-text-dim/76">
                            <Cable size={12} className="text-text-dim/78" />
                            <span>{selectedProvider.provider_id}</span>
                          </div>
                          <div className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-text-main">
                            {selectedProvider.display_name}
                          </div>
                          <div className="mt-2 max-w-[760px] text-[13px] leading-7 text-text-muted/84">
                            {selectedProvider.description}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {selectedProvider.auth_modes.includes("managed") ? (
                            <button
                              type="button"
                              disabled={composioConnecting}
                              onClick={handleManagedConnect}
                              className="rounded-[12px] border border-neon-green/35 bg-neon-green/8 px-3 py-1.5 text-[11px] font-medium text-neon-green transition-colors duration-200 hover:bg-neon-green/14 disabled:opacity-50"
                            >
                              {composioConnecting ? "Connecting\u2026" : "Connect"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handleOAuthConnect}
                              className="rounded-[12px] border border-neon-green/35 bg-neon-green/8 px-3 py-1.5 text-[11px] font-medium text-neon-green transition-colors duration-200 hover:bg-neon-green/14"
                            >
                              Connect
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setShowImportDialog(true);
                              setImportLabel("");
                              setImportToken("");
                              setErrorMessage("");
                            }}
                            className="rounded-[12px] border border-neon-green/35 bg-neon-green/8 px-3 py-1.5 text-[11px] font-medium text-neon-green transition-colors duration-200 hover:bg-neon-green/14"
                          >
                            Import Token
                          </button>
                          <ProviderStateBadge state={selectedProvider.state} large />
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <MetadataRow label="Auth modes" value={selectedProvider.auth_modes.join(", ")} />
                        <MetadataRow label="Default scopes" value={selectedProvider.default_scopes.join(", ")} />
                        <MetadataRow
                          label="Availability"
                          value={[selectedProvider.supports_oss ? "OSS" : "", selectedProvider.supports_managed ? "Managed" : ""].filter(Boolean).join(", ")}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Token import dialog */}
                  {showImportDialog ? (
                    <div className="mx-4 mt-4 rounded-[20px] border border-neon-green/25 bg-neon-green/4 p-4">
                      <div className="text-[12px] font-medium text-text-main">Import {selectedProvider.display_name} Token</div>
                      <div className="mt-3 grid gap-3">
                        <label className="grid gap-1">
                          <span className="text-[11px] text-text-dim/72">Account Label</span>
                          <input
                            value={importLabel}
                            onChange={(e) => setImportLabel(e.target.value)}
                            placeholder="Optional. e.g. joshua@holaboss.ai"
                            className="rounded-[12px] border border-panel-border/45 bg-panel-bg/40 px-3 py-2 text-[12px] text-text-main outline-none placeholder:text-text-dim/48"
                          />
                          <span className="text-[11px] leading-5 text-text-dim/60">
                            Leave blank to use a default connection name.
                          </span>
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[11px] text-text-dim/72">Token</span>
                          <input
                            type="password"
                            value={importToken}
                            onChange={(e) => setImportToken(e.target.value)}
                            placeholder="Paste your provider token"
                            className="rounded-[12px] border border-panel-border/45 bg-panel-bg/40 px-3 py-2 text-[12px] text-text-main outline-none placeholder:text-text-dim/48"
                          />
                        </label>
                        {errorMessage ? (
                          <div className="rounded-[14px] border border-rose-400/25 bg-rose-400/8 px-3 py-2 text-[12px] leading-6 text-rose-300">
                            {errorMessage}
                          </div>
                        ) : null}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowImportDialog(false);
                              setErrorMessage("");
                            }}
                            className="rounded-[12px] border border-panel-border/35 px-3 py-1.5 text-[11px] text-text-muted transition-colors duration-200 hover:bg-[var(--theme-hover-bg)]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isSaving || !importToken.trim()}
                            onClick={handleCreateConnection}
                            className="rounded-[12px] border border-neon-green/35 bg-neon-green/8 px-3 py-1.5 text-[11px] font-medium text-neon-green transition-colors duration-200 hover:bg-neon-green/14 disabled:opacity-50"
                          >
                            {isSaving ? "Saving..." : "Save Connection"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Connections and bindings */}
                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    <div className="grid gap-4">
                      {/* Connections section */}
                      <div className="rounded-[24px] border border-panel-border/35 bg-[var(--theme-subtle-bg)]">
                        <div className="flex items-center gap-2 border-b border-panel-border/35 px-4 py-3">
                          <Link2 size={13} className="text-neon-green/86" />
                          <span className="text-[11px] uppercase tracking-[0.16em] text-text-dim/76">
                            Connections ({selectedProvider.connections.length})
                          </span>
                        </div>

                        {selectedProvider.connections.length === 0 ? (
                          <div className="px-4 py-6 text-center">
                            <Unplug size={20} className="mx-auto text-text-dim/48" />
                            <div className="mt-2 text-[13px] font-medium text-text-main/72">No connections</div>
                            <div className="mt-1 text-[12px] leading-6 text-text-dim/68">
                              Create a connection via the runtime API or configure credentials manually.
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-2 p-3">
                            {selectedProvider.connections.map((conn) => {
                              const isBound = selectedProvider.bindings.some((b) => b.connection_id === conn.connection_id);
                              return (
                                <div
                                  key={conn.connection_id}
                                  className="flex items-center justify-between gap-3 rounded-[16px] border border-panel-border/35 bg-panel-bg/18 px-4 py-3"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-[13px] font-medium text-text-main">{conn.account_label || conn.connection_id}</div>
                                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-dim/72">
                                      <span>{conn.auth_mode}</span>
                                      <span className="text-panel-border/60">|</span>
                                      <ConnectionStatusBadge status={conn.status} />
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    {conn.status !== "active" ? (
                                      <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() => conn.auth_mode === "oauth_app" ? handleOAuthConnect() : handleReconnect(conn.connection_id)}
                                        className="rounded-[12px] border border-amber-400/25 bg-amber-400/6 px-3 py-1.5 text-[11px] font-medium text-amber-400 transition-colors duration-200 hover:bg-amber-400/14 disabled:opacity-50"
                                      >
                                        Reconnect
                                      </button>
                                    ) : null}
                                    {selectedWorkspaceId && !isBound ? (
                                      <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() => handleBindConnection(conn.connection_id)}
                                        className="rounded-[12px] border border-neon-green/35 bg-neon-green/8 px-3 py-1.5 text-[11px] font-medium text-neon-green transition-colors duration-200 hover:bg-neon-green/14 disabled:opacity-50"
                                      >
                                        Bind
                                      </button>
                                    ) : isBound ? (
                                      <span className="inline-flex items-center gap-1 rounded-[12px] border border-neon-green/25 bg-neon-green/6 px-3 py-1.5 text-[11px] font-medium text-neon-green">
                                        <Check size={12} />
                                        Bound
                                      </span>
                                    ) : null}
                                    <button
                                      type="button"
                                      disabled={isSaving}
                                      onClick={() => handleDisconnect(conn.connection_id)}
                                      className="rounded-[12px] border border-rose-400/25 bg-rose-400/6 p-2 text-rose-400/82 transition-colors duration-200 hover:bg-rose-400/14 disabled:opacity-50"
                                      title="Delete connection"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Workspace bindings section */}
                      {selectedWorkspaceId ? (
                        <div className="rounded-[24px] border border-panel-border/35 bg-[var(--theme-subtle-bg)]">
                          <div className="flex items-center gap-2 border-b border-panel-border/35 px-4 py-3">
                            <Cable size={13} className="text-neon-green/86" />
                            <span className="text-[11px] uppercase tracking-[0.16em] text-text-dim/76">
                              Workspace bindings ({selectedProvider.bindings.length})
                            </span>
                          </div>

                          {selectedProvider.bindings.length === 0 ? (
                            <div className="px-4 py-6 text-center text-[12px] leading-6 text-text-dim/68">
                              No bindings for this provider in the current workspace.
                            </div>
                          ) : (
                            <div className="grid gap-2 p-3">
                              {selectedProvider.bindings.map((binding) => {
                                const conn = connections.find((c) => c.connection_id === binding.connection_id);
                                return (
                                  <div
                                    key={binding.binding_id}
                                    className="flex items-center justify-between gap-3 rounded-[16px] border border-panel-border/35 bg-panel-bg/18 px-4 py-3"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-[13px] font-medium text-text-main">
                                        {conn?.account_label || binding.connection_id}
                                      </div>
                                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-dim/72">
                                        <span>{binding.target_type}:{binding.target_id}</span>
                                        {binding.is_default ? (
                                          <>
                                            <span className="text-panel-border/60">|</span>
                                            <span className="text-neon-green/82">default</span>
                                          </>
                                        ) : null}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={isSaving}
                                      onClick={() => handleUnbind(binding.binding_id)}
                                      className="rounded-[12px] border border-rose-400/25 bg-rose-400/6 p-2 text-rose-400/82 transition-colors duration-200 hover:bg-rose-400/14 disabled:opacity-50"
                                      title="Remove binding"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-[24px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-4 py-6 text-center text-[12px] leading-6 text-text-dim/68">
                          Select a workspace to manage integration bindings.
                        </div>
                      )}

                      {/* Developer */}
                      <div className="rounded-[24px] border border-panel-border/35 bg-[var(--theme-subtle-bg)]">
                        <div className="flex items-center gap-2 border-b border-panel-border/35 px-4 py-3">
                          <Settings size={13} className="text-neon-green/86" />
                          <span className="text-[11px] uppercase tracking-[0.16em] text-text-dim/76">Developer</span>
                        </div>
                        <OAuthConfigForm providerId={selectedProvider.provider_id} />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState title="No provider selected" detail="Choose an integration provider from the list to view its connections and bindings." />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ProviderStateBadge({ state, large = false }: { state: ProviderState; large?: boolean }) {
  const config = {
    connected: {
      borderClass: "border-neon-green/24",
      bgClass: "bg-neon-green/8",
      textClass: "text-neon-green/92",
      label: "Connected",
    },
    needs_setup: {
      borderClass: "border-amber-400/24",
      bgClass: "bg-amber-400/8",
      textClass: "text-amber-400/92",
      label: "Needs setup",
    },
    not_connected: {
      borderClass: "border-panel-border/35",
      bgClass: "bg-black/10",
      textClass: "text-text-dim/74",
      label: "Not connected",
    },
  }[state];

  return (
    <div
      className={`rounded-full border ${config.borderClass} ${config.bgClass} ${large ? "px-3 py-1.5" : "px-2 py-1"} text-[${large ? "11" : "10"}px] uppercase tracking-[0.14em] ${config.textClass}`}
    >
      {config.label}
    </div>
  );
}

function ConnectionStatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return <span className="text-neon-green/82">active</span>;
  }
  if (status === "expired" || status === "revoked") {
    return <span className="text-rose-400/82">{status}</span>;
  }
  return <span>{status}</span>;
}

function MetadataRow({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-[16px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-3 py-2 ${className}`.trim()}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-dim/72">{label}</div>
      <div className="mt-1 break-all text-[12px] text-text-main/86">{value}</div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center">
      <div className="inline-flex items-center gap-2 text-[12px] text-text-muted">
        <Loader2 size={14} className="animate-spin" />
        <span>{label}</span>
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
    <div className="flex h-full min-h-[320px] items-center justify-center px-6 py-8">
      <div
        className={`w-full max-w-[420px] rounded-[24px] border px-8 py-9 text-center shadow-card ${
          tone === "error"
            ? "border-[rgba(255,153,102,0.24)] bg-[linear-gradient(180deg,rgba(255,153,102,0.08),rgba(255,255,255,0.38))]"
            : "border-panel-border/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(255,255,255,0.42))]"
        }`}
      >
        <div
          className={`mx-auto grid h-10 w-10 place-items-center rounded-full border ${
            tone === "error"
              ? "border-[rgba(255,153,102,0.24)] text-[rgba(255,153,102,0.92)]"
              : "border-neon-green/18 text-neon-green/84"
          }`}
        >
          {tone === "error" ? <FileWarning size={18} /> : <Cable size={18} />}
        </div>
        <div className="mt-3 text-[16px] font-medium text-text-main">{title}</div>
        <div className="mt-2 text-[12px] leading-6 text-text-muted/82">{detail}</div>
      </div>
    </div>
  );
}

const OAUTH_DEFAULTS: Record<string, { authorizeUrl: string; tokenUrl: string; scopes: string[] }> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/spreadsheets"],
  },
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:org"],
  },
};

function OAuthConfigForm({ providerId }: { providerId: string }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasConfig, setHasConfig] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const result = await window.electronAPI.workspace.listOAuthConfigs();
        if (cancelled) return;
        const config = result.configs.find((c) => c.provider_id === providerId);
        if (config) {
          setClientId(config.client_id);
          setClientSecret("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
          setHasConfig(true);
        } else {
          setClientId("");
          setClientSecret("");
          setHasConfig(false);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const handleSave = async () => {
    if (!clientId.trim()) return;
    setIsSaving(true);
    try {
      const defaults = OAUTH_DEFAULTS[providerId];
      await window.electronAPI.workspace.upsertOAuthConfig(providerId, {
        client_id: clientId.trim(),
        client_secret: clientSecret === "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" ? "" : clientSecret.trim(),
        authorize_url: defaults?.authorizeUrl ?? "",
        token_url: defaults?.tokenUrl ?? "",
        scopes: defaults?.scopes ?? [],
      });
      setHasConfig(true);
    } catch {
      /* ignore */
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="p-4 text-[11px] text-text-dim/68">Loading...</div>;

  return (
    <div className="grid gap-3 p-4">
      <div className="text-[12px] text-text-muted/82">
        {hasConfig ? "OAuth app configured." : "Configure your own OAuth app credentials."}
      </div>
      <label className="grid gap-1">
        <span className="text-[11px] text-text-dim/72">Client ID</span>
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="OAuth Client ID"
          className="rounded-[12px] border border-panel-border/45 bg-panel-bg/40 px-3 py-2 text-[12px] text-text-main outline-none placeholder:text-text-dim/48"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-[11px] text-text-dim/72">Client Secret</span>
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="OAuth Client Secret"
          className="rounded-[12px] border border-panel-border/45 bg-panel-bg/40 px-3 py-2 text-[12px] text-text-main outline-none placeholder:text-text-dim/48"
        />
      </label>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={isSaving || !clientId.trim()}
          onClick={handleSave}
          className="rounded-[12px] border border-neon-green/35 bg-neon-green/8 px-3 py-1.5 text-[11px] font-medium text-neon-green transition-colors duration-200 hover:bg-neon-green/14 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : hasConfig ? "Update" : "Save"}
        </button>
      </div>
    </div>
  );
}
