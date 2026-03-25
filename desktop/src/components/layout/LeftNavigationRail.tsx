import { BriefcaseBusiness, MessageSquareText, Sparkles, Workflow } from "lucide-react";
import { type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

export type LeftRailItem = "agent" | "automations" | "skills";

interface LeftNavigationRailProps {
  activeItem: LeftRailItem;
  onSelectItem: (item: LeftRailItem) => void;
  activeAppId: string | null;
  installedApps: WorkspaceInstalledAppDefinition[];
  isLoadingApps: boolean;
  onSelectApp: (appId: string) => void;
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
  onSelectApp
}: LeftNavigationRailProps) {
  return (
    <aside className="theme-shell soft-vignette neon-border relative hidden min-h-0 min-w-[210px] max-w-[230px] flex-col overflow-hidden rounded-[var(--theme-radius-card)] p-3 shadow-card lg:flex">
      <nav className="grid gap-1 px-1 pt-1">
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

      <div className="mt-6 px-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/70">Apps</div>
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded-[10px] border border-panel-border/35 text-text-muted transition hover:border-neon-green/35 hover:text-neon-green"
          >
            <BriefcaseBusiness size={12} />
          </button>
        </div>

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
