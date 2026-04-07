import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { CronExpressionParser } from "cron-parser";

import {
  type CronjobRecord,
  type RuntimeNotificationLevel,
  type RuntimeNotificationPriority,
  type RuntimeStateStore
} from "@holaboss/runtime-state-store";

import type { QueueWorkerLike } from "./queue-worker.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;

type LoggerLike = {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function titleCaseWords(value: string): string {
  return value.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function cronjobNotificationTitle(job: CronjobRecord, metadata: Record<string, unknown>): string {
  const explicitTitle = normalizedString(metadata.notification_title);
  if (explicitTitle) {
    return explicitTitle;
  }
  const name = normalizedString(job.name);
  if (name) {
    return titleCaseWords(name.replace(/[_-]+/g, " ").replace(/\s+/g, " "));
  }
  return "Reminder";
}

function cronjobNotificationMessage(job: CronjobRecord, metadata: Record<string, unknown>): string {
  const explicitMessage = normalizedString(metadata.notification_message);
  if (explicitMessage) {
    return explicitMessage;
  }
  return normalizedString(job.description) || cronjobNotificationTitle(job, metadata);
}

function cronjobNotificationLevel(metadata: Record<string, unknown>): RuntimeNotificationLevel {
  const explicitLevel = normalizedString(metadata.notification_level || metadata.level).toLowerCase();
  if (explicitLevel === "success" || explicitLevel === "warning" || explicitLevel === "error") {
    return explicitLevel;
  }
  return "info";
}

function cronjobNotificationPriority(metadata: Record<string, unknown>): RuntimeNotificationPriority {
  const explicitPriority = normalizedString(metadata.notification_priority).toLowerCase();
  if (explicitPriority === "low" || explicitPriority === "high" || explicitPriority === "critical") {
    return explicitPriority;
  }
  return "normal";
}

export function cronjobCheckIntervalMs(): number {
  const raw = (process.env.CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS ?? "").trim();
  const parsed = Number.parseInt(raw || "60", 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return Math.max(5, parsed) * 1000;
}

export function cronjobNextRunAt(cronExpression: string, now: Date): string | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, { currentDate: now });
    return interval.next().toISOString();
  } catch {
    return null;
  }
}

export function cronjobIsDue(job: CronjobRecord, now: Date): boolean {
  if (!job.enabled) {
    return false;
  }
  let lastScheduled: Date;
  try {
    lastScheduled = CronExpressionParser.parse(job.cron, { currentDate: now }).prev().toDate();
  } catch {
    return false;
  }
  if (!job.lastRunAt) {
    return true;
  }
  const lastRunAt = new Date(job.lastRunAt);
  if (Number.isNaN(lastRunAt.getTime())) {
    return true;
  }
  return lastRunAt < lastScheduled;
}

export function cronjobInstruction(description: string, metadata: Record<string, unknown>): string {
  const cleanedDescription = description.trim();
  const executionMetadata = Object.fromEntries(
    Object.entries(metadata ?? {}).filter(
      ([key]) => !["model", "session_id", "priority", "idempotency_key"].includes(key)
    )
  );
  if (Object.keys(executionMetadata).length === 0) {
    return cleanedDescription;
  }
  return `${cleanedDescription}\n\n[Cronjob Metadata]\n${JSON.stringify(executionMetadata)}`;
}

export function queueLocalCronjobRun(
  store: RuntimeStateStore,
  job: CronjobRecord,
  now: Date,
  wakeQueueWorker: (() => void) | undefined
): void {
  const workspace = store.getWorkspace(job.workspaceId);
  if (!workspace) {
    throw new Error(`workspace not found for cronjob ${job.id}`);
  }
  const metadata = isRecord(job.metadata) ? job.metadata : {};
  const resolvedSessionId =
    typeof metadata.session_id === "string" && metadata.session_id.trim() ? metadata.session_id.trim() : randomUUID();
  const model = typeof metadata.model === "string" ? metadata.model : null;
  const priority = Number.isInteger(metadata.priority) ? (metadata.priority as number) : 0;
  const idempotencyKey = typeof metadata.idempotency_key === "string" ? metadata.idempotency_key : null;

  store.ensureSession({
    workspaceId: job.workspaceId,
    sessionId: resolvedSessionId,
    kind: "cronjob",
    title: job.name.trim() || job.description.trim() || "Cronjob run",
    createdBy: job.initiatedBy
  });
  if (!store.getBinding({ workspaceId: job.workspaceId, sessionId: resolvedSessionId })) {
    const harness = (workspace.harness ?? process.env.SANDBOX_AGENT_HARNESS ?? "pi").trim() || "pi";
    store.upsertBinding({
      workspaceId: job.workspaceId,
      sessionId: resolvedSessionId,
      harness,
      harnessSessionId: resolvedSessionId
    });
  }

  store.ensureRuntimeState({
    workspaceId: job.workspaceId,
    sessionId: resolvedSessionId,
    status: "QUEUED"
  });

  const instruction = cronjobInstruction(job.description, metadata);
  const record = store.enqueueInput({
    workspaceId: job.workspaceId,
    sessionId: resolvedSessionId,
    priority,
    idempotencyKey,
    payload: {
      text: instruction,
      image_urls: [],
      model,
      context: {
        source: "cronjob",
        cronjob_id: job.id
      }
    }
  });

  store.insertSessionMessage({
    workspaceId: job.workspaceId,
    sessionId: resolvedSessionId,
    role: "user",
    text: instruction,
    messageId: `cronjob-${job.id}-${record.inputId}`
  });

  store.updateRuntimeState({
    workspaceId: job.workspaceId,
    sessionId: resolvedSessionId,
    status: "QUEUED",
    currentInputId: record.inputId,
    currentWorkerId: null,
    leaseUntil: null,
    heartbeatAt: now.toISOString(),
    lastError: null
  });

  wakeQueueWorker?.();
}

