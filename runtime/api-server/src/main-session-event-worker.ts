import { setTimeout as sleep } from "node:timers/promises";

import {
  type MainSessionEventQueueRecord,
  type RuntimeStateStore,
  utcNowIso,
} from "@holaboss/runtime-state-store";

import type { QueueWorkerLike } from "./queue-worker.js";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MAIN_SESSION_EVENT_INPUT_PRIORITY = -100;
const MAIN_SESSION_EVENT_BATCH_HEADER =
  "[Holaboss Main Session Event Batch v1]";

type LoggerLike = {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

export interface MainSessionEventWorkerLike {
  start(): Promise<void>;
  wake(): void;
  close(): Promise<void>;
}

export interface RuntimeMainSessionEventWorkerOptions {
  store: RuntimeStateStore;
  queueWorker?: QueueWorkerLike | null;
  logger?: LoggerLike;
  pollIntervalMs?: number;
  initialDelayMs?: number;
}

const DEFAULT_INITIAL_DELAY_MS = 1_000;

function groupedEventPayload(events: MainSessionEventQueueRecord[]) {
  return events.map((event) => ({
    event_id: event.eventId,
    event_type: event.eventType,
    delivery_bucket: event.deliveryBucket,
    status: event.status,
    subagent_id: event.subagentId,
    payload: event.payload,
    created_at: event.createdAt,
  }));
}

function buildMainSessionEventBatchInstruction(
  events: MainSessionEventQueueRecord[],
): string {
  const deliveryBucket = events[0]?.deliveryBucket ?? "background_update";
  const lines = [
    MAIN_SESSION_EVENT_BATCH_HEADER,
    "You are the workspace's main session.",
    "Write exactly one assistant reply to the user in your normal conversational voice based on the queued background task events below.",
    "Do not mention internal event ids, queueing, hidden workers, or implementation details.",
  ];
  if (deliveryBucket === "waiting_on_user") {
    lines.push(
      "These events are blocked on user input. Ask only what is needed to unblock the work, and separate the questions clearly with numbered items.",
    );
  } else {
    lines.push(
      "These events are background updates. Summarize them naturally, mention useful deliverables when relevant, and keep the reply concise.",
    );
  }
  lines.push("");
  lines.push("[Queued Background Events]");
  lines.push(JSON.stringify(groupedEventPayload(events), null, 2));
  return lines.join("\n").trim();
}

function isMainSessionNaturallyPaused(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  sessionId: string;
}): boolean {
  const runtimeState = params.store.getRuntimeState({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
  });
  const runtimeStatus = (runtimeState?.status ?? "").trim().toUpperCase();
  if (
    runtimeStatus === "BUSY" ||
    runtimeStatus === "QUEUED" ||
    runtimeStatus === "WAITING_USER" ||
    runtimeStatus === "PAUSED"
  ) {
    return false;
  }
  return !params.store.hasAvailableInputsForSession({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
  });
}

function materializableBatchForOwner(
  events: MainSessionEventQueueRecord[],
): MainSessionEventQueueRecord[] {
  const waiting = events.filter(
    (event) => event.deliveryBucket === "waiting_on_user",
  );
  if (waiting.length > 0) {
    return waiting;
  }
  return events.filter((event) => event.deliveryBucket === "background_update");
}

export class RuntimeMainSessionEventWorker
  implements MainSessionEventWorkerLike
{
  readonly #store: RuntimeStateStore;
  readonly #queueWorker: QueueWorkerLike | null;
  readonly #logger: LoggerLike | undefined;
  readonly #pollIntervalMs: number;
  readonly #initialDelayMs: number;
  #stopped = false;
  #task: Promise<void> | null = null;
  #wakeResolver: (() => void) | null = null;
  #hasWaitedInitialDelay = false;

  constructor(options: RuntimeMainSessionEventWorkerOptions) {
    this.#store = options.store;
    this.#queueWorker = options.queueWorker ?? null;
    this.#logger = options.logger;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  }

  async start(): Promise<void> {
    if (this.#task) {
      return;
    }
    this.#stopped = false;
    this.#task = this.#runLoop();
  }

  wake(): void {
    const resolve = this.#wakeResolver;
    this.#wakeResolver = null;
    resolve?.();
  }

  async close(): Promise<void> {
    this.#stopped = true;
    this.wake();
    const task = this.#task;
    this.#task = null;
    await task;
  }

  async processAvailableEventsOnce(): Promise<number> {
    const now = utcNowIso();
    let materialized = 0;

    for (const workspace of this.#store.listWorkspaces()) {
      const dueEvents = this.#store.listPendingMainSessionEventsByWorkspace({
        workspaceId: workspace.id,
        before: now,
        limit: 500,
      });
      if (dueEvents.length === 0) {
        continue;
      }

      const byOwner = new Map<string, MainSessionEventQueueRecord[]>();
      for (const event of dueEvents) {
        const existing = byOwner.get(event.ownerMainSessionId) ?? [];
        existing.push(event);
        byOwner.set(event.ownerMainSessionId, existing);
      }

      for (const [ownerMainSessionId, events] of byOwner.entries()) {
        if (
          !isMainSessionNaturallyPaused({
            store: this.#store,
            workspaceId: workspace.id,
            sessionId: ownerMainSessionId,
          })
        ) {
          continue;
        }

        const batch = materializableBatchForOwner(events);
        if (batch.length === 0) {
          continue;
        }
        const eventIds = batch.map((event) => event.eventId);
        const input = this.#store.enqueueInput({
          workspaceId: workspace.id,
          sessionId: ownerMainSessionId,
          priority: MAIN_SESSION_EVENT_INPUT_PRIORITY,
          idempotencyKey: `main-session-event-batch:${eventIds.join(",")}`,
          payload: {
            text: buildMainSessionEventBatchInstruction(batch),
            attachments: [],
            image_urls: [],
            context: {
              source: "main_session_event_batch",
              owner_main_session_id: ownerMainSessionId,
              origin_main_session_ids: [
                ...new Set(batch.map((event) => event.originMainSessionId)),
              ],
              delivery_bucket: batch[0]?.deliveryBucket ?? "background_update",
              main_session_event_ids: eventIds,
              subagent_ids: [
                ...new Set(
                  batch
                    .map((event) => event.subagentId)
                    .filter((value): value is string => Boolean(value)),
                ),
              ],
              queued_events: groupedEventPayload(batch),
              generated_at: now,
            },
          },
        });
        this.#store.markMainSessionEventsMaterialized({
          eventIds,
          materializedInputId: input.inputId,
        });
        materialized += batch.length;
        this.#queueWorker?.wake();
      }
    }

    return materialized;
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopped) {
      if (!this.#hasWaitedInitialDelay && this.#initialDelayMs > 0) {
        this.#hasWaitedInitialDelay = true;
        await this.#waitForWakeOrTimeout(this.#initialDelayMs);
        if (this.#stopped) {
          return;
        }
      }
      try {
        const processed = await this.processAvailableEventsOnce();
        if (processed > 0) {
          continue;
        }
      } catch (error) {
        this.#logger?.error(
          "main-session-event-worker iteration failed",
          error,
        );
      }
      await this.#waitForWakeOrTimeout();
    }
  }

  async #waitForWakeOrTimeout(timeoutMs = this.#pollIntervalMs): Promise<void> {
    await Promise.race([
      sleep(timeoutMs),
      new Promise<void>((resolve) => {
        this.#wakeResolver = resolve;
      }),
    ]);
    this.#wakeResolver = null;
  }
}
