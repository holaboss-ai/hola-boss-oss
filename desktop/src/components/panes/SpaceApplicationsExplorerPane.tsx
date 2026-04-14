import { AppWindow, CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import { providerIcon } from "@/components/onboarding/constants";
import { Button } from "@/components/ui/button";
import type { WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

interface SpaceApplicationsExplorerPaneProps {
  installedApps: WorkspaceInstalledAppDefinition[];
  activeAppId?: string | null;
  onSelectApp: (appId: string) => void;
}

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

export function SpaceApplicationsExplorerPane({
  installedApps,
  activeAppId = null,
  onSelectApp,
}: SpaceApplicationsExplorerPaneProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="border-b border-border/45 px-3 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
          Applications
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {installedApps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/40 px-3 py-3 text-xs leading-5 text-muted-foreground/70">
            Installed workspace apps will appear here once the selected workspace has applications.
          </div>
        ) : (
          <div className="space-y-1">
            {installedApps.map((app) => {
              const isActive = activeAppId === app.id;
              const hasError = Boolean(app.error?.trim());
              const isReady = app.ready && !hasError;
              return (
                <Button
                  key={app.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelectApp(app.id)}
                  className={`h-auto w-full justify-start rounded-lg px-2.5 py-2 text-left ${
                    isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      {providerIcon(app.id, 16) ?? (
                        <span className="text-[11px] font-semibold uppercase tracking-wide">
                          {appInitials(app.label)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-foreground">
                          {app.label}
                        </span>
                        {hasError ? (
                          <TriangleAlert size={12} className="shrink-0 text-destructive" />
                        ) : isReady ? (
                          <CheckCircle2 size={12} className="shrink-0 text-emerald-500" />
                        ) : (
                          <LoaderCircle size={12} className="shrink-0 animate-spin text-sky-500" />
                        )}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                        {app.summary}
                      </div>
                    </div>
                    <AppWindow size={14} className="mt-0.5 shrink-0 text-muted-foreground/70" />
                  </div>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
