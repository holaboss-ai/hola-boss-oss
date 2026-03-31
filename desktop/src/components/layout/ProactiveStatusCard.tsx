function proactiveStateLabel(state: string): string {
  switch (state) {
    case "healthy":
      return "Healthy";
    case "published":
      return "Published";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "pending":
      return "Pending";
    case "delivered":
      return "Delivered";
    case "analyzing":
      return "Analyzing";
    case "no_proposal":
      return "No proposal";
    case "blocked":
      return "Blocked";
    case "inactive":
      return "Inactive";
    case "error":
      return "Error";
    default:
      return "Checking";
  }
}

function proactiveStateClasses(state: string): string {
  if (["healthy", "published", "delivered"].includes(state)) {
    return "border-neon-green/40 bg-neon-green/10 text-neon-green";
  }
  if (["failed", "blocked", "error"].includes(state)) {
    return "border-[rgba(206,92,84,0.32)] bg-[rgba(206,92,84,0.12)] text-[rgba(255,172,164,0.96)]";
  }
  if (["inactive", "skipped"].includes(state)) {
    return "border-panel-border/45 bg-panel-border/10 text-text-muted";
  }
  return "border-panel-border/45 bg-panel-border/10 text-text-main/78";
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString();
}

function ProactiveStatusRow({
  label,
  snapshot
}: {
  label: string;
  snapshot: ProactiveStatusSnapshotPayload;
}) {
  return (
    <div className="rounded-[14px] border border-panel-border/35 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-text-dim">{label}</div>
        <div className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${proactiveStateClasses(snapshot.state)}`}>
          {proactiveStateLabel(snapshot.state)}
        </div>
      </div>
      {snapshot.detail ? <div className="mt-2 text-[11px] leading-5 text-text-muted">{snapshot.detail}</div> : null}
      {snapshot.recorded_at ? <div className="mt-2 text-[10px] text-text-dim/78">{formatTimestamp(snapshot.recorded_at)}</div> : null}
    </div>
  );
}

interface ProactiveStatusCardProps {
  hasWorkspace: boolean;
  workspaceName?: string | null;
  workspaceId?: string | null;
  proactiveStatus: ProactiveAgentStatusPayload | null;
  isLoading: boolean;
}

export function ProactiveStatusCard({
  hasWorkspace,
  workspaceName,
  workspaceId,
  proactiveStatus,
  isLoading
}: ProactiveStatusCardProps) {
  const fallbackState = isLoading ? "pending" : "unknown";
  const deliveryState = proactiveStatus?.delivery_state || fallbackState;
  const summary = hasWorkspace
    ? proactiveStatus?.delivery_summary || (isLoading ? "Checking proactive delivery status..." : "No proactive status available yet.")
    : "Select a workspace to inspect proactive delivery status.";
  const detail = hasWorkspace
    ? proactiveStatus?.delivery_detail
    : "Proactive delivery is tracked per workspace, so this follows the workspace currently open in the desktop.";

  return (
    <section className="theme-shell w-full max-w-none overflow-hidden rounded-[24px] border border-panel-border/40 text-[11px] text-text-main/88 shadow-card">
      <div className="border-b border-panel-border/40 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim/68">Proactive agent</div>
            <div className="mt-2 text-[13px] leading-6 text-text-main/92">{summary}</div>
            {detail ? <div className="mt-2 text-[11px] leading-5 text-text-muted/82">{detail}</div> : null}
          </div>
          <div className={`shrink-0 rounded-full border px-3 py-1 text-[10px] tracking-[0.14em] ${proactiveStateClasses(deliveryState)}`}>
            {proactiveStateLabel(deliveryState)}
          </div>
        </div>

        {hasWorkspace ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">
            <span className="rounded-full border border-panel-border/35 px-2.5 py-1">{workspaceName || "Selected workspace"}</span>
            {workspaceId ? <span className="truncate text-text-dim/58">workspace_id={workspaceId}</span> : null}
          </div>
        ) : null}
      </div>

      {hasWorkspace ? (
        <div className="grid gap-2 px-4 py-4">
          <ProactiveStatusRow
            label="Heartbeat"
            snapshot={
              proactiveStatus?.heartbeat || {
                state: fallbackState,
                detail: null,
                recorded_at: null
              }
            }
          />
          <ProactiveStatusRow
            label="Bridge"
            snapshot={
              proactiveStatus?.bridge || {
                state: fallbackState,
                detail: null,
                recorded_at: null
              }
            }
          />
        </div>
      ) : null}
    </section>
  );
}
