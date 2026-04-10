import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { runPostRunTasks, schedulePostRunTasks, type PostRunTaskContext } from "./post-run-tasks.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeContext(): PostRunTaskContext {
  const root = makeTempDir("hb-post-run-tasks-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspaces"),
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const record = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "hello" },
  });
  const turnResult = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: record.inputId,
    startedAt: "2026-04-07T00:00:00.000Z",
    completedAt: "2026-04-07T00:00:05.000Z",
    status: "completed",
    assistantText: "done",
  });
  return {
    store,
    record,
    turnResult,
    memoryService: null,
    modelContext: null,
  };
}

test("schedulePostRunTasks defers task execution", async () => {
  const context = makeContext();
  let ran = false;

  schedulePostRunTasks({
    ...context,
    tasks: [
      {
        name: "test_task",
        shouldRun: () => true,
        run: async () => {
          ran = true;
        },
      },
    ],
  });

  assert.equal(ran, false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ran, true);

  context.store.close();
});

test("runPostRunTasks continues after a task error", async () => {
  const context = makeContext();
  const errors: string[] = [];
  const ran: string[] = [];

  await runPostRunTasks({
    ...context,
    tasks: [
      {
        name: "failing_task",
        shouldRun: () => true,
        run: async () => {
          ran.push("failing_task");
          throw new Error("boom");
        },
      },
      {
        name: "next_task",
        shouldRun: () => true,
        run: async () => {
          ran.push("next_task");
        },
      },
    ],
    onTaskError: (taskName, error) => {
      errors.push(`${taskName}:${error instanceof Error ? error.message : String(error)}`);
    },
  });

  assert.deepEqual(ran, ["failing_task", "next_task"]);
  assert.deepEqual(errors, ["failing_task:boom"]);

  context.store.close();
});
