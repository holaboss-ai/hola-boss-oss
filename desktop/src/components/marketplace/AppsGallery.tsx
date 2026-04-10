import { useEffect, useMemo } from "react";
import { ExternalLink, LoaderCircle, RotateCw } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { AppCatalogCard } from "./AppCatalogCard";

const PROVIDER_DISPLAY: Record<string, string> = {
  twitter: "Twitter / X",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  gmail: "Google (Gmail)",
  googlesheets: "Google (Sheets)",
  github: "GitHub",
};

export function AppsGallery() {
  const {
    appCatalog,
    isLoadingAppCatalog,
    appCatalogError,
    appCatalogSource,
    refreshAppCatalog,
    installingAppId,
    installAppFromCatalog,
    installedApps,
    selectedWorkspace,
    pendingAppInstall,
    clearPendingAppInstall,
    connectAndInstallApp,
    isConnectingAppIntegration,
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Install apps into your workspace.
        </p>
        <button
          type="button"
          onClick={() => void refreshAppCatalog()}
          disabled={isLoadingAppCatalog || anyInstalling}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <RotateCw size={12} />
          Refresh
        </button>
      </div>

      {workspaceGated ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Select a workspace to install apps.
        </p>
      ) : null}

      {appCatalogError ? (
        <div className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {appCatalogError}
        </div>
      ) : null}

      {/* Integration connection prompt */}
      {pendingAppInstall ? (
        <div className="mt-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            Connect {PROVIDER_DISPLAY[pendingAppInstall.provider] ?? pendingAppInstall.provider}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pendingAppInstall.appId} requires a connected{" "}
            {PROVIDER_DISPLAY[pendingAppInstall.provider] ?? pendingAppInstall.provider}{" "}
            account to work. Connect it first, then the app will be installed automatically.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={isConnectingAppIntegration}
              onClick={() => void connectAndInstallApp()}
              className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isConnectingAppIntegration ? (
                <>
                  <LoaderCircle size={13} className="animate-spin" />
                  Waiting for authorization…
                </>
              ) : (
                <>
                  <ExternalLink size={13} />
                  Connect account
                </>
              )}
            </button>
            <button
              type="button"
              disabled={isConnectingAppIntegration}
              onClick={clearPendingAppInstall}
              className="inline-flex h-8 items-center rounded-md px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {isLoadingAppCatalog && appCatalog.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <LoaderCircle
            size={16}
            className="animate-spin text-muted-foreground"
          />
        </div>
      ) : appCatalog.length === 0 ? (
        <div className="mt-8 text-center text-xs text-muted-foreground">
          No apps available.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
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
                disabled={
                  workspaceGated ||
                  (anyInstalling && !isInstalling) ||
                  Boolean(pendingAppInstall)
                }
                onInstall={() => void installAppFromCatalog(entry.app_id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
