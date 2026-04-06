import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ProactiveLifecyclePanelProps {
  hasWorkspace: boolean;
  workspaceName?: string | null;
  workspaceId?: string | null;
  proactiveStatus: ProactiveAgentStatusPayload | null;
  isLoading: boolean;
  workspaceSetup?: ProactiveStatusSnapshotPayload | null;
  proactiveTaskProposalsEnabled?: boolean;
  isUpdatingProactiveTaskProposalsEnabled?: boolean;
  isTriggeringProposal?: boolean;
  onTriggerProposal?: () => void;
  onProactiveTaskProposalsEnabledChange?: (enabled: boolean) => void;
  compact?: boolean;
}

function proactiveStateLabel(state: string): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "sent":
      return "Sent";
    case "claimed":
      return "Picked Up";
    case "analyzing":
      return "Analyzing";
    case "idle":
      return "Idle";
    case "unavailable":
      return "Unavailable";
    case "error":
      return "Error";
    default:
      return "Checking";
  }
}

function proactiveStateClasses(state: string): string {
  if (state === "ready") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (state === "sent") {
    return "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
  if (state === "claimed") {
    return "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
  }
  if (state === "analyzing") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (state === "error" || state === "unavailable") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (state === "idle") {
    return "border-border/45 bg-background/70 text-muted-foreground";
  }
  return "border-border/45 bg-background/70 text-foreground/72";
}

function proactiveToggleClasses(enabled: boolean): string {
  return enabled
    ? "border-border/45 bg-background/90 text-foreground/88 hover:border-primary/35 hover:text-foreground"
    : "border-border/45 bg-background/90 text-muted-foreground hover:border-primary/35 hover:text-foreground";
}

function proactiveToggleDotClasses(enabled: boolean): string {
  return enabled ? "bg-emerald-500" : "bg-amber-500";
}

function lifecycleCopy(params: {
  hasWorkspace: boolean;
  proactiveStatus: ProactiveAgentStatusPayload | null;
  isLoading: boolean;
}): { state: string; summary: string; detail: string | null } {
  const { hasWorkspace, proactiveStatus, isLoading } = params;
  if (!hasWorkspace) {
    return {
      state: "idle",
      summary: "Select a workspace to view suggestions.",
      detail: null,
    };
  }
  if (proactiveStatus) {
    return {
      state: proactiveStatus.delivery_state || "idle",
      summary: proactiveStatus.delivery_summary || "No suggestions right now.",
      detail: proactiveStatus.delivery_detail || null,
    };
  }
  if (isLoading) {
    return {
      state: "checking",
      summary: "Checking suggestion status.",
      detail: null,
    };
  }
  return {
    state: "idle",
    summary: "No suggestions right now.",
    detail: null,
  };
}

export function ProactiveLifecyclePanel({
  hasWorkspace,
  proactiveStatus,
  isLoading,
  proactiveTaskProposalsEnabled = true,
  isUpdatingProactiveTaskProposalsEnabled = false,
  isTriggeringProposal = false,
  onTriggerProposal,
  onProactiveTaskProposalsEnabledChange,
  compact = false,
}: ProactiveLifecyclePanelProps) {
  const { state, summary, detail } = lifecycleCopy({
    hasWorkspace,
    proactiveStatus,
    isLoading,
  });

  if (compact) {
    return (
      <section className="w-full overflow-hidden rounded-[20px] border border-border/40 bg-card">
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <div
            className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-medium tracking-[0.14em] ${proactiveStateClasses(
              state,
            )}`}
          >
            {proactiveStateLabel(state)}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {onProactiveTaskProposalsEnabledChange ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`h-8 rounded-full px-3 text-[11px] font-medium ${proactiveToggleClasses(
                  proactiveTaskProposalsEnabled,
                )}`}
                onClick={() =>
                  !isUpdatingProactiveTaskProposalsEnabled &&
                  onProactiveTaskProposalsEnabledChange(
                    !proactiveTaskProposalsEnabled,
                  )
                }
                disabled={isUpdatingProactiveTaskProposalsEnabled}
              >
                {isUpdatingProactiveTaskProposalsEnabled ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <span
                    className={`inline-block size-1.5 rounded-full ${
                      proactiveToggleDotClasses(
                        proactiveTaskProposalsEnabled,
                      )
                    }`}
                  />
                )}
                <span>
                  {proactiveTaskProposalsEnabled ? "Enabled" : "Paused"}
                </span>
              </Button>
            ) : null}
            {onTriggerProposal ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="outline"
                      aria-label="Run proactive analysis"
                      onClick={onTriggerProposal}
                      disabled={!hasWorkspace || isTriggeringProposal}
                      className="rounded-full border-border/45 bg-background/90 text-muted-foreground hover:border-primary/35 hover:bg-background hover:text-primary"
                    />
                  }
                >
                  {isTriggeringProposal ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Sparkles size={12} />
                  )}
                </TooltipTrigger>
                <TooltipContent side="bottom">Run analysis</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full overflow-hidden rounded-[20px] border border-border/40 bg-card shadow-sm">
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] leading-6 text-foreground/90">
              {summary}
            </div>
            {detail ? (
              <div className="mt-1.5 text-[11px] leading-5 text-muted-foreground/88">
                {detail}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div
              className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-medium tracking-[0.14em] ${proactiveStateClasses(
                state,
              )}`}
            >
              {proactiveStateLabel(state)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProactiveStatusCard(
  props: Omit<ProactiveLifecyclePanelProps, "compact">,
) {
  return <ProactiveLifecyclePanel {...props} compact={false} />;
}
