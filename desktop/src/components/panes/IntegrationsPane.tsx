import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, Search, ShieldAlert } from "lucide-react";

import { useDesktopAuthSession } from "@/lib/auth/authClient";

interface ComposioToolkit {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  auth_schemes: string[];
  categories: string[];
}

interface IntegrationCard {
  slug: string;
  providerId: string;
  name: string;
  description: string;
  logo: string | null;
  authSchemes: string[];
  categories: string[];
  supportsManaged: boolean;
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function normalizedText(value: string | null | undefined): string {
  return (value || "").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function providerIdForToolkit(slug: string): string {
  const normalizedSlug = slug.trim().toLowerCase();
  return (TOOLKIT_SLUG_TO_PROVIDER[normalizedSlug] || normalizedSlug).trim().toLowerCase();
}

function providerCategories(providerId: string): string[] {
  return PROVIDER_CATEGORY_GROUPS[providerId] || ["other"];
}

function toolkitPreferenceRank(providerId: string, slug: string): number {
  const normalizedSlug = slug.trim().toLowerCase();
  const preferredSlugs = PROVIDER_TOOLKIT_PREFERENCE[providerId] || [];
  const index = preferredSlugs.indexOf(normalizedSlug);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function preferredToolkitForProvider(
  providerId: string,
  current: ComposioToolkit | undefined,
  candidate: ComposioToolkit,
): ComposioToolkit {
  if (!current) {
    return candidate;
  }
  return toolkitPreferenceRank(providerId, candidate.slug) < toolkitPreferenceRank(providerId, current.slug)
    ? candidate
    : current;
}

function mergeIntegrationCards(
  catalogProviders: IntegrationCatalogProviderPayload[],
  toolkits: ComposioToolkit[],
): IntegrationCard[] {
  const toolkitByProvider = new Map<string, ComposioToolkit>();
  for (const toolkit of toolkits) {
    const providerId = providerIdForToolkit(toolkit.slug);
    toolkitByProvider.set(
      providerId,
      preferredToolkitForProvider(providerId, toolkitByProvider.get(providerId), toolkit),
    );
  }

  const cards: IntegrationCard[] = [];
  const seenProviderIds = new Set<string>();

  for (const provider of catalogProviders) {
    const providerId = normalizedText(provider.provider_id).toLowerCase();
    if (!providerId) {
      continue;
    }
    seenProviderIds.add(providerId);
    const toolkit = toolkitByProvider.get(providerId);
    const toolkitCategories = uniqueStrings(toolkit?.categories || []);

    cards.push({
      slug: providerId,
      providerId,
      name:
        normalizedText(provider.display_name) ||
        normalizedText(toolkit?.name) ||
        providerId,
      description:
        normalizedText(toolkit?.description) ||
        normalizedText(provider.description) ||
        normalizedText(provider.display_name) ||
        providerId,
      logo: toolkit?.logo ?? null,
      authSchemes: uniqueStrings([
        ...(toolkit?.auth_schemes || []),
        ...(provider.auth_modes || []),
      ]),
      categories:
        toolkitCategories.length > 0
          ? toolkitCategories
          : providerCategories(providerId),
      supportsManaged: provider.supports_managed !== false,
    });
  }

  for (const [providerId, toolkit] of toolkitByProvider.entries()) {
    if (seenProviderIds.has(providerId)) {
      continue;
    }
    cards.push({
      slug: providerId,
      providerId,
      name: normalizedText(toolkit.name) || providerId,
      description: normalizedText(toolkit.description) || providerId,
      logo: toolkit.logo,
      authSchemes: uniqueStrings(toolkit.auth_schemes || []),
      categories:
        uniqueStrings(toolkit.categories || []).length > 0
          ? uniqueStrings(toolkit.categories || [])
          : providerCategories(providerId),
      supportsManaged: true,
    });
  }

  return cards.sort((left, right) => left.name.localeCompare(right.name));
}

export function IntegrationsPane() {
  const authSessionState = useDesktopAuthSession();
  const isSignedIn = Boolean(authSessionState.data?.user?.id?.trim());
  const [integrations, setIntegrations] = useState<IntegrationCard[]>([]);
  const [connections, setConnections] = useState<IntegrationConnectionPayload[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [connectingProviderId, setConnectingProviderId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [catalogResult, connectionResult, toolkitResult] = await Promise.all([
        window.electronAPI.workspace.listIntegrationCatalog(),
        window.electronAPI.workspace.listIntegrationConnections(),
        window.electronAPI.workspace.composioListToolkits().catch(() => ({ toolkits: [] as ComposioToolkit[] })),
      ]);
      setIntegrations(mergeIntegrationCards(catalogResult.providers, toolkitResult.toolkits));
      setConnections(connectionResult.connections);
    } catch (error) {
      setIntegrations([]);
      setConnections([]);
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [isSignedIn, loadData]);

  const connectedProviderIds = useMemo(() => {
    const providerIds = new Set<string>();
    for (const connection of connections) {
      if (normalizedText(connection.status).toLowerCase() === "active") {
        providerIds.add(normalizedText(connection.provider_id).toLowerCase());
      }
    }
    return providerIds;
  }, [connections]);

  const categories = useMemo(() => {
    const items = new Set<string>();
    for (const integration of integrations) {
      for (const category of integration.categories) {
        if (category) {
          items.add(category);
        }
      }
    }
    return Array.from(items).sort();
  }, [integrations]);

  const connectedIntegrations = useMemo(
    () => integrations.filter((integration) => connectedProviderIds.has(integration.providerId)),
    [connectedProviderIds, integrations],
  );

  const filteredIntegrations = useMemo(() => {
    let items = integrations.filter((integration) => !connectedProviderIds.has(integration.providerId));
    if (query.trim()) {
      const normalizedQuery = query.trim().toLowerCase();
      items = items.filter((integration) =>
        [
          integration.providerId,
          integration.name,
          integration.description,
        ].some((value) => value.toLowerCase().includes(normalizedQuery)),
      );
    }
    if (categoryFilter !== "all") {
      items = items.filter((integration) => integration.categories.includes(categoryFilter));
    }
    return items;
  }, [categoryFilter, connectedProviderIds, integrations, query]);

  const groupedIntegrations = useMemo(() => {
    const groups: Record<string, IntegrationCard[]> = {};
    for (const integration of filteredIntegrations) {
      const category = integration.categories[0] || "other";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(integration);
    }
    return Object.entries(groups).sort(([left], [right]) => left.localeCompare(right));
  }, [filteredIntegrations]);

  async function handleConnect(integration: IntegrationCard) {
    setConnectingProviderId(integration.providerId);
    setStatusMessage("Complete authorization in your browser...");
    try {
      if (!isSignedIn) {
        setStatusMessage("Sign in first to connect managed integrations.");
        return;
      }
      if (!integration.supportsManaged) {
        setStatusMessage(`${integration.name} does not support managed sign-in in this runtime.`);
        return;
      }

      const runtimeConfig = await window.electronAPI.runtime.getConfig();
      const userId =
        runtimeConfig.userId ||
        authSessionState.data?.user?.id?.trim() ||
        "local";

      const link = await window.electronAPI.workspace.composioConnect({
        provider: integration.providerId,
        owner_user_id: userId,
      });

      await window.electronAPI.ui.openExternalUrl(link.redirect_url);

      for (let attempt = 0; attempt < 100; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const status = await window.electronAPI.workspace.composioAccountStatus(
          link.connected_account_id,
        );
        if (status.status === "ACTIVE") {
          await window.electronAPI.workspace.composioFinalize({
            connected_account_id: link.connected_account_id,
            provider: integration.providerId,
            owner_user_id: userId,
            account_label: `${integration.name} (Managed)`,
          });
          setStatusMessage("");
          void loadData();
          return;
        }
      }

      setStatusMessage("Connection timed out.");
    } catch (error) {
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setConnectingProviderId(null);
    }
  }

  if (isLoading) {
    return (
      <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
        <Loader2 size={18} className="animate-spin text-text-dim/60" />
      </section>
    );
  }

  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-text-main">
            Integrations
          </h1>
          <p className="mt-1 text-[13px] text-text-muted/80">
            Connect your accounts to use them in workspaces.
          </p>
          {!authSessionState.isPending && !isSignedIn ? (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-[16px] border border-[rgba(206,92,84,0.18)] bg-[rgba(206,92,84,0.06)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[rgba(206,92,84,0.92)]">
                  <ShieldAlert size={13} />
                  <span>Sign-In Required</span>
                </div>
                <div className="mt-1 text-[13px] font-medium text-text-main">
                  Managed integrations are unavailable until you sign in.
                </div>
                <div className="mt-1 text-[12px] leading-6 text-text-muted/76">
                  You can browse the local provider catalog below, but connecting Google, GitHub, Reddit, LinkedIn, or X requires an authenticated Holaboss session.
                </div>
              </div>
              <button
                type="button"
                onClick={() => void authSessionState.requestAuth()}
                className="shrink-0 rounded-[12px] border border-[rgba(206,92,84,0.28)] bg-[rgba(206,92,84,0.1)] px-3 py-2 text-[12px] font-medium text-[rgba(206,92,84,0.96)] transition hover:bg-[rgba(206,92,84,0.14)]"
              >
                Sign in
              </button>
            </div>
          ) : null}

          <div className="mt-5 flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim/50" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search integrations..."
                className="h-9 w-full rounded-[10px] border border-panel-border/40 bg-panel-bg/60 pl-8 pr-3 text-[13px] text-text-main outline-none placeholder:text-text-dim/40"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-9 rounded-[10px] border border-panel-border/40 bg-panel-bg/60 px-3 text-[13px] text-text-main outline-none"
            >
              <option value="all">All</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {connectedIntegrations.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-dim/70">
                Connected
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {connectedIntegrations.map((integration) => (
                  <IntegrationRow
                    key={integration.slug}
                    integration={integration}
                    connected
                    canConnect={false}
                    connectDisabledReason=""
                    onConnect={() => void handleConnect(integration)}
                    connecting={connectingProviderId === integration.providerId}
                    actionMode="connected"
                  />
                ))}
              </div>
            </div>
          ) : null}

          {statusMessage ? (
            <div className="mt-4 text-[12px] text-text-muted">{statusMessage}</div>
          ) : null}

          {groupedIntegrations.map(([category, items]) => (
            <div key={category} className="mt-6">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-dim/70">
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {items.map((integration) => (
                  <IntegrationRow
                    key={integration.slug}
                    integration={integration}
                    connected={false}
                    canConnect={isSignedIn && integration.supportsManaged}
                    connectDisabledReason={
                      integration.supportsManaged
                        ? "Sign in first to connect managed integrations."
                        : "Managed sign-in is not supported for this provider."
                    }
                    onConnect={() => void handleConnect(integration)}
                    connecting={connectingProviderId === integration.providerId}
                    actionMode={
                      !integration.supportsManaged
                        ? "unavailable"
                        : isSignedIn
                          ? "connect"
                          : "disabled"
                    }
                  />
                ))}
              </div>
            </div>
          ))}

          {filteredIntegrations.length === 0 && connectedIntegrations.length === 0 ? (
            <div className="mt-12 text-center text-[13px] text-text-muted/60">
              No integrations found.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function IntegrationRow({
  integration,
  connected,
  canConnect,
  connectDisabledReason,
  onConnect,
  connecting,
  actionMode,
}: {
  integration: IntegrationCard;
  connected: boolean;
  canConnect: boolean;
  connectDisabledReason: string;
  onConnect: () => void;
  connecting: boolean;
  actionMode: "connected" | "connect" | "disabled" | "unavailable";
}) {
  const muted = actionMode === "disabled";
  return (
    <div
      className={`flex items-center gap-3 rounded-[12px] border border-panel-border/30 px-3 py-2.5 transition-colors ${
        muted ? "opacity-50" : "hover:bg-panel-bg/40"
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-panel-border/20 bg-panel-bg/50">
        {integration.logo ? (
          <img src={integration.logo} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[14px] font-semibold text-text-dim/50">
            {integration.name.charAt(0)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-text-main">
          {integration.name}
        </div>
        <div className="truncate text-[11px] text-text-muted/70">
          {integration.description}
        </div>
      </div>

      {connected ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neon-green">
          <Check size={12} />
        </span>
      ) : actionMode === "unavailable" ? (
        <span
          title={connectDisabledReason}
          className="inline-flex h-7 shrink-0 items-center rounded-[8px] border border-panel-border/28 px-2.5 text-[11px] font-medium text-text-dim/64"
        >
          Unavailable
        </span>
      ) : (
        <button
          type="button"
          disabled={connecting || !canConnect}
          onClick={onConnect}
          title={canConnect ? `Connect ${integration.name}` : connectDisabledReason}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-panel-border/30 text-text-dim/60 transition-colors hover:bg-panel-bg/60 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-40"
        >
          {connecting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
        </button>
      )}
    </div>
  );
}

const PROVIDER_CATEGORY_GROUPS: Record<string, string[]> = {
  google: ["productivity"],
  github: ["developer"],
  reddit: ["community"],
  twitter: ["social"],
  linkedin: ["social"],
};

const PROVIDER_TOOLKIT_PREFERENCE: Record<string, string[]> = {
  google: ["gmail", "googledrive", "googlecalendar", "googlesheets"],
  github: ["github"],
  reddit: ["reddit"],
  twitter: ["twitter"],
  linkedin: ["linkedin"],
};

const TOOLKIT_SLUG_TO_PROVIDER: Record<string, string> = {
  gmail: "google",
  googlesheets: "google",
  googlecalendar: "google",
  googledrive: "google",
};
