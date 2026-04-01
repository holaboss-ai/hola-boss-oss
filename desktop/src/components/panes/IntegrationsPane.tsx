import { Check, Loader2, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const [connections, setConnections] = useState<
    IntegrationConnectionPayload[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
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

  const connectedSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const conn of connections) {
      if (conn.status === "active" && conn.auth_mode === "composio") {
        // Map provider_id back to toolkit slug
        const toolkit = toolkits.find((t) => {
          const providerSlug = t.slug.toLowerCase();
          const connProvider = conn.provider_id.toLowerCase();
          return (
            providerSlug === connProvider ||
            PROVIDER_TO_TOOLKIT_SLUG[connProvider] === providerSlug
          );
        });
        if (toolkit) {
          slugs.add(toolkit.slug);
        }
      }
    }
    return slugs;
  }, [connections, toolkits]);

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
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-foreground">
            Integrations
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Connect your accounts to use them in workspaces.
          </p>

          {/* Search + Filter */}
          <div className="mt-5 flex items-center gap-3">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search integrations..."
                className="h-9 w-full rounded-lg border border-border bg-muted pl-8 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-muted px-3 text-[13px] text-foreground outline-none"
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
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Connected
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {connectedToolkits.map((t) => (
                  <ToolkitRow
                    key={t.slug}
                    toolkit={t}
                    connected
                    onConnect={() => void handleConnect(t)}
                    connecting={connectingSlug === t.slug}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Status message */}
          {connectStatus ? (
            <div className="mt-4 text-[12px] text-muted-foreground">
              {connectStatus}
            </div>
          ) : null}

          {/* Available — grouped by category */}
          {groupedToolkits.map(([category, items]) => (
            <div key={category} className="mt-6">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {items.map((t) => (
                  <ToolkitRow
                    key={t.slug}
                    toolkit={t}
                    connected={false}
                    onConnect={() => void handleConnect(t)}
                    connecting={connectingSlug === t.slug}
                  />
                ))}
              </div>
            </div>
          ))}

          {filteredToolkits.length === 0 && connectedToolkits.length === 0 ? (
            <div className="mt-12 text-center text-[13px] text-muted-foreground">
              No integrations found.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ToolkitRow({
  toolkit,
  connected,
  onConnect,
  connecting,
}: {
  toolkit: Toolkit;
  connected: boolean;
  onConnect: () => void;
  connecting: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors hover:bg-muted">
      {/* Logo */}
      <div className="flex size-10 p-1.5 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
        {toolkit.logo ? (
          <img src={toolkit.logo} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-[14px] font-semibold text-muted-foreground/50">
            {toolkit.name.charAt(0)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">
          {toolkit.name}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {toolkit.description}
        </div>
      </div>

      {/* Action */}
      {connected ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
          <Check size={12} />
        </span>
      ) : (
        <button
          type="button"
          disabled={connecting}
          onClick={onConnect}
          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
        >
          {connecting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
        </button>
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
