import { AppWindow, Plus } from "lucide-react";
import { providerIcon } from "@/components/onboarding/constants";
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={onAddApp}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5 shrink-0" />
            <span>Add application</span>
          </button>

          {isEmpty ? null : (
            installedApps.map((app) => {
              const isActive = activeAppId === app.id;
              const tone = appStatusTone(app);
              const showStatus = tone !== "ready";
              const icon = providerIcon(app.id, 16);
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => onSelectApp(app.id)}
                  aria-current={isActive ? "page" : undefined}
                  title={app.summary || app.label}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {icon ?? (
                      <span className="grid size-4 place-items-center rounded-[4px] bg-muted text-[9px] font-semibold uppercase text-muted-foreground">
                        {appInitials(app.label)}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{app.label}</span>
                  {showStatus ? (
                    <span
                      aria-hidden="true"
                      title={statusPipLabel(tone)}
                      className={`size-1.5 shrink-0 rounded-full ${statusPipClass(tone)}`}
                    />
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        {isEmpty ? (
          <div className="mt-6 flex flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
            <div className="grid size-8 place-items-center rounded-[10px] bg-muted text-muted-foreground">
              <AppWindow className="size-3.5" />
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              No apps installed yet.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
