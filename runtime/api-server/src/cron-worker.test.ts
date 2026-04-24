import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { buildRuntimeApiServer } from "./app.js";
import {
  RuntimeCronWorker,
  cronjobCheckIntervalMs,
  cronjobInstruction,
  cronjobIsDue,
  cronjobNextRunAt
} from "./cron-worker.js";

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

test("cronjob helpers preserve legacy scheduling behavior", () => {
  const dueJob = {
    enabled: true,
    cron: "0 9 * * *",
    lastRunAt: null
  };
  assert.equal(cronjobIsDue(dueJob as never, new Date("2025-01-01T09:30:00Z")), true);
  assert.ok(cronjobNextRunAt("0 9 * * *", new Date("2025-01-01T09:30:00Z")));
  assert.equal(cronjobNextRunAt("not a cron", new Date("2025-01-01T09:30:00Z")), null);
  assert.equal(
    cronjobInstruction("Daily check", { priority: 1, team: "growth" }),
    'Daily check\n\n[Cronjob Metadata]\n{"team":"growth"}'
  );
  assert.equal(
    cronjobInstruction("Remind me to drink water.", {
      source_session_id: "session-main",
      team: "growth"
    }),
    'Remind me to drink water.\n\n[Cronjob Metadata]\n{"team":"growth"}'
  );

  const previous = process.env.CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS;
  process.env.CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS = "2";
  assert.equal(cronjobCheckIntervalMs(), 5000);
  if (previous === undefined) {
    delete process.env.CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS;
  } else {
    process.env.CRONJOB_RUNNER_CHECK_INTERVAL_SECONDS = previous;
  }
});

test("runtime cron worker queues due session_run cronjobs as hidden subagents and updates bookkeeping", async () => {
  const root = makeTempDir("hb-runtime-cron-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "session-main",
    kind: "workspace_session",
  });
  store.upsertConversationBinding({
    workspaceId: workspace.id,
    channel: "desktop",
    conversationKey: "workspace-main",
    sessionId: "session-main",
    role: "main",
  });
  const job = store.createCronjob({
    workspaceId: workspace.id,
    initiatedBy: "workspace_agent",
    name: "Daily",
    cron: "0 9 * * *",
    description: "Daily check",
    instruction: "Say hello",
    delivery: { channel: "session_run" },
    metadata: {
      session_id: "session-main",
      model: "gpt-5",
      priority: 3,
      idempotency_key: "cron-idempotency",
      team: "growth"
    }
  });

  let wakeCalls = 0;
  const worker = new RuntimeCronWorker({
    store,
    queueWorker: {
      async start() {},
      wake() {
        wakeCalls += 1;
      },
      async close() {}
    }
  });

  const processed = await worker.processDueCronjobsOnce(new Date("2025-01-01T09:30:00Z"));
  const updated = store.getCronjob(job.id);
  const runs = store.listSubagentRunsByWorkspace({ workspaceId: workspace.id });
  const run = runs[0];
  const runtimeState = run
    ? store.getRuntimeState({
        workspaceId: workspace.id,
        sessionId: run.childSessionId,
      })
    : null;
  const queued = store.claimInputs({ limit: 10, claimedBy: "test", leaseSeconds: 300 });
  const childSession = run
    ? store.getSession({ workspaceId: workspace.id, sessionId: run.childSessionId })
    : null;
  const notifications = store.listRuntimeNotifications({ workspaceId: workspace.id });

  assert.equal(processed, 1);
  assert.equal(wakeCalls, 1);
  assert.ok(updated);
  assert.equal(updated.lastStatus, "success");
  assert.equal(updated.runCount, 1);
  assert.ok(updated.lastRunAt);
  assert.ok(updated.nextRunAt);
  assert.equal(runs.length, 1);
  assert.ok(run);
  assert.equal(run?.originMainSessionId, "session-main");
  assert.equal(run?.ownerMainSessionId, "session-main");
  assert.equal(run?.parentSessionId, "session-main");
  assert.equal(run?.sourceType, "cronjob");
  assert.equal(run?.cronjobId, job.id);
  assert.equal(run?.status, "queued");
  assert.ok(childSession);
  assert.equal(childSession?.kind, "subagent");
  assert.ok(runtimeState);
  assert.equal(runtimeState.status, "QUEUED");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].payload.model, "gpt-5");
  assert.equal(
    (queued[0].payload.context as Record<string, unknown>).source,
    "subagent",
  );
  assert.equal(
    (queued[0].payload.context as Record<string, unknown>).source_type,
    "cronjob",
  );
  assert.equal(
    (queued[0].payload.context as Record<string, unknown>).cronjob_id,
    job.id,
  );
  assert.equal(
    (queued[0].payload.context as Record<string, unknown>).subagent_id,
    run?.subagentId,
  );
  assert.match(String(queued[0].payload.text), /^Say hello/);
  assert.match(String(queued[0].payload.text), /\[Cronjob Metadata\]/);
  assert.equal(notifications.length, 0);

  store.close();
});

