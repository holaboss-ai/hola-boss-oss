import { useEffect, useMemo } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { AppCatalogCard } from "./AppCatalogCard";

function SourceToggle({
  value,
  onChange,
  disabled,
}: {
  value: "marketplace" | "local";
  onChange: (next: "marketplace" | "local") => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border bg-muted/30 p-0.5">
      {(["marketplace", "local"] as const).map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            className={[
              "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
              active
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled ? "cursor-not-allowed opacity-60" : "",
            ].join(" ")}
          >
            {option === "marketplace" ? "Marketplace" : "Local"}
          </button>
        );
      })}
    </div>
  );
}

export function AppsGallery() {
  const {
    appCatalog,
    isLoadingAppCatalog,
    appCatalogError,
    appCatalogSource,
    setAppCatalogSource,
    refreshAppCatalog,
    installingAppId,
    installAppFromCatalog,
    installedApps,
    selectedWorkspace,
  } = useWorkspaceDesktop();

  useEffect(() => {
    void refreshAppCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appCatalogSource]);

  const installedIds = useMemo(
    () => new Set(installedApps.map((app) => app.id)),
    [installedApps],
  );
  const workspaceGated = !selectedWorkspace;
  const anyInstalling = Boolean(installingAppId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Apps</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Install pre-built modules into your workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SourceToggle
            value={appCatalogSource}
            onChange={setAppCatalogSource}
            disabled={isLoadingAppCatalog || anyInstalling}
          />
          <button
            type="button"
            onClick={() => void refreshAppCatalog()}
            disabled={isLoadingAppCatalog || anyInstalling}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {workspaceGated ? (
        <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          Select a workspace to install apps.
        </div>
      ) : null}

      {appCatalogError ? (
        <div className="mb-3 rounded-lg border border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.06)] p-3 text-xs text-[rgba(255,153,102,0.92)]">
          {appCatalogError}
        </div>
      ) : null}

      {isLoadingAppCatalog && appCatalog.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <LoaderCircle size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : appCatalog.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No {appCatalogSource === "marketplace" ? "published" : "local"} apps available.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {appCatalog.map((entry) => {
            const isInstalled = installedIds.has(entry.app_id);
            const isInstalling = installingAppId === entry.app_id;
            const state = isInstalled
              ? "installed"
              : isInstalling
                ? "installing"
                : "available";
            return (
              <AppCatalogCard
                key={`${entry.source}:${entry.app_id}`}
                entry={entry}
                state={state}
                disabled={workspaceGated || (anyInstalling && !isInstalling)}
                onInstall={() => void installAppFromCatalog(entry.app_id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
