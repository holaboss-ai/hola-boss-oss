import {
  LayoutGrid,
  MessageSquareText,
  Sparkles,
  Workflow,
} from "lucide-react";
import type { WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export type LeftRailItem =
  | "space"
  | "automations"
  | "skills"
  | "marketplace"
  | "app";

interface LeftNavigationRailProps {
  activeItem: LeftRailItem;
  onSelectItem: (item: LeftRailItem) => void;
  installedApps?: WorkspaceInstalledAppDefinition[];
  activeAppId?: string | null;
  onSelectApp?: (appId: string) => void;
}

const PRIMARY_ITEMS: Array<{
  id: LeftRailItem;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "space", label: "Space", icon: <MessageSquareText size={15} /> },
  { id: "automations", label: "Automations", icon: <Workflow size={15} /> },
  { id: "skills", label: "Skills", icon: <Sparkles size={15} /> },
];

function appInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
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
  onSelectApp,
}: LeftNavigationRailProps) {
  return (
    <aside className="relative hidden h-full min-h-0 w-15 flex-col overflow-visible rounded-xl border border-border bg-card/80 px-2 py-3 shadow-md backdrop-blur-sm lg:flex">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-visible">
        <nav className="grid justify-items-center gap-0.5">
          {PRIMARY_ITEMS.map((item) => {
            const isActive = item.id === activeItem;
            return (
              <div key={item.id} className="group relative">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={item.label}
                        title={item.label}
                        onClick={() => onSelectItem(item.id)}
                        className={`flex size-10 items-center justify-center rounded-lg transition-colors ${
                          isActive
                            ? "bg-primary/12 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        {item.icon}
                      </button>
                    }
                  ></TooltipTrigger>
                  <TooltipContent side="right" align="center">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </nav>

        {installedApps.length > 0 ? (
          <>
            <div className="h-px w-7 bg-border" />
            <nav className="chat-scrollbar-hidden flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-x-hidden overflow-y-auto pb-1">
              {installedApps.map((app) => {
                const isActive = activeAppId === app.id;
                const isReady = "ready" in app && app.ready;
                const hasError =
                  "error" in app && typeof app.error === "string" && app.error;
                return (
                  <div key={app.id} className="group relative">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label={app.label}
                            title={app.label}
                            onClick={() => onSelectApp?.(app.id)}
                            className={`relative flex size-10 items-center justify-center rounded-lg border text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                              isActive
                                ? "border-primary/40 bg-primary/12 text-foreground"
                                : "border-border/50 bg-card/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            }`}
                          >
                            <span
                              className={`flex size-6 items-center justify-center rounded-full text-[9px] font-semibold text-slate-950 ${app.accentClassName}`}
                            >
                              {appInitials(app.label)}
                            </span>
                            <span
                              className={`absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card ${
                                hasError
                                  ? "bg-destructive"
                                  : isReady
                                    ? "bg-primary"
                                    : "animate-pulse bg-sky-400"
                              }`}
                            />
                          </button>
                        }
                      />
                      <TooltipContent side="right" align="center">
                        {app.label}
                      </TooltipContent>
                    </Tooltip>
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
