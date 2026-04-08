import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  proactiveWorkspaceEnabled?: boolean;
  isLoadingProactiveWorkspaceEnabled?: boolean;
  isUpdatingProactiveWorkspaceEnabled?: boolean;
  proactiveHeartbeatCron?: string;
  isLoadingProactiveHeartbeatConfig?: boolean;
  isUpdatingProactiveHeartbeatConfig?: boolean;
  isTriggeringProposal?: boolean;
  onTriggerProposal?: () => void;
  onProactiveWorkspaceEnabledChange?: (enabled: boolean) => void;
  onProactiveHeartbeatCronChange?: (cron: string) => void;
  compact?: boolean;
}

function proactiveStateLabel(state: string): string {
  switch (state) {
    case "ready":
      return "Idle";
    case "sent":
      return "Sent";
    case "claimed":
      return "Claimed";
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
  if (state === "idle" || state === "ready") {
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

function ProactiveScheduleEditor({
  hasWorkspace,
  proactiveHeartbeatCron = "",
  isLoadingProactiveHeartbeatConfig = false,
  isUpdatingProactiveHeartbeatConfig = false,
  onProactiveHeartbeatCronChange,
}: {
  hasWorkspace: boolean;
  proactiveHeartbeatCron?: string;
  isLoadingProactiveHeartbeatConfig?: boolean;
  isUpdatingProactiveHeartbeatConfig?: boolean;
  onProactiveHeartbeatCronChange?: (cron: string) => void;
}) {
  const [cronDraft, setCronDraft] = useState(proactiveHeartbeatCron);

  useEffect(() => {
    setCronDraft(proactiveHeartbeatCron);
  }, [proactiveHeartbeatCron]);

  const normalizedCurrentCron = proactiveHeartbeatCron.trim();
  const normalizedCronDraft = cronDraft.trim();
  const canSave = Boolean(
    hasWorkspace &&
      onProactiveHeartbeatCronChange &&
      !isLoadingProactiveHeartbeatConfig &&
      !isUpdatingProactiveHeartbeatConfig &&
      normalizedCronDraft &&
      normalizedCronDraft !== normalizedCurrentCron,
  );

  const handleSave = () => {
    if (!canSave || !onProactiveHeartbeatCronChange) {
      return;
    }
    onProactiveHeartbeatCronChange(normalizedCronDraft);
  };

  return (
    <div className="border-t border-border/40 px-3 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Schedule
      </div>
      <div className="mt-1 text-[11px] leading-5 text-muted-foreground/82">
        Server cron for this desktop instance.
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input
          value={cronDraft}
          onChange={(event) => setCronDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            handleSave();
          }}
          placeholder="0 9 * * *"
          disabled={
            !hasWorkspace ||
            isLoadingProactiveHeartbeatConfig ||
            isUpdatingProactiveHeartbeatConfig
          }
          className="h-8 rounded-full bg-background/90 px-3 text-[11px]"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-full px-3 text-[11px] font-medium"
          onClick={handleSave}
          disabled={!canSave}
        >
          {isUpdatingProactiveHeartbeatConfig ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </div>
  );
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
      summary: "Select a workspace to inspect proactive status.",
      detail: null,
    };
  }
  if (proactiveStatus) {
    return {
      state: proactiveStatus.lifecycle_state || "idle",
      summary: proactiveStatus.lifecycle_summary || "Idle.",
      detail: proactiveStatus.lifecycle_detail || null,
    };
  }
  if (isLoading) {
    return {
      state: "checking",
      summary: "Checking proactive status.",
      detail: null,
    };
  }
  return {
    state: "idle",
    summary: "Idle.",
    detail: null,
  };
}

export function ProactiveLifecyclePanel({
  hasWorkspace,
  proactiveStatus,
  isLoading,
  proactiveWorkspaceEnabled = false,
  isLoadingProactiveWorkspaceEnabled = false,
  isUpdatingProactiveWorkspaceEnabled = false,
  proactiveHeartbeatCron = "",
  isLoadingProactiveHeartbeatConfig = false,
  isUpdatingProactiveHeartbeatConfig = false,
  isTriggeringProposal = false,
  onTriggerProposal,
  onProactiveWorkspaceEnabledChange,
  onProactiveHeartbeatCronChange,
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
            {onProactiveWorkspaceEnabledChange ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`h-8 rounded-full px-3 text-[11px] font-medium ${proactiveToggleClasses(
                  proactiveWorkspaceEnabled,
                )}`}
                onClick={() =>
                  !isUpdatingProactiveWorkspaceEnabled &&
                  onProactiveWorkspaceEnabledChange(
                    !proactiveWorkspaceEnabled,
                  )
                }
                disabled={
                  isUpdatingProactiveWorkspaceEnabled ||
                  !hasWorkspace
                }
              >
                {isUpdatingProactiveWorkspaceEnabled ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <span
                    className={`inline-block size-1.5 rounded-full ${
                      proactiveToggleDotClasses(
                        proactiveWorkspaceEnabled,
                      )
                    }`}
                  />
                )}
                <span>
                  {proactiveWorkspaceEnabled ? "Enabled" : "Disabled"}
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
        <ProactiveScheduleEditor
          hasWorkspace={hasWorkspace}
          proactiveHeartbeatCron={proactiveHeartbeatCron}
          isLoadingProactiveHeartbeatConfig={
            isLoadingProactiveHeartbeatConfig
          }
          isUpdatingProactiveHeartbeatConfig={
            isUpdatingProactiveHeartbeatConfig
          }
          onProactiveHeartbeatCronChange={onProactiveHeartbeatCronChange}
        />
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
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div
              className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-medium tracking-[0.14em] ${proactiveStateClasses(
                state,
              )}`}
            >
              {proactiveStateLabel(state)}
            </div>
            <div className="flex items-center gap-1.5">
              {onProactiveWorkspaceEnabledChange ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={`h-8 rounded-full px-3 text-[11px] font-medium ${proactiveToggleClasses(
                    proactiveWorkspaceEnabled,
                  )}`}
                  onClick={() =>
                    !isUpdatingProactiveWorkspaceEnabled &&
                    onProactiveWorkspaceEnabledChange(
                      !proactiveWorkspaceEnabled,
                    )
                  }
                  disabled={
                    isUpdatingProactiveWorkspaceEnabled || !hasWorkspace
                  }
                >
                  {isUpdatingProactiveWorkspaceEnabled ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <span
                      className={`inline-block size-1.5 rounded-full ${proactiveToggleDotClasses(
                        proactiveWorkspaceEnabled,
                      )}`}
                    />
                  )}
                  <span>
                    {proactiveWorkspaceEnabled ? "Enabled" : "Disabled"}
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
        </div>
      </div>
      <ProactiveScheduleEditor
        hasWorkspace={hasWorkspace}
        proactiveHeartbeatCron={proactiveHeartbeatCron}
        isLoadingProactiveHeartbeatConfig={isLoadingProactiveHeartbeatConfig}
        isUpdatingProactiveHeartbeatConfig={
          isUpdatingProactiveHeartbeatConfig
        }
        onProactiveHeartbeatCronChange={onProactiveHeartbeatCronChange}
      />
    </section>
  );
}

export function ProactiveStatusCard(
  props: Omit<ProactiveLifecyclePanelProps, "compact">,
) {
  return <ProactiveLifecyclePanel {...props} compact={false} />;
}
