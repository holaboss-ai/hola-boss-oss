import type { RuntimeStateStore, SessionInputRecord, TurnResultRecord } from "@holaboss/runtime-state-store";

import type { MemoryServiceLike } from "./memory.js";
import { enqueueDurableMemoryWritebackJob } from "./post-run-durable-memory.js";
import { writeTurnContinuity, type TurnMemoryWritebackModelContext } from "./turn-memory-writeback.js";

export interface PostRunTaskContext {
  store: RuntimeStateStore;
  record: SessionInputRecord;
  turnResult: TurnResultRecord;
  memoryService?: MemoryServiceLike | null;
  modelContext?: TurnMemoryWritebackModelContext | null;
  wakeDurableMemoryWorker?: (() => void) | null;
  enqueueDurableMemoryWritebackJobFn?: typeof enqueueDurableMemoryWritebackJob;
  writeTurnContinuityFn?: typeof writeTurnContinuity;
}

export interface PostRunTask {
  name: string;
  shouldRun: (context: PostRunTaskContext) => boolean;
  run: (context: PostRunTaskContext) => Promise<void>;
}

export interface SchedulePostRunTasksOptions extends PostRunTaskContext {
  tasks?: PostRunTask[];
  scheduleFn?: (callback: () => void) => void;
  onTaskError?: (taskName: string, error: unknown) => void;
}

export const turnMemoryWritebackPostRunTask: PostRunTask = {
  name: "turn_memory_writeback",
  shouldRun: (context) => Boolean(context.memoryService),
  run: async (context) => {
    if (!context.memoryService) {
      return;
    }
    const updatedTurnResult = await (context.writeTurnContinuityFn ?? writeTurnContinuity)({
      store: context.store,
      memoryService: context.memoryService,
      turnResult: context.turnResult,
    });
    (context.enqueueDurableMemoryWritebackJobFn ?? enqueueDurableMemoryWritebackJob)({
      store: context.store,
      workspaceId: updatedTurnResult.workspaceId,
      sessionId: updatedTurnResult.sessionId,
      inputId: updatedTurnResult.inputId,
      instruction: context.modelContext?.instruction ?? null,
      wakeWorker: context.wakeDurableMemoryWorker ?? null,
    });
  },
};

const DEFAULT_POST_RUN_TASKS: PostRunTask[] = [turnMemoryWritebackPostRunTask];

export async function runPostRunTasks(options: SchedulePostRunTasksOptions): Promise<void> {
  const tasks = options.tasks ?? DEFAULT_POST_RUN_TASKS;
  for (const task of tasks) {
    if (!task.shouldRun(options)) {
      continue;
    }
    try {
      await task.run(options);
    } catch (error) {
      options.onTaskError?.(task.name, error);
    }
  }
}

export function schedulePostRunTasks(options: SchedulePostRunTasksOptions): void {
  const scheduleFn = options.scheduleFn ?? ((callback: () => void) => setImmediate(callback));
  scheduleFn(() => {
    void runPostRunTasks(options);
  });
}
