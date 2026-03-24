import { setTimeout as sleep } from "node:timers/promises";

import { type RuntimeStateStore, type SessionInputRecord } from "@holaboss/runtime-state-store";

import { processClaimedInput } from "./claimed-input-executor.js";

const TS_QUEUE_WORKER_FLAG_ENV = "HOLABOSS_RUNTIME_USE_TS_QUEUE_WORKER";
const DEFAULT_CLAIMED_BY = "sandbox-agent-ts-worker";
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_POLL_INTERVAL_MS = 1000;

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
  executeClaimedInput?: (record: SessionInputRecord) => Promise<void>;
  claimedBy?: string;
  leaseSeconds?: number;
  pollIntervalMs?: number;
}

function envFlagDisabled(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return ["0", "false", "no", "off"].includes(raw);
}

export function tsQueueWorkerEnabled(): boolean {
  if (envFlagDisabled(TS_QUEUE_WORKER_FLAG_ENV)) {
    return false;
  }
  return true;
}

export class RuntimeQueueWorker implements QueueWorkerLike {
  readonly #store: RuntimeStateStore;
  readonly #logger: RuntimeQueueWorkerOptions["logger"];
  readonly #executeClaimedInput: (record: SessionInputRecord) => Promise<void>;
  readonly #claimedBy: string;
  readonly #leaseSeconds: number;
  readonly #pollIntervalMs: number;
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
          claimedBy: this.#claimedBy
        }));
    this.#leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
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
    const claimed = this.#store.claimInputs({
      limit: 1,
      claimedBy: this.#claimedBy,
      leaseSeconds: this.#leaseSeconds
    });
    if (claimed.length === 0) {
      return 0;
    }
    for (const record of claimed) {
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
    }
    return claimed.length;
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
}
