import { ArrowLeft, PencilLine } from "lucide-react";
import { getWorkspaceAppDefinition, type WorkspaceAppDefinition, type WorkspaceInstalledAppDefinition } from "@/lib/workspaceApps";

interface AppSurfacePaneProps {
  appId: string;
  app?: WorkspaceInstalledAppDefinition | WorkspaceAppDefinition | null;
  resourceId?: string | null;
  view?: string | null;
  onReturnToChat: () => void;
}

export function AppSurfacePane({ appId, app: providedApp, resourceId, view, onReturnToChat }: AppSurfacePaneProps) {
  const app = providedApp || getWorkspaceAppDefinition(appId);
  const label = app?.label ?? appId;
  const descriptor = resourceId ? `Resource ${resourceId}` : "Workspace app home";
  const modeLabel = view || (resourceId ? "editor" : "home");
  const buildStatus =
    app && "buildStatus" in app && typeof app.buildStatus === "string" ? app.buildStatus : "unknown";

  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="theme-header-surface flex items-center justify-between gap-3 border-b border-neon-green/15 px-5 py-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-neon-green/76">Workspace app</div>
          <div className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-text-main">{label}</div>
          <div className="mt-1 text-[12px] text-text-muted/78">{app?.summary ?? "App surface"}</div>
        </div>

        <button
          type="button"
          onClick={onReturnToChat}
          className="inline-flex h-10 items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 text-[12px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main"
        >
          <ArrowLeft size={14} />
          <span>Back to Agent</span>
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-[22px] border border-panel-border/35 bg-black/10 p-6">
          <div className="flex items-center gap-2 text-neon-green/86">
            <PencilLine size={16} />
            <span className="text-[11px] uppercase tracking-[0.16em]">Editor surface</span>
          </div>
          <div className="mt-4 text-[28px] font-semibold tracking-[-0.03em] text-text-main">{label}</div>
          <div className="mt-2 max-w-[640px] text-[13px] leading-7 text-text-muted/84">
            This is the workspace-owned app surface. App-routed outputs should open here instead of staying trapped inside
            the drawer. A later pass can replace this host with the actual per-app editor container.
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <MetadataCard label="Surface mode" value={modeLabel} />
            <MetadataCard label="Target" value={descriptor} />
            <MetadataCard label="App id" value={appId} />
            <MetadataCard label="Build status" value={buildStatus} />
            <MetadataCard label="Workspace scope" value="Active workspace" />
          </div>
        </div>

        <div className="rounded-[22px] border border-panel-border/35 bg-black/10 p-5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-neon-green/76">Lifecycle notes</div>
          <div className="mt-3 grid gap-3">
            <StepCard
              status="done"
              title="Resolved through workspace app"
              detail="Outputs rendered by an app should route the user into that app instead of opening a generic output detail."
            />
            <StepCard
              status="current"
              title="Editor host placeholder"
              detail="This pane is intentionally generic so the shell wiring can land before individual app editors do."
            />
            <StepCard
              status="default"
              title="Future app-specific implementation"
              detail="Later this can mount a true LinkedIn, Twitter, or Reddit editing surface using the same center focus contract."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function MetadataCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-4 py-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-dim/76">{label}</div>
      <div className="mt-2 text-[13px] text-text-main">{value}</div>
    </div>
  );
}

function StepCard({
  status,
  title,
  detail,
}: {
  status: "done" | "current" | "default";
  title: string;
  detail: string;
}) {
  const statusClasses =
    status === "done"
      ? "border-neon-green/35 bg-neon-green/10"
      : status === "current"
        ? "border-sky-400/30 bg-sky-400/10"
        : "border-panel-border/35 bg-black/10";
  const dotClasses =
    status === "done"
      ? "bg-neon-green"
      : status === "current"
        ? "bg-sky-300"
        : "bg-text-dim/60";

  return (
    <div className={`rounded-[18px] border px-4 py-4 ${statusClasses}`}>
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${dotClasses}`} />
        <span className="text-[13px] font-medium text-text-main">{title}</span>
      </div>
      <div className="mt-2 text-[12px] leading-6 text-text-muted/84">{detail}</div>
    </div>
  );
}
