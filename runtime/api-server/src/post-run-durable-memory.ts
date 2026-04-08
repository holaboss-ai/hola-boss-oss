import type { PostRunJobRecord, RuntimeStateStore } from "@holaboss/runtime-state-store";

import { createBackgroundTaskMemoryModelClient } from "./background-task-model.js";
import type { MemoryServiceLike } from "./memory.js";
import { writeTurnDurableMemory, type TurnMemoryWritebackModelContext } from "./turn-memory-writeback.js";

export const DURABLE_MEMORY_WRITEBACK_JOB_TYPE = "durable_memory_writeback";

interface DurableMemoryWritebackJobPayload {
  instruction?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function trimmedInstruction(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function durableMemoryModelContext(params: {
  workspaceId: string;
  sessionId: string;
  inputId: string;
  instruction?: string | null;
}): TurnMemoryWritebackModelContext | null {
  const modelClient = createBackgroundTaskMemoryModelClient({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    inputId: params.inputId,
  });
  if (!modelClient && !trimmedInstruction(params.instruction)) {
    return null;
  }
  return {
    modelClient,
    instruction: trimmedInstruction(params.instruction),
  };
}

export function enqueueDurableMemoryWritebackJob(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  instruction?: string | null;
  wakeWorker?: (() => void) | null;
}): PostRunJobRecord {
  const record = params.store.enqueuePostRunJob({
    jobType: DURABLE_MEMORY_WRITEBACK_JOB_TYPE,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    inputId: params.inputId,
    payload: {
      instruction: trimmedInstruction(params.instruction),
    },
    idempotencyKey: `${DURABLE_MEMORY_WRITEBACK_JOB_TYPE}:${params.inputId}`,
  });
  params.wakeWorker?.();
  return record;
}

export async function processDurableMemoryWritebackJob(params: {
  store: RuntimeStateStore;
  record: PostRunJobRecord;
  memoryService: MemoryServiceLike;
}): Promise<void> {
  if (params.record.jobType !== DURABLE_MEMORY_WRITEBACK_JOB_TYPE) {
    throw new Error(`unsupported durable memory job type: ${params.record.jobType}`);
  }
  const turnResult = params.store.getTurnResult({ inputId: params.record.inputId });
  if (!turnResult) {
    throw new Error(`turn result not found for durable memory job input ${params.record.inputId}`);
  }
  const payload = asRecord(params.record.payload);
  const modelContext = durableMemoryModelContext({
    workspaceId: turnResult.workspaceId,
    sessionId: turnResult.sessionId,
    inputId: turnResult.inputId,
    instruction: trimmedInstruction(payload.instruction),
  });
  await writeTurnDurableMemory({
    store: params.store,
    memoryService: params.memoryService,
    turnResult,
    modelContext,
  });
}
