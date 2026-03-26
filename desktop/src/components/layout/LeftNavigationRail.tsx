import { FolderOpen, MessageSquareText, PanelLeftClose, PanelLeftOpen, Sparkles, Workflow } from "lucide-react";
import { type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

export type LeftRailItem = "agent" | "files" | "automations" | "skills";

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
  { id: "files", label: "Files", icon: <FolderOpen size={14} /> },
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
  return (
    <aside
      className={`theme-shell soft-vignette neon-border relative hidden h-full min-h-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card transition-[min-width,max-width,padding] duration-300 ease-out lg:flex ${
        collapsed ? "min-w-[72px] max-w-[72px] px-2.5 py-3" : "min-w-[210px] max-w-[230px] p-3"
      }`}
    >
      <div className={`mb-2 flex ${collapsed ? "justify-center" : "justify-start px-1"}`}>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand left panel" : "Collapse left panel"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-neon-green/45 bg-neon-green/10 text-neon-green shadow-glow transition-all duration-200 hover:border-neon-green/60 hover:bg-neon-green/14 active:scale-95"
        >
          {collapsed ? (
            <PanelLeftOpen size={14} className="transition-transform duration-300" />
          ) : (
            <PanelLeftClose size={14} className="transition-transform duration-300" />
          )}
        </button>
      </div>

      <nav className={`grid gap-1 ${collapsed ? "justify-items-center" : "px-1"}`}>
        {PRIMARY_ITEMS.map((item) => {
          const isActive = item.id === activeItem;
          return (
            <button
              key={item.id}
              type="button"
              title={collapsed ? item.label : undefined}
              onClick={() => onSelectItem(item.id)}
              className={`flex items-center rounded-[16px] py-2.5 text-left text-[12px] transition-all duration-200 ${
                collapsed ? "w-11 justify-center px-0" : "gap-3 px-3"
              } ${
                isActive
                  ? "border border-neon-green/35 bg-neon-green/10 text-text-main"
                  : "border border-transparent text-text-muted hover:border-panel-border/40 hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
              }`}
            >
              <span className={isActive ? "text-neon-green" : "text-text-dim/80"}>{item.icon}</span>
              <span
                className={`truncate transition-all duration-200 ${
                  collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className={`mt-6 border-t border-panel-border/30 pt-3 ${collapsed ? "mx-auto w-11 px-0" : "px-3"}`}>
        {!collapsed ? <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/70">Apps</div> : null}

        <div className={`mt-3 grid gap-2 ${collapsed ? "justify-items-center" : ""}`}>
          {isLoadingApps ? (
            <div className="rounded-[14px] border border-panel-border/35 px-2 py-2 text-[11px] text-text-dim/78">
              Loading workspace apps...
            </div>
          ) : installedApps.length ? (
            (collapsed ? installedApps.slice(0, 6) : installedApps).map((item) => (
              <button
                key={item.id}
                type="button"
                title={collapsed ? item.label : undefined}
                onClick={() => onSelectApp(item.id)}
                className={`flex items-center rounded-[14px] border px-2 py-2 text-left text-[12px] transition-all duration-200 ${
                  collapsed ? "w-11 justify-center px-0" : "gap-3"
                } ${
                  activeItem === "agent" && activeAppId === item.id
                    ? "border-neon-green/35 bg-neon-green/10 text-text-main"
                    : "border-transparent text-text-muted hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${item.accentClassName}`} />
                {!collapsed ? (
                  <>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="text-[9px] uppercase tracking-[0.12em] text-text-dim/72">{item.buildStatus}</span>
                  </>
                ) : null}
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
