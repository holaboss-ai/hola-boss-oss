interface ProactiveLifecyclePanelProps {
  hasWorkspace: boolean;
  workspaceName?: string | null;
  workspaceId?: string | null;
  proactiveStatus: ProactiveAgentStatusPayload | null;
  isLoading: boolean;
  workspaceSetup?: ProactiveStatusSnapshotPayload | null;
  compact?: boolean;
}

function proactiveStateLabel(state: string): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "setting_up":
      return "Setting up";
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
    case "idle":
      return "Idle";
    case "error":
      return "Error";
    default:
      return "Checking";
  }
}

function proactiveStateClasses(state: string): string {
  if (["ready", "healthy", "published", "delivered"].includes(state)) {
    return "border-neon-green/40 bg-neon-green/10 text-neon-green";
  }
  if (["failed", "blocked", "error"].includes(state)) {
    return "border-[rgba(206,92,84,0.32)] bg-[rgba(206,92,84,0.12)] text-[rgba(255,172,164,0.96)]";
  }
  if (["inactive", "skipped", "idle", "no_proposal"].includes(state)) {
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

function analysisSnapshotFromStatus(
  proactiveStatus: ProactiveAgentStatusPayload | null,
  fallbackState: string
): ProactiveStatusSnapshotPayload {
  if (!proactiveStatus) {
    return {
      state: fallbackState,
      detail: null,
      recorded_at: null
    };
  }

  switch (proactiveStatus.delivery_state) {
    case "delivered":
      return {
        state: "delivered",
        detail: `${proactiveStatus.proposal_count} proposal${proactiveStatus.proposal_count === 1 ? "" : "s"} available in this runtime.`,
        recorded_at: null
      };
    case "analyzing":
      return {
        state: "analyzing",
        detail: "Remote proactive analysis is still in progress.",
        recorded_at: proactiveStatus.heartbeat.recorded_at
      };
    case "no_proposal":
      return {
        state: "no_proposal",
        detail: "The latest heartbeat completed without creating a task proposal.",
        recorded_at: proactiveStatus.heartbeat.recorded_at
      };
    case "blocked":
      return {
        state: "blocked",
        detail: proactiveStatus.delivery_detail || "Remote analysis completed, but delivery into this runtime is blocked.",
        recorded_at: null
      };
    case "error":
      return {
        state: "error",
        detail: proactiveStatus.delivery_detail || proactiveStatus.delivery_summary,
        recorded_at: proactiveStatus.heartbeat.recorded_at
      };
    case "inactive":
      return {
        state: "inactive",
        detail: proactiveStatus.delivery_detail || proactiveStatus.delivery_summary,
        recorded_at: proactiveStatus.heartbeat.recorded_at
      };
    default:
      return {
        state: proactiveStatus.delivery_state || fallbackState,
        detail: proactiveStatus.delivery_detail || proactiveStatus.delivery_summary || null,
        recorded_at: proactiveStatus.heartbeat.recorded_at
      };
  }
}

function lifecycleSummary(params: {
  hasWorkspace: boolean;
  workspaceSetup: ProactiveStatusSnapshotPayload;
  proactiveStatus: ProactiveAgentStatusPayload | null;
  isLoading: boolean;
}): { summary: string; detail: string | null } {
  const { hasWorkspace, workspaceSetup, proactiveStatus, isLoading } = params;
  if (!hasWorkspace) {
    return {
      summary: "Select a workspace to inspect proactive delivery status.",
      detail: "Proactive delivery is tracked per workspace, so this follows the workspace currently open in the desktop."
    };
  }
  if ((proactiveStatus?.proposal_count || 0) > 0) {
    return {
      summary: proactiveStatus?.delivery_summary || "Proactive proposals are available in this runtime.",
      detail: proactiveStatus?.delivery_detail || null
    };
  }
  if (workspaceSetup.state === "setting_up") {
    return {
      summary: "Workspace setup is still in progress.",
      detail:
        workspaceSetup.detail ||
        "Proposals can appear once the proactive agent has enough workspace context to analyze."
    };
  }
  if (workspaceSetup.state === "error") {
    return {
      summary: "Workspace setup failed before proactive delivery completed.",
      detail: workspaceSetup.detail
    };
  }
  return {
    summary:
      proactiveStatus?.delivery_summary ||
      (isLoading ? "Checking proactive delivery status..." : "No proactive status available yet."),
    detail: proactiveStatus?.delivery_detail || null
  };
}

function ProactiveStatusRow({
  label,
  snapshot,
  compact = false
}: {
  label: string;
  snapshot: ProactiveStatusSnapshotPayload;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-[14px] border border-panel-border/35 ${compact ? "px-3 py-2.5" : "px-3 py-2"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-text-dim">{label}</div>
        <div className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${proactiveStateClasses(snapshot.state)}`}>
          {proactiveStateLabel(snapshot.state)}
        </div>
      </div>
      {snapshot.detail ? <div className={`mt-2 ${compact ? "text-[10px] leading-5" : "text-[11px] leading-5"} text-text-muted`}>{snapshot.detail}</div> : null}
      {!compact && snapshot.recorded_at ? <div className="mt-2 text-[10px] text-text-dim/78">{formatTimestamp(snapshot.recorded_at)}</div> : null}
    </div>
  );
}

export function ProactiveLifecyclePanel({
  hasWorkspace,
  workspaceName,
  workspaceId,
  proactiveStatus,
  isLoading,
  workspaceSetup,
  compact = false
}: ProactiveLifecyclePanelProps) {
  const fallbackState = isLoading ? "pending" : "unknown";
  const deliveryState = proactiveStatus?.delivery_state || fallbackState;
  const resolvedWorkspaceSetup =
    workspaceSetup ||
    (hasWorkspace
      ? {
          state: fallbackState,
          detail: null,
          recorded_at: null
        }
      : {
          state: "idle",
          detail: null,
          recorded_at: null
        });
  const analysisSnapshot = analysisSnapshotFromStatus(proactiveStatus, fallbackState);
  const { summary, detail } = lifecycleSummary({
    hasWorkspace,
    workspaceSetup: resolvedWorkspaceSetup,
    proactiveStatus,
    isLoading
  });

  return (
    <section
      className={`w-full max-w-none overflow-hidden border border-panel-border/40 text-[11px] text-text-main/88 ${
        compact
          ? "theme-subtle-surface rounded-[20px]"
          : "theme-shell rounded-[24px] shadow-card"
      }`}
    >
      <div className={`${compact ? "px-4 py-4" : "border-b border-panel-border/40 px-4 py-4"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim/68">
              {compact ? "Proactive lifecycle" : "Proactive agent"}
            </div>
            <div className={`${compact ? "mt-2 text-[12px] leading-6" : "mt-2 text-[13px] leading-6"} text-text-main/92`}>
              {summary}
            </div>
            {detail ? <div className="mt-2 text-[11px] leading-5 text-text-muted/82">{detail}</div> : null}
          </div>
          <div className={`shrink-0 rounded-full border px-3 py-1 text-[10px] tracking-[0.14em] ${proactiveStateClasses(deliveryState)}`}>
            {proactiveStateLabel(deliveryState)}
          </div>
        </div>

        {hasWorkspace ? (
          <div className={`flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-text-dim/72 ${compact ? "mt-3" : "mt-4"}`}>
            <span className="rounded-full border border-panel-border/35 px-2.5 py-1">{workspaceName || "Selected workspace"}</span>
            {!compact && workspaceId ? <span className="truncate text-text-dim/58">workspace_id={workspaceId}</span> : null}
          </div>
        ) : null}
      </div>

      {hasWorkspace ? (
        <div className={`grid gap-2 ${compact ? "px-4 pb-4" : "px-4 py-4"}`}>
          <ProactiveStatusRow label="Workspace" snapshot={resolvedWorkspaceSetup} compact={compact} />
          <ProactiveStatusRow
            label="Heartbeat"
            snapshot={
              proactiveStatus?.heartbeat || {
                state: fallbackState,
                detail: null,
                recorded_at: null
              }
            }
            compact={compact}
          />
          <ProactiveStatusRow label="Agent" snapshot={analysisSnapshot} compact={compact} />
          <ProactiveStatusRow
            label="Bridge"
            snapshot={
              proactiveStatus?.bridge || {
                state: fallbackState,
                detail: null,
                recorded_at: null
              }
            }
            compact={compact}
          />
        </div>
      ) : null}
    </section>
  );
}

export function ProactiveStatusCard(props: Omit<ProactiveLifecyclePanelProps, "compact">) {
  return <ProactiveLifecyclePanel {...props} compact={false} />;
}
