import { Cable, LayoutGrid, MessageSquareText, Sparkles, Workflow } from "lucide-react";
import type { WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

export type LeftRailItem = "space" | "automations" | "skills" | "integrations" | "marketplace" | "app";

interface LeftNavigationRailProps {
  activeItem: LeftRailItem;
  onSelectItem: (item: LeftRailItem) => void;
  installedApps?: WorkspaceInstalledAppDefinition[];
  activeAppId?: string | null;
  onSelectApp?: (appId: string) => void;
}

const PRIMARY_ITEMS: Array<{ id: LeftRailItem; label: string; icon: React.ReactNode }> = [
  { id: "space", label: "Space", icon: <MessageSquareText size={14} /> },
  { id: "automations", label: "Automations", icon: <Workflow size={14} /> },
  { id: "skills", label: "Skills", icon: <Sparkles size={14} /> },
  { id: "integrations", label: "Integrations", icon: <Cable size={14} /> },
  { id: "marketplace", label: "Marketplace", icon: <LayoutGrid size={14} /> }
];

function appInitials(label: string): string {
  const parts = label
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase();
  }
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

export function LeftNavigationRail({
  activeItem,
  onSelectItem,
  installedApps = [],
  activeAppId = null,
  onSelectApp
}: LeftNavigationRailProps) {
  const tooltipClassName =
    "pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-30 -translate-y-1/2 whitespace-nowrap rounded-[12px] border border-panel-border/70 bg-[rgb(var(--color-panel-bg))] px-2.5 py-1.5 text-[11px] font-medium text-text-main shadow-[0_10px_26px_rgba(25,33,53,0.12)] opacity-0 transition duration-150 group-hover:opacity-100 group-focus-visible:opacity-100";

  return (
    <aside
      className="theme-shell soft-vignette neon-border relative hidden h-full min-h-0 min-w-[60px] max-w-[60px] flex-col overflow-visible rounded-[var(--theme-radius-card)] px-2 py-3 shadow-card lg:flex"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-visible">
        <nav className="grid justify-items-center gap-1">
          {PRIMARY_ITEMS.map((item) => {
            const isActive = item.id === activeItem;
            return (
              <div key={item.id} className="group relative">
                <button
                  type="button"
                  aria-label={item.label}
                  title={item.label}
                  onClick={() => onSelectItem(item.id)}
                  className={`flex w-10 items-center justify-center rounded-[14px] py-2.5 text-left text-[12px] transition-all duration-200 ${
                    isActive
                      ? "border border-neon-green/35 bg-neon-green/10 text-text-main"
                      : "border border-transparent text-text-muted hover:border-panel-border/40 hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
                  }`}
                >
                  <span className={isActive ? "text-neon-green" : "text-text-dim/80"}>{item.icon}</span>
                </button>
                <div className={tooltipClassName}>{item.label}</div>
              </div>
            );
          })}
        </nav>

        {installedApps.length > 0 ? (
          <>
            <div className="h-px w-8 rounded-full bg-panel-border/45" />
            <nav className="chat-scrollbar-hidden flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto pb-1">
              {installedApps.map((app) => {
                const isActive = activeAppId === app.id;
                const isReady = "ready" in app && app.ready;
                const hasError = "error" in app && typeof app.error === "string" && app.error;
                return (
                  <div key={app.id} className="group relative">
                    <button
                      type="button"
                      aria-label={app.label}
                      title={app.label}
                      onClick={() => onSelectApp?.(app.id)}
                      className={`relative flex h-10 w-10 items-center justify-center rounded-[14px] border text-[10px] font-semibold uppercase tracking-[0.08em] transition-all duration-200 ${
                        isActive
                          ? "border-neon-green/45 bg-neon-green/10 text-text-main shadow-[0_10px_18px_rgba(64,201,162,0.16)]"
                          : "border-panel-border/35 bg-panel-bg/55 text-text-muted hover:border-panel-border/55 hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold text-slate-950 ${app.accentClassName}`}
                      >
                        {appInitials(app.label)}
                      </span>
                      <span
                        className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[rgb(var(--color-panel-bg))] ${
                          hasError
                            ? "bg-rose-400"
                            : isReady
                              ? "bg-neon-green"
                              : "animate-pulse bg-sky-400"
                        }`}
                      />
                    </button>
                    <div className={tooltipClassName}>{app.label}</div>
                  </div>
                );
              })}
            </nav>
          </>
        ) : null}
      </div>
    </aside>
  );
}
