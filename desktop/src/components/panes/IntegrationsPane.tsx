import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, LogIn, Plus, Search, ShieldAlert, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function IntegrationsPane({ embedded }: { embedded?: boolean } = {}) {
  const authSessionState = useDesktopAuthSession();
  const isSignedIn = Boolean(authSessionState.data?.user?.id?.trim());
  const [integrations, setIntegrations] = useState<IntegrationCard[]>([]);
  const [connections, setConnections] = useState<IntegrationConnectionPayload[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [connectingProviderId, setConnectingProviderId] = useState<string | null>(null);
  const [disconnectingProviderId, setDisconnectingProviderId] = useState<string | null>(null);
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

  // Map providerId → connection for disconnect support
  const connectionByProvider = useMemo(() => {
    const map = new Map<string, IntegrationConnectionPayload>();
    for (const conn of connections) {
      if (normalizedText(conn.status).toLowerCase() === "active") {
        map.set(normalizedText(conn.provider_id).toLowerCase(), conn);
      }
    }
    return map;
  }, [connections]);

  const connectedProviderIds = useMemo(
    () => new Set(connectionByProvider.keys()),
    [connectionByProvider],
  );

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
    if (!isSignedIn) {
      void authSessionState.requestAuth();
      return;
    }
    if (!integration.supportsManaged) {
      setStatusMessage(`${integration.name} does not support managed sign-in in this runtime.`);
      return;
    }

    setConnectingProviderId(integration.providerId);
    setStatusMessage("Complete authorization in your browser...");
    try {
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

  async function handleDisconnect(integration: IntegrationCard) {
    const conn = connectionByProvider.get(integration.providerId);
    if (!conn) return;

    setDisconnectingProviderId(integration.providerId);
    setStatusMessage("");
    try {
      await window.electronAPI.workspace.deleteIntegrationConnection(conn.connection_id);
      void loadData();
    } catch (error) {
      setStatusMessage(normalizeErrorMessage(error));
    } finally {
      setDisconnectingProviderId(null);
    }
  }

  if (isLoading) {
    return embedded ? (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    ) : (
      <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </section>
    );
  }

  const integrationContent = (
    <>
      {/* Auth gate */}
      {!authSessionState.isPending && !isSignedIn ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-destructive">
              <ShieldAlert size={13} />
              <span>Sign-In Required</span>
            </div>
            <p className="mt-1 text-sm font-medium text-foreground">
              Managed integrations are unavailable until you sign in.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              You can browse the catalog below, but connecting requires an authenticated session.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void authSessionState.requestAuth()}
          >
            <LogIn size={14} />
            Sign in
          </Button>
        </div>
      ) : null}

      {/* Search + Filter */}
      <div className="mt-5 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search integrations..."
            className="h-9 pl-8"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm text-foreground outline-none"
        >
          <option value="all">All</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Connected */}
      {connectedIntegrations.length > 0 ? (
        <div className="mt-6">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
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
                onDisconnect={() => void handleDisconnect(integration)}
                connecting={connectingProviderId === integration.providerId}
                disconnecting={disconnectingProviderId === integration.providerId}
                actionMode="connected"
              />
            ))}
          </div>
        </div>
      ) : null}

      {statusMessage ? (
        <p className="mt-4 text-xs text-muted-foreground">{statusMessage}</p>
      ) : null}

      {/* Available — grouped by category */}
      {groupedIntegrations.map(([category, items]) => (
        <div key={category} className="mt-6">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
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
                onDisconnect={() => {}}
                connecting={connectingProviderId === integration.providerId}
                disconnecting={false}
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
        <p className="mt-12 text-center text-sm text-muted-foreground">
          No integrations found.
        </p>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <div className="max-w-5xl">
        <p className="text-sm text-muted-foreground">
          Connect your accounts to use them in workspaces.
        </p>
        {integrationContent}
      </div>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Integrations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your accounts to use them in workspaces.
          </p>
          {integrationContent}
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
  onDisconnect,
  connecting,
  disconnecting,
  actionMode,
}: {
  integration: IntegrationCard;
  connected: boolean;
  canConnect: boolean;
  connectDisabledReason: string;
  onConnect: () => void;
  onDisconnect: () => void;
  connecting: boolean;
  disconnecting: boolean;
  actionMode: "connected" | "connect" | "disabled" | "unavailable";
}) {
  const muted = actionMode === "disabled";
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors ${
        muted ? "opacity-50" : "hover:bg-muted"
      }`}
    >
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
        {integration.logo ? (
          <img src={integration.logo} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-sm font-semibold text-muted-foreground">
            {integration.name.charAt(0)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {integration.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {integration.description}
        </div>
      </div>

      {connected ? (
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="border-primary/25 text-primary">
            <Check size={10} />
          </Badge>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={disconnecting}
            onClick={onDisconnect}
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Disconnect ${integration.name}`}
          >
            {disconnecting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Unplug size={13} />
            )}
          </Button>
        </div>
      ) : actionMode === "unavailable" ? (
        <Badge variant="secondary" title={connectDisabledReason}>
          Unavailable
        </Badge>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={connecting || !canConnect}
          onClick={onConnect}
          title={canConnect ? `Connect ${integration.name}` : connectDisabledReason}
        >
          {connecting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : !canConnect ? (
            <LogIn size={14} />
          ) : (
            <Plus size={14} />
          )}
        </Button>
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
