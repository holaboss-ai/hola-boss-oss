import { Check, Loader2, LogIn, Plus, Search, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDesktopAuthSession } from "@/lib/auth/authClient";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

interface Toolkit {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  auth_schemes: string[];
  categories: string[];
}

export function IntegrationsPane() {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const sessionState = useDesktopAuthSession();
  const isSignedIn = Boolean(sessionState.data?.user?.id);

  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const [connections, setConnections] = useState<
    IntegrationConnectionPayload[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [disconnectingSlug, setDisconnectingSlug] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [toolkitResult, connectionResult] = await Promise.all([
        window.electronAPI.workspace.composioListToolkits(),
        window.electronAPI.workspace.listIntegrationConnections(),
      ]);
      setToolkits(toolkitResult.toolkits);
      setConnections(connectionResult.connections);
    } catch {
      // Silently fail — toolkits will be empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Build a map of toolkit slug → connection for connected toolkits
  const connectionBySlug = useMemo(() => {
    const map = new Map<string, IntegrationConnectionPayload>();
    for (const conn of connections) {
      if (conn.status === "active" && conn.auth_mode === "composio") {
        const toolkit = toolkits.find((t) => {
          const providerSlug = t.slug.toLowerCase();
          const connProvider = conn.provider_id.toLowerCase();
          return (
            providerSlug === connProvider ||
            PROVIDER_TO_TOOLKIT_SLUG[connProvider] === providerSlug
          );
        });
        if (toolkit) {
          map.set(toolkit.slug, conn);
        }
      }
    }
    return map;
  }, [connections, toolkits]);

  const connectedSlugs = useMemo(
    () => new Set(connectionBySlug.keys()),
    [connectionBySlug],
  );

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const t of toolkits) {
      for (const c of t.categories) {
        if (c) cats.add(c);
      }
    }
    return [...cats].sort();
  }, [toolkits]);

  const connectedToolkits = useMemo(
    () => toolkits.filter((t) => connectedSlugs.has(t.slug)),
    [toolkits, connectedSlugs],
  );

  const filteredToolkits = useMemo(() => {
    let list = toolkits.filter((t) => !connectedSlugs.has(t.slug));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      );
    }
    if (categoryFilter !== "all") {
      list = list.filter((t) => t.categories.includes(categoryFilter));
    }
    return list;
  }, [toolkits, connectedSlugs, query, categoryFilter]);

  const groupedToolkits = useMemo(() => {
    const groups: Record<string, Toolkit[]> = {};
    for (const t of filteredToolkits) {
      const cat = t.categories[0] || "other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredToolkits]);

  async function handleConnect(toolkit: Toolkit) {
    if (!isSignedIn) {
      void window.electronAPI.auth.requestAuth();
      return;
    }

    setConnectingSlug(toolkit.slug);
    setConnectStatus("Complete authorization in your browser...");
    try {
      const runtimeConfig = await window.electronAPI.runtime.getConfig();
      const userId = runtimeConfig.userId ?? "local";
      const provider = TOOLKIT_SLUG_TO_PROVIDER[toolkit.slug] ?? toolkit.slug;

      const link = await window.electronAPI.workspace.composioConnect({
        provider,
        owner_user_id: userId,
      });

      await window.electronAPI.ui.openExternalUrl(link.redirect_url);

      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await window.electronAPI.workspace.composioAccountStatus(
          link.connected_account_id,
        );
        if (status.status === "ACTIVE") {
          await window.electronAPI.workspace.composioFinalize({
            connected_account_id: link.connected_account_id,
            provider,
            owner_user_id: userId,
            account_label: `${toolkit.name} (Managed)`,
          });
          setConnectStatus("");
          setConnectingSlug(null);
          void loadData();
          return;
        }
      }
      setConnectStatus("Connection timed out.");
    } catch (error) {
      setConnectStatus(
        error instanceof Error ? error.message : "Connection failed.",
      );
    } finally {
      setConnectingSlug(null);
    }
  }

  async function handleDisconnect(toolkit: Toolkit) {
    const conn = connectionBySlug.get(toolkit.slug);
    if (!conn) return;

    setDisconnectingSlug(toolkit.slug);
    setConnectStatus("");
    try {
      await window.electronAPI.workspace.deleteIntegrationConnection(
        conn.connection_id,
      );
      void loadData();
    } catch (error) {
      setConnectStatus(
        error instanceof Error ? error.message : "Disconnect failed.",
      );
    } finally {
      setDisconnectingSlug(null);
    }
  }

  if (isLoading) {
    return (
      <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </section>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          {/* Header */}
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Integrations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your accounts to use them in workspaces.
          </p>

          {/* Auth gate banner */}
          {!isSignedIn ? (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Sign in to connect integrations.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void window.electronAPI.auth.requestAuth()}
              >
                <LogIn size={14} />
                Sign in
              </Button>
            </div>
          ) : null}

          {/* Search + Filter */}
          <div className="mt-5 flex items-center gap-3">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search integrations..."
                className="h-9 pl-8"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm text-foreground outline-none"
            >
              <option value="all">All</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Connected */}
          {connectedToolkits.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Connected
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {connectedToolkits.map((t) => (
                  <ToolkitRow
                    key={t.slug}
                    toolkit={t}
                    connected
                    signedIn={isSignedIn}
                    onConnect={() => void handleConnect(t)}
                    onDisconnect={() => void handleDisconnect(t)}
                    connecting={connectingSlug === t.slug}
                    disconnecting={disconnectingSlug === t.slug}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Status message */}
          {connectStatus ? (
            <p className="mt-4 text-xs text-muted-foreground">
              {connectStatus}
            </p>
          ) : null}

          {/* Available — grouped by category */}
          {groupedToolkits.map(([category, items]) => (
            <div key={category} className="mt-6">
              <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {items.map((t) => (
                  <ToolkitRow
                    key={t.slug}
                    toolkit={t}
                    connected={false}
                    signedIn={isSignedIn}
                    onConnect={() => void handleConnect(t)}
                    onDisconnect={() => {}}
                    connecting={connectingSlug === t.slug}
                    disconnecting={false}
                  />
                ))}
              </div>
            </div>
          ))}

          {filteredToolkits.length === 0 && connectedToolkits.length === 0 ? (
            <p className="mt-12 text-center text-sm text-muted-foreground">
              No integrations found.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ToolkitRow({
  toolkit,
  connected,
  signedIn,
  onConnect,
  onDisconnect,
  connecting,
  disconnecting,
}: {
  toolkit: Toolkit;
  connected: boolean;
  signedIn: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  connecting: boolean;
  disconnecting: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors hover:bg-muted">
      {/* Logo */}
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background p-1.5">
        {toolkit.logo ? (
          <img src={toolkit.logo} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-sm font-semibold text-muted-foreground">
            {toolkit.name.charAt(0)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {toolkit.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {toolkit.description}
        </div>
      </div>

      {/* Action */}
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
            aria-label={`Disconnect ${toolkit.name}`}
          >
            {disconnecting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Unplug size={13} />
            )}
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={connecting}
          onClick={onConnect}
          aria-label={signedIn ? `Connect ${toolkit.name}` : "Sign in to connect"}
        >
          {connecting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : !signedIn ? (
            <LogIn size={14} />
          ) : (
            <Plus size={14} />
          )}
        </Button>
      )}
    </div>
  );
}

/**
 * Maps Holaboss provider_id → Composio toolkit slug.
 * e.g. a connection with provider_id "google" maps to toolkit "gmail".
 */
const PROVIDER_TO_TOOLKIT_SLUG: Record<string, string> = {
  google: "gmail",
};

/**
 * Maps Composio toolkit slug → Holaboss provider_id for the connect flow.
 */
const TOOLKIT_SLUG_TO_PROVIDER: Record<string, string> = {
  gmail: "google",
  googlesheets: "google",
  googlecalendar: "google",
  googledrive: "google",
};
