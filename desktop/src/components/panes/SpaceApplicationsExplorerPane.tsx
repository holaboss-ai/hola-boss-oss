import { AppWindow, Plus } from "lucide-react";
import { providerIcon } from "@/components/onboarding/constants";
import { Button } from "@/components/ui/button";
import type { WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

interface SpaceApplicationsExplorerPaneProps {
  installedApps: WorkspaceInstalledAppDefinition[];
  activeAppId?: string | null;
  onSelectApp: (appId: string) => void;
  onAddApp: () => void;
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

type AppStatusTone = "ready" | "loading" | "error";

function appStatusTone(app: WorkspaceInstalledAppDefinition): AppStatusTone {
  if (app.error?.trim()) {
    return "error";
  }
  if (app.ready) {
    return "ready";
  }
  return "loading";
}

function statusPipClass(tone: AppStatusTone): string {
  if (tone === "error") {
    return "bg-destructive";
  }
  if (tone === "ready") {
    return "bg-success";
  }
  return "bg-info animate-pulse";
}

function statusPipLabel(tone: AppStatusTone): string {
  if (tone === "error") {
    return "Error";
  }
  if (tone === "ready") {
    return "Ready";
  }
  return "Starting";
}

export function SpaceApplicationsExplorerPane({
  installedApps,
  activeAppId = null,
  onSelectApp,
  onAddApp,
}: SpaceApplicationsExplorerPaneProps) {
  const isEmpty = installedApps.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="flex items-center justify-between gap-3 border-b border-border p-2">
        <Button type="button" variant="ghost" size="sm" onClick={onAddApp}>
          <Plus className="size-4" />
          <span className="text-muted-foreground">Add Application</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-2.5 px-4 py-10 text-center">
            <div className="grid size-10 place-items-center rounded-[10px] bg-muted text-muted-foreground">
              <AppWindow size={16} />
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              No apps installed in this workspace yet.
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {installedApps.map((app) => {
              const isActive = activeAppId === app.id;
              const tone = appStatusTone(app);
              const statusLabel = statusPipLabel(tone);
              return (
                <Button
                  key={app.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelectApp(app.id)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={`${app.label} — ${statusLabel}`}
                  className={`relative h-auto w-full justify-start gap-0 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/55"
                  }`}
                >
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary"
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="relative shrink-0">
                      <div className="grid size-9 place-items-center rounded-[10px] bg-muted text-muted-foreground">
                        {providerIcon(app.id, 16) ?? (
                          <span className="text-xs font-semibold uppercase tracking-wide">
                            {appInitials(app.label)}
                          </span>
                        )}
                      </div>
                      <span
                        aria-hidden="true"
                        className={`absolute -bottom-0.5 -right-0.5 size-[9px] rounded-full ring-2 ring-background ${statusPipClass(tone)}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {app.label}
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground">
                        {app.summary}
                      </div>
                    </div>
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
