import type { ReactNode } from "react";
import { FolderOpen, Globe, X } from "lucide-react";

export type WorkbenchTab = "browser" | "files";

interface WorkbenchPanelProps {
  activeTab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  onClose: () => void;
  children: ReactNode;
}

export function WorkbenchPanel({ activeTab, onTabChange, onClose, children }: WorkbenchPanelProps) {
  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-[360px] min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <header className="theme-header-surface flex shrink-0 items-center justify-between gap-3 border-b border-neon-green/15 px-4 py-3">
        <div className="flex items-center gap-2">
          <WorkbenchTabButton
            active={activeTab === "browser"}
            icon={<Globe size={14} />}
            label="Browser"
            onClick={() => onTabChange("browser")}
          />
          <WorkbenchTabButton
            active={activeTab === "files"}
            icon={<FolderOpen size={14} />}
            label="Files"
            onClick={() => onTabChange("files")}
          />
        </div>

        <button
          type="button"
          aria-label="Close workbench"
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-[var(--theme-radius-pill)] border border-panel-border/45 text-text-muted/78 transition hover:border-neon-green/45 hover:text-neon-green"
        >
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
    </section>
  );
}

function WorkbenchTabButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 items-center gap-2 rounded-[16px] border px-3 text-[12px] transition ${
        active
          ? "border-neon-green/45 bg-neon-green/10 text-neon-green"
          : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