export function deliverLocalCronjobNotification(store: RuntimeStateStore, job: CronjobRecord): void {
  const workspace = store.getWorkspace(job.workspaceId);
  if (!workspace) {
    throw new Error(`workspace not found for cronjob ${job.id}`);
  }

  const metadata = isRecord(job.metadata) ? job.metadata : {};
  store.createRuntimeNotification({
    workspaceId: job.workspaceId,
    cronjobId: job.id,
    sourceType: "cronjob",
    sourceLabel: workspace.name.trim() || null,
    title: cronjobNotificationTitle(job, metadata),
    message: cronjobNotificationMessage(job, metadata),
    level: cronjobNotificationLevel(metadata),
    priority: cronjobNotificationPriority(metadata),
    metadata: {
      cronjob_id: job.id,
      cronjob_name: job.name,
      cronjob_description: job.description,
      delivery: job.delivery,
      cronjob_metadata: metadata
    }
  });
}

export interface CronWorkerLike {
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeCronWorkerOptions {
  store: RuntimeStateStore;
  logger?: LoggerLike;
  queueWorker?: QueueWorkerLike | null;
  pollIntervalMs?: number;
}

export class RuntimeCronWorker implements CronWorkerLike {
  readonly #store: RuntimeStateStore;
  readonly #logger: LoggerLike | undefined;
  readonly #queueWorker: QueueWorkerLike | null;
  readonly #pollIntervalMs: number;
  #stopped = false;
  #task: Promise<void> | null = null;
  #wakeResolver: (() => void) | null = null;

  constructor(options: RuntimeCronWorkerOptions) {
    this.#store = options.store;
    this.#logger = options.logger;
    this.#queueWorker = options.queueWorker ?? null;
    this.#pollIntervalMs = options.pollIntervalMs ?? cronjobCheckIntervalMs();
  }

  async start(): Promise<void> {
    if (this.#task) {
      return;
    }
    this.#stopped = false;
    this.#task = this.#runLoop();
  }

  async close(): Promise<void> {
    this.#stopped = true;
    const resolve = this.#wakeResolver;
    this.#wakeResolver = null;
    resolve?.();
    const task = this.#task;
    this.#task = null;
    await task;
  }

  async processDueCronjobsOnce(now = new Date()): Promise<number> {
    let processed = 0;
    for (const job of this.#store.listCronjobs({ enabledOnly: true })) {
      if (!cronjobIsDue(job, now)) {
        continue;
      }
      processed += 1;
      let status = "success";
      let error: string | null = null;
      try {
        const delivery = isRecord(job.delivery) ? job.delivery : {};
        const channel = typeof delivery.channel === "string" ? delivery.channel : null;
        if (channel === "session_run") {
          queueLocalCronjobRun(this.#store, job, now, () => this.#queueWorker?.wake());
        } else if (channel === "system_notification") {
          deliverLocalCronjobNotification(this.#store, job);
          this.#logger?.info?.("Cronjob notification delivered", {
            event: "cronjob.delivery.system_notification",
            outcome: "success",
            cronjob_id: job.id,
            workspace_id: job.workspaceId
          });
        } else {
          throw new Error(`unsupported cronjob delivery channel: ${channel}`);
        }
      } catch (caught) {
        status = "failed";
        error = caught instanceof Error ? caught.message : String(caught);
        this.#logger?.error?.("Cronjob execution failed", {
          event: "cronjob.execution",
          outcome: "error",
          cronjob_id: job.id,
          workspace_id: job.workspaceId,
          error
        });
      }

      this.#store.updateCronjob({
        jobId: job.id,
        lastRunAt: now.toISOString(),
        nextRunAt: cronjobNextRunAt(job.cron, now),
        runCount: job.runCount + (status === "success" ? 1 : 0),
        lastStatus: status,
        lastError: error
      });
    }
    return processed;
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopped) {
      await this.processDueCronjobsOnce();
      if (this.#stopped) {
        return;
      }
      await Promise.race([
        sleep(this.#pollIntervalMs),
        new Promise<void>((resolve) => {
          this.#wakeResolver = resolve;
        })
      ]);
      this.#wakeResolver = null;
    }
  }
}
