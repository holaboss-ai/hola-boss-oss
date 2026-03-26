import { MessageSquareText, PanelLeftClose, PanelLeftOpen, Sparkles, Workflow } from "lucide-react";
import { type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

export type LeftRailItem = "agent" | "automations" | "skills";

interface LeftNavigationRailProps {
  activeItem: LeftRailItem;
  onSelectItem: (item: LeftRailItem) => void;
  activeAppId: string | null;
  installedApps: WorkspaceInstalledAppDefinition[];
  isLoadingApps: boolean;
  onSelectApp: (appId: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const PRIMARY_ITEMS: Array<{ id: LeftRailItem; label: string; icon: React.ReactNode }> = [
  { id: "agent", label: "Agent", icon: <MessageSquareText size={14} /> },
  { id: "automations", label: "Automations", icon: <Workflow size={14} /> },
  { id: "skills", label: "Skills", icon: <Sparkles size={14} /> }
];

export function LeftNavigationRail({
  activeItem,
  onSelectItem,
  activeAppId,
  installedApps,
  isLoadingApps,
  onSelectApp,
  collapsed,
  onToggleCollapsed
}: LeftNavigationRailProps) {
  if (collapsed) {
    return (
      <aside className="theme-shell soft-vignette neon-border relative hidden h-full min-h-0 min-w-[72px] max-w-[72px] flex-col overflow-hidden rounded-[var(--theme-radius-card)] p-3 shadow-card lg:flex">
        <div className="mb-2 flex justify-start px-1">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand left panel"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-neon-green/45 bg-neon-green/10 text-neon-green shadow-glow transition hover:border-neon-green/60 hover:bg-neon-green/14"
          >
            <PanelLeftOpen size={14} />
          </button>
        </div>

        <nav className="grid gap-1 px-1">
          {PRIMARY_ITEMS.map((item) => {
            const isActive = item.id === activeItem;
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => onSelectItem(item.id)}
                className={`flex items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-[12px] transition ${
                  isActive
                    ? "border-neon-green/35 bg-neon-green/10 text-text-main"
                    : "border-transparent text-text-muted hover:border-panel-border/40 hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
                }`}
              >
                <span className={isActive ? "text-neon-green" : "text-text-dim/80"}>{item.icon}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-6 border-t border-panel-border/30 px-3 pt-3">
          <div className="grid gap-2">
            {isLoadingApps ? (
              <div className="grid h-10 place-items-center rounded-[12px] border border-panel-border/35 text-[9px] text-text-dim/78">
                ...
              </div>
            ) : installedApps.length ? (
              installedApps.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  onClick={() => onSelectApp(item.id)}
                  className={`flex items-center gap-3 rounded-[14px] border px-2 py-2 text-left text-[12px] transition ${
                    activeItem === "agent" && activeAppId === item.id
                      ? "border-neon-green/35 bg-neon-green/10 text-text-main"
                      : "border-transparent text-text-muted hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${item.accentClassName}`} />
                </button>
              ))
            ) : null}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="theme-shell soft-vignette neon-border relative hidden h-full min-h-0 min-w-[210px] max-w-[230px] flex-col overflow-hidden rounded-[var(--theme-radius-card)] p-3 shadow-card lg:flex">
      <div className="mb-2 flex justify-start px-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse left panel"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-neon-green/45 bg-neon-green/10 text-neon-green shadow-glow transition hover:border-neon-green/60 hover:bg-neon-green/14"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      <nav className="grid gap-1 px-1">
        {PRIMARY_ITEMS.map((item) => {
          const isActive = item.id === activeItem;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem(item.id)}
              className={`flex items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-[12px] transition ${
                isActive
                  ? "border border-neon-green/35 bg-neon-green/10 text-text-main"
                  : "border border-transparent text-text-muted hover:border-panel-border/40 hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
              }`}
            >
              <span className={isActive ? "text-neon-green" : "text-text-dim/80"}>{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-6 border-t border-panel-border/30 px-3 pt-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/70">Apps</div>

        <div className="mt-3 grid gap-2">
          {isLoadingApps ? (
            <div className="rounded-[14px] border border-panel-border/35 px-2 py-2 text-[11px] text-text-dim/78">
              Loading workspace apps...
            </div>
          ) : installedApps.length ? (
            installedApps.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectApp(item.id)}
                className={`flex items-center gap-3 rounded-[14px] border px-2 py-2 text-left text-[12px] transition ${
                  activeItem === "agent" && activeAppId === item.id
                    ? "border-neon-green/35 bg-neon-green/10 text-text-main"
                    : "border-transparent text-text-muted hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${item.accentClassName}`} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="text-[9px] uppercase tracking-[0.12em] text-text-dim/72">{item.buildStatus}</span>
              </button>
            ))
          ) : (
            <div className="rounded-[14px] border border-panel-border/35 px-2 py-2 text-[11px] text-text-dim/78">
              No installed apps in this workspace yet.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
