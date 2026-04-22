import type { RuntimeStateStore, SessionInputRecord, TurnResultRecord } from "@holaboss/runtime-state-store";

import type { MemoryServiceLike } from "./memory.js";
import { enqueueEvolveJob } from "./evolve.js";
import type { TurnMemoryWritebackModelContext } from "./turn-memory-writeback.js";

export interface EvolveTaskContext {
  store: RuntimeStateStore;
  record: SessionInputRecord;
  turnResult: TurnResultRecord;
  memoryService?: MemoryServiceLike | null;
  modelContext?: TurnMemoryWritebackModelContext | null;
  wakeDurableMemoryWorker?: (() => void) | null;
  enqueueEvolveJobFn?: typeof enqueueEvolveJob;
}

export interface EvolveTask {
  name: string;
  shouldRun: (context: EvolveTaskContext) => boolean;
  run: (context: EvolveTaskContext) => Promise<void>;
}

export interface ScheduleEvolveTasksOptions extends EvolveTaskContext {
  tasks?: EvolveTask[];
  scheduleFn?: (callback: () => void) => void;
  onTaskError?: (taskName: string, error: unknown) => void;
}

export const turnMemoryEvolveTask: EvolveTask = {
  name: "turn_memory_evolve",
  shouldRun: (context) => Boolean(context.memoryService),
  run: async (context) => {
    if (!context.memoryService) {
      return;
    }
    (context.enqueueEvolveJobFn ?? enqueueEvolveJob)({
      store: context.store,
      workspaceId: context.turnResult.workspaceId,
      sessionId: context.turnResult.sessionId,
      inputId: context.turnResult.inputId,
      instruction: context.modelContext?.instruction ?? null,
      wakeWorker: context.wakeDurableMemoryWorker ?? null,
    });
  },
};

const DEFAULT_EVOLVE_TASKS: EvolveTask[] = [turnMemoryEvolveTask];

export async function runEvolveTasks(options: ScheduleEvolveTasksOptions): Promise<void> {
  const tasks = options.tasks ?? DEFAULT_EVOLVE_TASKS;
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

export function scheduleEvolveTasks(options: ScheduleEvolveTasksOptions): void {
  const scheduleFn = options.scheduleFn ?? ((callback: () => void) => setImmediate(callback));
  scheduleFn(() => {
    void runEvolveTasks(options);
  });
}