test("runtime cron worker inherits the main-session model when cronjob metadata does not pin one", async () => {
  const root = makeTempDir("hb-runtime-cron-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "session-main",
    kind: "workspace_session",
  });
  store.upsertConversationBinding({
    workspaceId: workspace.id,
    channel: "desktop",
    conversationKey: "workspace-main",
    sessionId: "session-main",
    role: "main",
  });
  store.upsertTurnRequestSnapshot({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-main",
    snapshotKind: "harness_host_request",
    fingerprint: "snapshot-main",
    payload: {
      runtime_config: {
        provider_id: "openai",
        model_id: "gpt-5.4"
      }
    }
  });
  const job = store.createCronjob({
    workspaceId: workspace.id,
    initiatedBy: "workspace_agent",
    name: "Hello",
    cron: "0 9 * * *",
    description: "Say hello every day.",
    instruction: "Say hello.",
    delivery: { channel: "session_run" },
    metadata: {}
  });

  const worker = new RuntimeCronWorker({
    store,
    queueWorker: {
      async start() {},
      wake() {},
      async close() {}
    }
  });

  const processed = await worker.processDueCronjobsOnce(new Date("2025-01-01T09:30:00Z"));
  const queued = store.claimInputs({ limit: 10, claimedBy: "test", leaseSeconds: 300 });
  const runs = store.listSubagentRunsByWorkspace({ workspaceId: workspace.id });

  assert.equal(processed, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.payload.model, "openai/gpt-5.4");
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.ownerMainSessionId, "session-main");

  store.close();
});

test("runtime cron worker persists system_notification cronjobs as unread notifications", async () => {
  const root = makeTempDir("hb-runtime-cron-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const job = store.createCronjob({
    workspaceId: workspace.id,
    initiatedBy: "workspace_agent",
    name: "drink-water-minute",
    cron: "0 9 * * *",
    description: "Time to drink water.",
    delivery: { channel: "system_notification" },
    metadata: {
      notification_title: "Drink Water",
      notification_level: "warning",
      notification_priority: "critical"
    }
  });

  const worker = new RuntimeCronWorker({ store });
  const processed = await worker.processDueCronjobsOnce(new Date("2025-01-01T09:30:00Z"));
  const notifications = store.listRuntimeNotifications({ workspaceId: workspace.id });
  const updated = store.getCronjob(job.id);
  const mainBinding = store.getConversationBindingByConversation({
    workspaceId: workspace.id,
    channel: "desktop",
    conversationKey: "workspace-main",
    role: "main",
  });
  const messages =
    mainBinding == null
      ? []
      : store.listSessionMessages({
          workspaceId: workspace.id,
          sessionId: mainBinding.sessionId,
        });

  assert.equal(processed, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.title, "Drink Water");
  assert.equal(notifications[0]?.message, "Time to drink water.");
  assert.equal(notifications[0]?.level, "warning");
  assert.equal(notifications[0]?.priority, "critical");
  assert.equal(notifications[0]?.state, "unread");
  assert.equal(notifications[0]?.cronjobId, job.id);
  assert.ok(mainBinding);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "assistant");
  assert.equal(messages[0]?.text, "Time to drink water.");
  assert.ok(updated);
  assert.equal(updated.lastStatus, "success");
  assert.equal(updated.runCount, 1);

  store.close();
});

test("runtime cron worker records failures for unsupported delivery channels", async () => {
  const root = makeTempDir("hb-runtime-cron-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const job = store.createCronjob({
    workspaceId: "workspace-1",
    initiatedBy: "workspace_agent",
    name: "Broken",
    cron: "0 9 * * *",
    description: "Broken",
    delivery: { channel: "email" }
  });

  const worker = new RuntimeCronWorker({ store });
  const processed = await worker.processDueCronjobsOnce(new Date("2025-01-01T09:30:00Z"));
  const updated = store.getCronjob(job.id);

  assert.equal(processed, 1);
  assert.ok(updated);
  assert.equal(updated.lastStatus, "failed");
  assert.equal(updated.runCount, 0);
  assert.match(updated.lastError ?? "", /unsupported cronjob delivery channel/);

  store.close();
});

test("cronjob routes compute next_run_at and cron worker lifecycle hooks run", async () => {
  const root = makeTempDir("hb-runtime-cron-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });

  let startCalls = 0;
  let closeCalls = 0;
  const app = buildRuntimeApiServer({
    store,
    queueWorker: null,
    bridgeWorker: null,
    cronWorker: {
      async start() {
        startCalls += 1;
      },
      async close() {
        closeCalls += 1;
      }
    }
  });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/cronjobs",
    payload: {
      workspace_id: workspace.id,
      initiated_by: "workspace_agent",
      cron: "0 9 * * *",
      description: "Daily check",
      delivery: { channel: "session_run" }
    }
  });
  const body = created.json() as { id: string; next_run_at: string | null };
  const updated = await app.inject({
    method: "PATCH",
    url: `/api/v1/cronjobs/${body.id}`,
    payload: {
      cron: "0 10 * * *"
    }
  });

  assert.equal(startCalls, 1);
  assert.equal(created.statusCode, 200);
  assert.ok(body.next_run_at);
  assert.equal(updated.statusCode, 200);
  assert.ok(updated.json().next_run_at);

  await app.close();
  assert.equal(closeCalls, 1);
  store.close();
});
