import { useEffect, useState } from "react";
import { Activity, FolderKanban, LoaderCircle, Play, Square } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";
import { getWorkspaceAppDefinition, type WorkspaceAppDefinition, type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

interface AppSurfacePaneProps {
  appId: string;
  app?: WorkspaceInstalledAppDefinition | WorkspaceAppDefinition | null;
  resourceId?: string | null;
  view?: string | null;
}

export function AppSurfacePane({ appId, app: providedApp, resourceId, view }: AppSurfacePaneProps) {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const { refreshInstalledApps } = useWorkspaceDesktop();
  const app = providedApp || getWorkspaceAppDefinition(appId);
  const [isActing, setIsActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionDetail, setActionDetail] = useState("");
  const label = app?.label ?? appId;
  const descriptor = resourceId ? `Resource ${resourceId}` : "Workspace app home";
  const modeLabel = view || (resourceId ? "editor" : "home");
  const configPath = app && "configPath" in app && typeof app.configPath === "string" ? app.configPath : null;
  const lifecycle = app && "lifecycle" in app && app.lifecycle ? Object.entries(app.lifecycle) : [];
  const buildStatus =
    app && "buildStatus" in app && typeof app.buildStatus === "string" ? app.buildStatus : "unknown";
  const buildTone =
    buildStatus === "running" || buildStatus === "completed"
      ? "success"
      : buildStatus === "building" || buildStatus === "pending"
        ? "progress"
        : buildStatus === "failed"
          ? "danger"
          : "neutral";
  const buildLabel = buildStatus.charAt(0).toUpperCase() + buildStatus.slice(1);
  const statusSummary =
    buildStatus === "running"
      ? "This app is available in the active workspace."
      : buildStatus === "completed"
        ? "The last build completed and the app is ready."
        : buildStatus === "building"
          ? "The app is currently being built."
          : buildStatus === "pending"
            ? "The app is queued and waiting for build work."
            : buildStatus === "failed"
              ? "The latest app build failed and needs attention."
              : buildStatus === "stopped"
              ? "The app exists but is not currently running."
              : "App status has not been reported yet.";
  const canStart = Boolean(selectedWorkspaceId) && !isActing && (buildStatus === "stopped" || buildStatus === "completed" || buildStatus === "failed");
  const canStop = Boolean(selectedWorkspaceId) && !isActing && buildStatus === "running";

  useEffect(() => {
    setActionError("");
    setActionDetail("");
  }, [appId, buildStatus]);

  async function handleLifecycleAction(action: "start" | "stop") {
    if (!selectedWorkspaceId || isActing) {
      return;
    }

    setIsActing(true);
    setActionError("");
    try {
      const response =
        action === "start"
          ? await window.electronAPI.workspace.startInstalledApp(selectedWorkspaceId, appId)
          : await window.electronAPI.workspace.stopInstalledApp(selectedWorkspaceId, appId);
      setActionDetail(response.detail);
      await refreshInstalledApps();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Couldn't ${action} this app.`);
    } finally {
      setIsActing(false);
    }
  }

  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div>
          <div className="flex items-center gap-2 text-neon-green/86">
            <Activity size={16} />
            <span className="text-[11px] uppercase tracking-[0.16em]">App status</span>
          </div>
          <div className="mt-4 text-[28px] font-semibold tracking-[-0.03em] text-text-main">{label}</div>
          <div className="mt-2 max-w-[640px] text-[13px] leading-7 text-text-muted/84">
            This surface currently shows workspace app state instead of a dedicated editor. App-specific editing can land
            later without changing the shell routing.
          </div>

          <div className="mt-6 rounded-[20px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] p-5">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone={buildTone} label={buildLabel} />
              <span className="text-[12px] text-text-muted/84">{statusSummary}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleLifecycleAction("start")}
                disabled={!canStart}
                className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-neon-green/35 bg-neon-green/10 px-4 text-[12px] font-medium text-neon-green transition hover:bg-neon-green/16 disabled:cursor-not-allowed disabled:border-panel-border/35 disabled:bg-black/10 disabled:text-text-dim/70"
              >
                {isActing ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />}
                <span>Start app</span>
              </button>
              <button
                type="button"
                onClick={() => void handleLifecycleAction("stop")}
                disabled={!canStop}
                className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-panel-border/45 px-4 text-[12px] font-medium text-text-muted transition hover:border-rose-400/35 hover:text-text-main disabled:cursor-not-allowed disabled:border-panel-border/35 disabled:bg-black/10 disabled:text-text-dim/70"
              >
                {isActing ? <LoaderCircle size={14} className="animate-spin" /> : <Square size={12} />}
                <span>Stop app</span>
              </button>
              {actionDetail ? <span className="text-[12px] text-text-muted/84">{actionDetail}</span> : null}
            </div>
            {actionError ? (
              <div className="mt-4 rounded-[16px] border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-[12px] leading-6 text-rose-200">
                {actionError}
              </div>
            ) : null}
            {configPath ? (
              <div className="mt-4 flex items-start gap-3 text-[12px] text-text-muted/82">
                <FolderKanban size={15} className="mt-0.5 shrink-0 text-text-dim/70" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-text-dim/74">Config path</div>
                  <div className="mt-1 break-all text-text-main/88">{configPath}</div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <MetadataCard label="Status" value={buildLabel} />
            <MetadataCard label="Surface mode" value={modeLabel} />
            <MetadataCard label="App id" value={appId} />
            <MetadataCard label="Target" value={descriptor} />
            <MetadataCard label="Workspace scope" value="Active workspace" />
          </div>

          <div className="mt-6">
            <div className="text-[10px] uppercase tracking-[0.16em] text-neon-green/76">Lifecycle</div>
            {lifecycle.length > 0 ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {lifecycle.map(([key, value]) => (
                  <MetadataCard key={key} label={humanizeLabel(key)} value={value || "Unavailable"} />
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[18px] border border-panel-border/35 bg-black/10 px-4 py-4 text-[12px] leading-6 text-text-muted/82">
                No lifecycle details have been reported for this app yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ tone, label }: { tone: "success" | "progress" | "danger" | "neutral"; label: string }) {
  const toneClasses =
    tone === "success"
      ? "border-neon-green/35 bg-neon-green/12 text-neon-green"
      : tone === "progress"
        ? "border-sky-400/35 bg-sky-400/12 text-sky-200"
        : tone === "danger"
          ? "border-rose-400/35 bg-rose-400/12 text-rose-200"
          : "border-panel-border/40 bg-black/10 text-text-muted";

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em] ${toneClasses}`}>
      {label}
    </span>
  );
}

function humanizeLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function MetadataCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-4 py-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-dim/76">{label}</div>
      <div className="mt-2 text-[13px] text-text-main">{value}</div>
    </div>
  );
}
