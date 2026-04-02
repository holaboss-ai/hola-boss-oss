import { setTimeout as sleep } from "node:timers/promises";

import { type RuntimeStateStore, type SessionInputRecord } from "@holaboss/runtime-state-store";

import { processClaimedInput } from "./claimed-input-executor.js";
import type { MemoryServiceLike } from "./memory.js";
import { buildRunFailedEvent } from "./runner-worker.js";

const DEFAULT_CLAIMED_BY = "sandbox-agent-ts-worker";
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_CONCURRENCY = 2;
const TERMINAL_EVENT_TYPES = new Set(["run_completed", "run_failed"]);

export interface QueueWorkerLike {
  start(): Promise<void>;
  wake(): void;
  close(): Promise<void>;
}

export interface RuntimeQueueWorkerOptions {
  store: RuntimeStateStore;
  logger?: {
    info: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  memoryService?: MemoryServiceLike | null;
  executeClaimedInput?: (record: SessionInputRecord) => Promise<void>;
  claimedBy?: string;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  maxConcurrency?: number;
}

function queueWorkerMaxConcurrency(): number {
  const raw = (process.env.HB_QUEUE_WORKER_CONCURRENCY ?? "").trim();
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_MAX_CONCURRENCY;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_CONCURRENCY;
  }
  return Math.max(1, parsed);
}

export class RuntimeQueueWorker implements QueueWorkerLike {
  readonly #store: RuntimeStateStore;
  readonly #logger: RuntimeQueueWorkerOptions["logger"];
  readonly #executeClaimedInput: (record: SessionInputRecord) => Promise<void>;
  readonly #claimedBy: string;
  readonly #leaseSeconds: number;
  readonly #pollIntervalMs: number;
  readonly #maxConcurrency: number;
  #stopped = false;
  #task: Promise<void> | null = null;
  #wakeResolver: (() => void) | null = null;

  constructor(options: RuntimeQueueWorkerOptions) {
    this.#store = options.store;
    this.#logger = options.logger;
    this.#claimedBy = options.claimedBy ?? DEFAULT_CLAIMED_BY;
    this.#executeClaimedInput =
      options.executeClaimedInput ??
      ((record) =>
        processClaimedInput({
          store: this.#store,
          record,
          claimedBy: this.#claimedBy,
          memoryService: options.memoryService ?? null,
        }));
    this.#leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#maxConcurrency = options.maxConcurrency ?? queueWorkerMaxConcurrency();
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

  async processAvailableInputsOnce(): Promise<number> {
    const recovered = this.#recoverExpiredClaims();
    const claimed = this.#store.claimInputs({
      limit: this.#maxConcurrency,
      claimedBy: this.#claimedBy,
      leaseSeconds: this.#leaseSeconds,
      distinctSessions: true
    });
    if (claimed.length === 0) {
      return recovered;
    }
    await Promise.all(
      claimed.map(async (record) => {
        try {
          await this.#executeClaimedInput(record);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.#logger?.error?.("TS queue worker failed to process claimed input", {
            inputId: record.inputId,
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
            error: message
          });
          this.#store.updateInput(record.inputId, {
            status: "FAILED",
            claimedBy: null,
            claimedUntil: null
          });
          this.#store.updateRuntimeState({
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
            status: "ERROR",
            currentInputId: null,
            currentWorkerId: null,
            leaseUntil: null,
            heartbeatAt: null,
            lastError: { message }
          });
        }
      })
    );
    return recovered + claimed.length;
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopped) {
      const processed = await this.processAvailableInputsOnce();
      if (processed > 0) {
        continue;
      }
      await this.#waitForWakeOrTimeout();
    }
  }

  async #waitForWakeOrTimeout(): Promise<void> {
    await Promise.race([
      sleep(this.#pollIntervalMs),
      new Promise<void>((resolve) => {
        this.#wakeResolver = resolve;
      })
    ]);
    this.#wakeResolver = null;
  }

  #recoverExpiredClaims(): number {
    const expired = this.#store.listExpiredClaimedInputs();
    for (const record of expired) {
      const events = this.#store.listOutputEvents({
        sessionId: record.sessionId,
        inputId: record.inputId
      });
      const hasTerminal = events.some((event) => TERMINAL_EVENT_TYPES.has(event.eventType));
      if (!hasTerminal) {
        const failure = buildRunFailedEvent({
          sessionId: record.sessionId,
          inputId: record.inputId,
          sequence: Math.max(0, ...events.map((event) => event.sequence)) + 1,
          message: "claimed input lease expired before the runner emitted a terminal event",
          errorType: "RuntimeError"
        });
        this.#store.appendOutputEvent({
          workspaceId: record.workspaceId,
          sessionId: record.sessionId,
          inputId: record.inputId,
          sequence: typeof failure.sequence === "number" ? failure.sequence : events.length + 1,
          eventType: String(failure.event_type),
          payload: failure.payload as Record<string, unknown>
        });
      }

      this.#store.updateInput(record.inputId, {
        status: "FAILED",
        claimedBy: null,
        claimedUntil: null
      });

      const runtimeState = this.#store.getRuntimeState({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId
      });
      if (runtimeState?.currentInputId === record.inputId) {
        this.#store.updateRuntimeState({
          workspaceId: record.workspaceId,
          sessionId: record.sessionId,
          status: "ERROR",
          currentInputId: null,
          currentWorkerId: null,
          leaseUntil: null,
          heartbeatAt: null,
          lastError: { message: "claimed input lease expired before the runner emitted a terminal event" }
        });
      }
    }
    if (expired.length > 0) {
      this.#logger?.error?.("Recovered expired claimed runtime inputs", {
        count: expired.length,
        inputIds: expired.map((record) => record.inputId)
      });
    }
    return expired.length;
  }
}
