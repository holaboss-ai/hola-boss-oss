import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    return "border-warning/30 bg-warning/10 text-warning";
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
  return enabled ? "bg-success" : "bg-warning";
}

type ProactiveScheduleUnit = "minute" | "hour" | "day";

interface ProactiveScheduleDraft {
  interval: number;
  unit: ProactiveScheduleUnit;
  anchorMinute: number;
  anchorHour: number;
  customCronDetected: boolean;
}

function clampScheduleInterval(
  value: number,
  unit: ProactiveScheduleUnit,
): number {
  const max = unit === "minute" ? 59 : unit === "hour" ? 23 : 31;
  return Math.min(Math.max(Math.round(value), 1), max);
}

function parseCronIntegerField(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCronStepField(value: string): number | null {
  if (value === "*") {
    return 1;
  }
  const match = value.match(/^(?:\*|0)\/([1-9]\d*)$/);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function scheduleDraftFromCron(cron: string): ProactiveScheduleDraft {
  const normalized = cron.trim().replace(/\s+/g, " ");
  const fields = normalized.split(" ");
  const fallback: ProactiveScheduleDraft = {
    interval: 1,
    unit: "day",
    anchorMinute: 0,
    anchorHour: 9,
    customCronDetected: normalized.length > 0,
  };

  if (fields.length !== 5) {
    return fallback;
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  if (monthField !== "*" || weekdayField !== "*") {
    return fallback;
  }

  const minuteStep = parseCronStepField(minuteField);
  if (minuteStep !== null && hourField === "*" && dayField === "*") {
    return {
      interval: clampScheduleInterval(minuteStep, "minute"),
      unit: "minute",
      anchorMinute: 0,
      anchorHour: 9,
      customCronDetected: false,
    };
  }

  const minuteValue = parseCronIntegerField(minuteField);
  const hourStep = parseCronStepField(hourField);
  if (minuteValue !== null && hourStep !== null && dayField === "*") {
    return {
      interval: clampScheduleInterval(hourStep, "hour"),
      unit: "hour",
      anchorMinute: Math.min(Math.max(minuteValue, 0), 59),
      anchorHour: 9,
      customCronDetected: false,
    };
  }

  const hourValue = parseCronIntegerField(hourField);
  const dayStep = parseCronStepField(dayField);
  if (minuteValue !== null && hourValue !== null && dayStep !== null) {
    return {
      interval: clampScheduleInterval(dayStep, "day"),
      unit: "day",
      anchorMinute: Math.min(Math.max(minuteValue, 0), 59),
      anchorHour: Math.min(Math.max(hourValue, 0), 23),
      customCronDetected: false,
    };
  }

  return {
    ...fallback,
    anchorMinute:
      minuteValue !== null ? Math.min(Math.max(minuteValue, 0), 59) : 0,
    anchorHour: hourValue !== null ? Math.min(Math.max(hourValue, 0), 23) : 9,
  };
}

function buildCronFromScheduleDraft(draft: ProactiveScheduleDraft): string {
  const interval = clampScheduleInterval(draft.interval, draft.unit);
  if (draft.unit === "minute") {
    return interval === 1 ? "* * * * *" : `*/${interval} * * * *`;
  }
  if (draft.unit === "hour") {
    return interval === 1
      ? `${draft.anchorMinute} * * * *`
      : `${draft.anchorMinute} */${interval} * * *`;
  }
  return interval === 1
    ? `${draft.anchorMinute} ${draft.anchorHour} * * *`
    : `${draft.anchorMinute} ${draft.anchorHour} */${interval} * *`;
}

function scheduleUnitLabel(
  unit: ProactiveScheduleUnit,
  interval: number,
): string {
  if (interval === 1) {
    return unit;
  }
  return `${unit}s`;
}

function scheduleSummaryLabel(draft: ProactiveScheduleDraft): string {
  if (draft.customCronDetected) {
    return "Custom schedule";
  }
  const interval = clampScheduleInterval(draft.interval, draft.unit);
  if (interval === 1) {
    return `Every ${draft.unit}`;
  }
  return `Every ${interval} ${scheduleUnitLabel(draft.unit, interval)}`;
}

function ProactiveScheduleEditor({
  hasWorkspace,
  proactiveHeartbeatCron = "",
  isLoadingProactiveHeartbeatConfig = false,
  isUpdatingProactiveHeartbeatConfig = false,
  onProactiveHeartbeatCronChange,
  compact = false,
}: {
  hasWorkspace: boolean;
  proactiveHeartbeatCron?: string;
  isLoadingProactiveHeartbeatConfig?: boolean;
  isUpdatingProactiveHeartbeatConfig?: boolean;
  onProactiveHeartbeatCronChange?: (cron: string) => void;
  compact?: boolean;
}) {
  const currentSchedule = scheduleDraftFromCron(proactiveHeartbeatCron);
  const [scheduleDraft, setScheduleDraft] = useState(currentSchedule);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setScheduleDraft(scheduleDraftFromCron(proactiveHeartbeatCron));
  }, [proactiveHeartbeatCron]);

  const generatedCron = buildCronFromScheduleDraft(scheduleDraft);
  const canSave = Boolean(
    hasWorkspace &&
    onProactiveHeartbeatCronChange &&
    !isLoadingProactiveHeartbeatConfig &&
    !isUpdatingProactiveHeartbeatConfig &&
    (scheduleDraft.interval !== currentSchedule.interval ||
      scheduleDraft.unit !== currentSchedule.unit) &&
    generatedCron.trim(),
  );

  const handleSave = () => {
    if (!canSave || !onProactiveHeartbeatCronChange) {
      return;
    }
    onProactiveHeartbeatCronChange(generatedCron);
  };

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen((current) => !current)}
        className="w-full justify-between gap-2 text-muted-foreground"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-xs">Schedule</span>
          <span className="text-xs text-muted-foreground/60">
            {scheduleSummaryLabel(currentSchedule)}
          </span>
        </span>
        <ChevronDown
          size={12}
          className={`shrink-0 transition-transform ${
            drawerOpen ? "rotate-180" : ""
          }`}
        />
      </Button>
      {drawerOpen ? (
        <div className="mt-1 flex items-center gap-2 px-2 pb-1">
          <span className="shrink-0 text-xs text-muted-foreground">Every</span>
          <Input
            type="number"
            min={1}
            max={
              scheduleDraft.unit === "minute"
                ? 59
                : scheduleDraft.unit === "hour"
                  ? 23
                  : 31
            }
            step={1}
            value={String(scheduleDraft.interval)}
            onChange={(event) => {
              const nextValue = Number.parseInt(event.target.value, 10);
              setScheduleDraft((current) => ({
                ...current,
                interval: Number.isFinite(nextValue)
                  ? clampScheduleInterval(nextValue, current.unit)
                  : 1,
              }));
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }
              event.preventDefault();
              handleSave();
            }}
            inputMode="numeric"
            disabled={
              !hasWorkspace ||
              isLoadingProactiveHeartbeatConfig ||
              isUpdatingProactiveHeartbeatConfig
            }
            className="h-7 w-14 text-center text-xs"
          />
          <Select
            value={scheduleDraft.unit}
            onValueChange={(value) => {
              if (!value) {
                return;
              }
              const nextUnit = value as ProactiveScheduleUnit;
              setScheduleDraft((current) => ({
                ...current,
                unit: nextUnit,
                interval: clampScheduleInterval(
                  current.interval,
                  nextUnit,
                ),
              }));
            }}
            disabled={
              !hasWorkspace ||
              isLoadingProactiveHeartbeatConfig ||
              isUpdatingProactiveHeartbeatConfig
            }
          >
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minute">
                {scheduleUnitLabel("minute", scheduleDraft.interval)}
              </SelectItem>
              <SelectItem value="hour">
                {scheduleUnitLabel("hour", scheduleDraft.interval)}
              </SelectItem>
              <SelectItem value="day">
                {scheduleUnitLabel("day", scheduleDraft.interval)}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="xs"
            onClick={handleSave}
            disabled={!canSave}
          >
            {isUpdatingProactiveHeartbeatConfig ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </div>
      ) : null}
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
      <section className="w-full space-y-1">
        {/* Status + Toggle row */}
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className={proactiveStateClasses(state)}>
            {proactiveStateLabel(state)}
          </Badge>
          <div className="flex shrink-0 items-center gap-1.5">
            {onProactiveWorkspaceEnabledChange ? (
              isUpdatingProactiveWorkspaceEnabled ? (
                <Loader2
                  size={12}
                  className="animate-spin text-muted-foreground"
                />
              ) : (
                <Switch
                  checked={proactiveWorkspaceEnabled}
                  onCheckedChange={(checked) =>
                    onProactiveWorkspaceEnabledChange(checked)
                  }
                  disabled={
                    isUpdatingProactiveWorkspaceEnabled || !hasWorkspace
                  }
                />
              )
            ) : null}
            {onTriggerProposal ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Run analysis"
                      onClick={onTriggerProposal}
                      disabled={!hasWorkspace || isTriggeringProposal}
                      className="text-muted-foreground hover:text-primary"
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

        {/* Schedule editor (inline, no wrapping card) */}
        <ProactiveScheduleEditor
          hasWorkspace={hasWorkspace}
          proactiveHeartbeatCron={proactiveHeartbeatCron}
          isLoadingProactiveHeartbeatConfig={isLoadingProactiveHeartbeatConfig}
          isUpdatingProactiveHeartbeatConfig={
            isUpdatingProactiveHeartbeatConfig
          }
          onProactiveHeartbeatCronChange={onProactiveHeartbeatCronChange}
          compact
        />
      </section>
    );
  }

  return (
    <section className="w-full overflow-hidden rounded-xl border border-border/40 bg-card shadow-sm">
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
            <Badge
              variant="outline"
              className={`border-transparent text-[10px] tracking-[0.14em] ${proactiveStateClasses(
                state,
              )}`}
            >
              {proactiveStateLabel(state)}
            </Badge>
            <div className="flex items-center gap-1.5">
              {onProactiveWorkspaceEnabledChange ? (
                isUpdatingProactiveWorkspaceEnabled ? (
                  <Loader2
                    size={12}
                    className="animate-spin text-muted-foreground"
                  />
                ) : (
                  <Switch
                    checked={proactiveWorkspaceEnabled}
                    onCheckedChange={(checked) =>
                      onProactiveWorkspaceEnabledChange(checked)
                    }
                    disabled={
                      isUpdatingProactiveWorkspaceEnabled || !hasWorkspace
                    }
                  />
                )
              ) : null}
              {onTriggerProposal ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label="Run proactive analysis"
                        onClick={onTriggerProposal}
                        disabled={!hasWorkspace || isTriggeringProposal}
                        className="border-primary/30 bg-primary/8 text-primary hover:bg-primary/14"
                      />
                    }
                  >
                    {isTriggeringProposal ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Sparkles size={13} />
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
        isUpdatingProactiveHeartbeatConfig={isUpdatingProactiveHeartbeatConfig}
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
