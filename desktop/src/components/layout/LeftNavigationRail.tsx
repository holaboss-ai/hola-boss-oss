import { BriefcaseBusiness, MessageSquareText, Sparkles, Workflow } from "lucide-react";

export type LeftRailItem = "agent" | "automations" | "skills";

interface LeftNavigationRailProps {
  activeItem: LeftRailItem;
  onSelectItem: (item: LeftRailItem) => void;
}

const PRIMARY_ITEMS: Array<{ id: LeftRailItem; label: string; icon: React.ReactNode }> = [
  { id: "agent", label: "Agent", icon: <MessageSquareText size={14} /> },
  { id: "automations", label: "Automations", icon: <Workflow size={14} /> },
  { id: "skills", label: "Skills", icon: <Sparkles size={14} /> }
];

const APP_ITEMS = [
  { id: "twitter", label: "Twitter" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "reddit", label: "Reddit" }
];

export function LeftNavigationRail({ activeItem, onSelectItem }: LeftNavigationRailProps) {
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
          {APP_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex items-center gap-3 rounded-[14px] px-2 py-2 text-left text-[12px] text-text-muted transition hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
            >
              <span className="h-2 w-2 rounded-full bg-neon-green/80" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
