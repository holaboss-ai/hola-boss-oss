import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { buildRuntimeApiServer, type BuildRuntimeApiServerOptions } from "./app.js";
import type { AppLifecycleExecutorLike } from "./app-lifecycle-worker.js";

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

function buildTestRuntimeApiServer(options: BuildRuntimeApiServerOptions) {
  return buildRuntimeApiServer({
    ...options,
    queueWorker: null,
    cronWorker: null,
    bridgeWorker: null
  });
}

test("healthz returns ok", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const response = await app.inject({ method: "GET", url: "/healthz" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
  await app.close();
  store.close();
});

test("workspace CRUD routes preserve local payload shape", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    payload: {
      name: "Workspace 1",
      harness: "opencode",
      status: "provisioning",
      main_session_id: "session-main"
    }
  });
  assert.equal(created.statusCode, 200);
  const workspace = created.json().workspace as { id: string };

  const listed = await app.inject({ method: "GET", url: "/api/v1/workspaces" });
  const fetched = await app.inject({ method: "GET", url: `/api/v1/workspaces/${workspace.id}` });
  const updated = await app.inject({
    method: "PATCH",
    url: `/api/v1/workspaces/${workspace.id}`,
    payload: {
      status: "active",
      onboarding_status: "pending"
    }
  });
  const nullPatch = await app.inject({
    method: "PATCH",
    url: `/api/v1/workspaces/${workspace.id}`,
    payload: {
      onboarding_status: null,
      error_message: null
    }
  });
  const deleted = await app.inject({ method: "DELETE", url: `/api/v1/workspaces/${workspace.id}` });

  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().total, 1);
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().workspace.id, workspace.id);
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().workspace.status, "active");
  assert.equal(updated.json().workspace.onboarding_status, "pending");
  assert.equal(nullPatch.statusCode, 200);
  assert.equal(nullPatch.json().workspace.onboarding_status, "pending");
  assert.equal(nullPatch.json().workspace.error_message, null);
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().workspace.status, "deleted");

  await app.close();
  store.close();
});

test("runtime states and history endpoints read TS state store", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "opencode",
    harnessSessionId: "harness-1"
  });
  store.insertSessionMessage({
    workspaceId: workspace.id,
    sessionId: "session-main",
    role: "user",
    text: "hello",
    messageId: "m-1"
  });
  store.insertSessionMessage({
    workspaceId: workspace.id,
    sessionId: "session-main",
    role: "assistant",
    text: "hi",
    messageId: "m-2"
  });

  const states = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/by-workspace/${workspace.id}/runtime-states`
  });
  const history = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/history?workspace_id=${workspace.id}`
  });

  assert.equal(states.statusCode, 200);
  assert.deepEqual(states.json().items, []);
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().source, "sandbox_local_storage");
  assert.equal(history.json().harness, "opencode");
  assert.deepEqual(
    history.json().messages.map((item: { role: string }) => item.role),
    ["user", "assistant"]
  );

  await app.close();
  store.close();
});

test("output events endpoint supports incremental fetches and tail mode", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });
  store.appendOutputEvent({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    sequence: 1,
    eventType: "run_started",
    payload: { instruction_preview: "hello" }
  });
  store.appendOutputEvent({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    sequence: 2,
    eventType: "output_delta",
    payload: { delta: "hi" }
  });

  const incremental = await app.inject({
    method: "GET",
    url: "/api/v1/agent-sessions/session-main/outputs/events?input_id=input-1&after_event_id=1"
  });
  const tailed = await app.inject({
    method: "GET",
    url: "/api/v1/agent-sessions/session-main/outputs/events?input_id=input-1&include_history=false"
  });

  assert.equal(incremental.statusCode, 200);
  assert.equal(incremental.json().count, 1);
  assert.equal(incremental.json().items[0].event_type, "output_delta");
  assert.equal(incremental.json().last_event_id, incremental.json().items[0].id);

  assert.equal(tailed.statusCode, 200);
  assert.equal(tailed.json().count, 0);
  assert.ok(tailed.json().last_event_id >= 2);

  await app.close();
  store.close();
});

test("output stream endpoint emits SSE events and stops on terminal", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });
  store.appendOutputEvent({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    sequence: 1,
    eventType: "run_started",
    payload: { instruction_preview: "hello" }
  });
  store.appendOutputEvent({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    sequence: 2,
    eventType: "run_completed",
    payload: { status: "success" }
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/agent-sessions/session-main/outputs/stream?input_id=input-1"
  });
  const body = response.body;

  assert.equal(response.statusCode, 200);
  assert.match(body, /event: run_started/);
  assert.match(body, /event: run_completed/);

  await app.close();
  store.close();
});

test("outputs, folders, and artifacts routes preserve local payload shape", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Outputs",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });

  const folderResp = await app.inject({
    method: "POST",
    url: "/api/v1/output-folders",
    payload: { workspace_id: workspace.id, name: "Drafts" }
  });
  assert.equal(folderResp.statusCode, 200);
  const folder = folderResp.json().folder as { id: string };

  const outputResp = await app.inject({
    method: "POST",
    url: "/api/v1/outputs",
    payload: {
      workspace_id: workspace.id,
      output_type: "document",
      title: "Spec Draft",
      folder_id: folder.id,
      session_id: "session-main"
    }
  });
  assert.equal(outputResp.statusCode, 200);
  assert.equal(outputResp.json().output.folder_id, folder.id);

  const artifactResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent-sessions/session-main/artifacts",
    payload: {
      workspace_id: workspace.id,
      artifact_type: "document",
      external_id: "doc-1",
      title: "Generated Doc",
      platform: "notion"
    }
  });
  assert.equal(artifactResp.statusCode, 200);

  const outputsResp = await app.inject({
    method: "GET",
    url: `/api/v1/outputs?workspace_id=${workspace.id}`
  });
  const countsResp = await app.inject({
    method: "GET",
    url: `/api/v1/outputs/counts?workspace_id=${workspace.id}`
  });
  const artifactsResp = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/artifacts?workspace_id=${workspace.id}`
  });
  const withArtifactsResp = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/by-workspace/${workspace.id}/with-artifacts`
  });

  assert.equal(outputsResp.statusCode, 200);
  assert.equal(countsResp.statusCode, 200);
  assert.equal(artifactsResp.statusCode, 200);
  assert.equal(withArtifactsResp.statusCode, 200);
  assert.equal(outputsResp.json().items.length, 2);
  assert.equal(countsResp.json().total, 2);
  assert.equal(artifactsResp.json().count, 1);
  assert.equal(withArtifactsResp.json().items[0].artifacts[0].external_id, "doc-1");

  await app.close();
  store.close();
});

test("cronjobs, task proposals, and session state routes preserve local payload shape", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Jobs",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "opencode",
    harnessSessionId: "harness-1"
  });
  store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello" },
    idempotencyKey: randomUUID()
  });

  const stateResp = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/state?workspace_id=${workspace.id}`
  });
  assert.equal(stateResp.statusCode, 200);
  assert.equal(stateResp.json().effective_state, "QUEUED");

  const createdJob = await app.inject({
    method: "POST",
    url: "/api/v1/cronjobs",
    payload: {
      workspace_id: workspace.id,
      initiated_by: "workspace_agent",
      cron: "0 9 * * *",
      description: "Daily check",
      delivery: { mode: "announce", channel: "session_run", to: null }
    }
  });
  assert.equal(createdJob.statusCode, 200);
  const jobId = createdJob.json().id as string;

  const listedJobs = await app.inject({
    method: "GET",
    url: `/api/v1/cronjobs?workspace_id=${workspace.id}`
  });
  const updatedJob = await app.inject({
    method: "PATCH",
    url: `/api/v1/cronjobs/${jobId}`,
    payload: { description: "Updated check" }
  });
  assert.equal(listedJobs.statusCode, 200);
  assert.equal(listedJobs.json().count, 1);
  assert.equal(updatedJob.statusCode, 200);
  assert.equal(updatedJob.json().description, "Updated check");

  const createdProposal = await app.inject({
    method: "POST",
    url: "/api/v1/task-proposals",
    payload: {
      proposal_id: "proposal-1",
      workspace_id: workspace.id,
      task_name: "Follow up",
      task_prompt: "Write a follow-up message",
      task_generation_rationale: "User has not replied",
      source_event_ids: ["evt-1"],
      created_at: new Date().toISOString()
    }
  });
  assert.equal(createdProposal.statusCode, 200);

  const listedProposals = await app.inject({
    method: "GET",
    url: `/api/v1/task-proposals?workspace_id=${workspace.id}`
  });
  const unreviewed = await app.inject({
    method: "GET",
    url: `/api/v1/task-proposals/unreviewed?workspace_id=${workspace.id}`
  });
  const updatedProposal = await app.inject({
    method: "PATCH",
    url: "/api/v1/task-proposals/proposal-1",
    payload: { state: "accepted" }
  });

  assert.equal(listedProposals.statusCode, 200);
  assert.equal(listedProposals.json().count, 1);
  assert.equal(unreviewed.statusCode, 200);
  assert.equal(unreviewed.json().count, 1);
  assert.equal(updatedProposal.statusCode, 200);
  assert.equal(updatedProposal.json().proposal.state, "accepted");

  await app.close();
  store.close();
});

test("workspace exec route runs inside the workspace directory", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const app = buildTestRuntimeApiServer({ store });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    payload: {
      name: "Workspace Exec",
      harness: "opencode",
      status: "active"
    }
  });
  const workspace = created.json().workspace as { id: string };

  const response = await app.inject({
    method: "POST",
    url: `/api/v1/sandbox/users/test-user/workspaces/${workspace.id}/exec`,
    payload: {
      command: "pwd",
      timeout_s: 30
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().returncode, 0);
  assert.equal(response.json().stderr, "");
  assert.equal(
    fs.realpathSync(response.json().stdout.trim()),
    fs.realpathSync(path.join(workspaceRoot, workspace.id))
  );

  await app.close();
  store.close();
});

test("workspace template, file, and snapshot routes preserve local payload shape", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const app = buildTestRuntimeApiServer({ store });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    payload: {
      name: "Workspace Files",
      harness: "opencode",
      status: "active"
    }
  });
  const workspace = created.json().workspace as { id: string };

  const applied = await app.inject({
    method: "POST",
    url: `/api/v1/workspaces/${workspace.id}/apply-template`,
    payload: {
      replace_existing: true,
      files: [
        {
          path: "README.md",
          content_base64: Buffer.from("# Hello\n", "utf8").toString("base64")
        },
        {
          path: "scripts/run.sh",
          content_base64: Buffer.from("echo hi\n", "utf8").toString("base64"),
          executable: true
        }
      ]
    }
  });
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.json().files_written, 2);

  const written = await app.inject({
    method: "PUT",
    url: `/api/v1/workspaces/${workspace.id}/files/docs/note.txt`,
    payload: {
      content_base64: Buffer.from("note body", "utf8").toString("base64"),
      executable: false
    }
  });
  assert.equal(written.statusCode, 200);
  assert.equal(written.json().path, "docs/note.txt");

  const readText = await app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${workspace.id}/files/README.md`
  });
  assert.equal(readText.statusCode, 200);
  assert.equal(readText.json().encoding, "utf-8");
  assert.equal(readText.json().content, "# Hello\n");

  const binaryPath = path.join(workspaceRoot, workspace.id, "bin", "payload.bin");
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, Buffer.from([0xff, 0x00, 0xfe]));
  const readBinary = await app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${workspace.id}/files/bin/payload.bin`
  });
  assert.equal(readBinary.statusCode, 200);
  assert.equal(readBinary.json().encoding, "base64");
  assert.equal(readBinary.json().content, Buffer.from([0xff, 0x00, 0xfe]).toString("base64"));

  fs.writeFileSync(path.join(workspaceRoot, workspace.id, "workspace.yaml"), "name: demo\n", "utf8");
  const snapshot = await app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${workspace.id}/snapshot`
  });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.json().workspace_id, workspace.id);
  assert.ok(snapshot.json().file_count >= 4);
  assert.equal(snapshot.json().previews["workspace.yaml"], "name: demo\n");
  assert.equal(snapshot.json().git.dirty, undefined);

  await app.close();
  store.close();
});

test("workspace export route streams a tar.gz with the workspace files", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const app = buildTestRuntimeApiServer({ store });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    payload: {
      name: "Workspace Export",
      harness: "opencode",
      status: "active"
    }
  });
  const workspace = created.json().workspace as { id: string };
  const workspaceDir = path.join(workspaceRoot, workspace.id);
  fs.writeFileSync(path.join(workspaceDir, "README.md"), "# Export\n", "utf8");
  fs.mkdirSync(path.join(workspaceDir, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "node_modules", "ignored.txt"), "skip", "utf8");

  const exported = await app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${workspace.id}/export`
  });

  assert.equal(exported.statusCode, 200);
  assert.equal(exported.headers["content-type"], "application/gzip");
  assert.equal(
    exported.headers["content-disposition"],
    `attachment; filename=${workspace.id}.tar.gz`
  );
  const listed = spawnSync("tar", ["-tzf", "-"], {
    input: exported.rawPayload
  });
  assert.equal(listed.status, 0);
  const entries = listed.stdout.toString("utf8").trim().split("\n");
  assert.equal(entries.includes("./README.md"), true);
  assert.equal(entries.some((entry: string) => entry.includes("node_modules")), false);

  await app.close();
  store.close();
});

test("app ports route preserves deterministic workspace port assignments", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const app = buildTestRuntimeApiServer({ store });

  fs.mkdirSync(path.join(workspaceRoot, "workspace-1", "apps", "app-a"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "workspace-1", "apps", "app-b"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, "workspace-1", "workspace.yaml"),
    [
      "applications:",
      "  - app_id: app-a",
      "    config_path: apps/app-a/app.runtime.yaml",
      "  - app_id: app-b",
      "    config_path: apps/app-b/app.runtime.yaml"
    ].join("\n"),
    "utf8"
  );

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/apps/ports?workspace_id=workspace-1"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    "app-a": { http: 18080, mcp: 13100 },
    "app-b": { http: 18081, mcp: 13101 }
  });

  await app.close();
  store.close();
});

test("app lifecycle routes delegate to the lifecycle executor and uninstall updates workspace state", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });
  store.upsertAppBuild({
    workspaceId: workspace.id,
    appId: "app-b",
    status: "building"
  });

  const workspaceDir = path.join(workspaceRoot, workspace.id);
  fs.mkdirSync(path.join(workspaceDir, "apps", "app-a"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "apps", "app-b"), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "apps", "app-b", "app.runtime.yaml"), "app_id: app-b\nmcp:\n  port: 4100\n", "utf8");
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    [
      "applications:",
      "  - app_id: app-a",
      "    config_path: apps/app-a/app.runtime.yaml",
      "  - app_id: app-b",
      "    config_path: apps/app-b/app.runtime.yaml"
    ].join("\n"),
    "utf8"
  );

  const calls: Array<{ action: string; workspaceId: string; appId: string }> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push({ action: "start", ...params });
      return {
        app_id: params.appId,
        status: "started",
        detail: "app started with lifecycle manager",
        ports: { http: 18081, mcp: 13101 }
      };
    },
    async stopApp(params) {
      calls.push({ action: "stop", ...params });
      return {
        app_id: params.appId,
        status: "stopped",
        detail: "app stopped via lifecycle manager",
        ports: {}
      };
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const started = await app.inject({
    method: "POST",
    url: "/api/v1/apps/app-b/start",
    payload: { workspace_id: workspace.id }
  });
  const stopped = await app.inject({
    method: "POST",
    url: "/api/v1/apps/app-b/stop",
    payload: { workspace_id: workspace.id }
  });
  const uninstalled = await app.inject({
    method: "DELETE",
    url: "/api/v1/apps/app-b",
    payload: { workspace_id: workspace.id }
  });

  assert.equal(started.statusCode, 200);
  assert.deepEqual(started.json(), {
    app_id: "app-b",
    status: "started",
    detail: "app started with lifecycle manager",
    ports: { http: 18081, mcp: 13101 }
  });
  assert.equal(stopped.statusCode, 200);
  assert.deepEqual(stopped.json(), {
    app_id: "app-b",
    status: "stopped",
    detail: "app stopped via lifecycle manager",
    ports: {}
  });
  assert.equal(uninstalled.statusCode, 200);
  assert.deepEqual(uninstalled.json(), {
    app_id: "app-b",
    status: "uninstalled",
    detail: "App stopped, files removed, workspace.yaml updated",
    ports: {}
  });
  assert.deepEqual(calls, [
    { action: "start", workspaceId: "workspace-1", appId: "app-b" },
    { action: "stop", workspaceId: "workspace-1", appId: "app-b" },
    { action: "stop", workspaceId: "workspace-1", appId: "app-b" }
  ]);
  assert.equal(fs.existsSync(path.join(workspaceDir, "apps", "app-b")), false);
  assert.equal(store.getAppBuild({ workspaceId: workspace.id, appId: "app-b" }), null);
  const workspaceYaml = fs.readFileSync(path.join(workspaceDir, "workspace.yaml"), "utf8");
  assert.equal(workspaceYaml.includes("app-b"), false);

  await app.close();
  store.close();
});

test("app install, list, build-status, and setup routes preserve local payload shape", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const app = buildTestRuntimeApiServer({ store });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    payload: {
      name: "Workspace Apps",
      harness: "opencode",
      status: "active"
    }
  });
  const workspace = created.json().workspace as { id: string };

  const install = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install",
    payload: {
      app_id: "demo-app",
      workspace_id: workspace.id,
      files: [
        {
          path: "app.runtime.yaml",
          content_base64: Buffer.from(
            [
              "app_id: demo-app",
              "mcp:",
              "  port: 4100",
              "lifecycle:",
              "  start: npm run dev"
            ].join("\n"),
            "utf8"
          ).toString("base64")
        }
      ]
    }
  });
  assert.equal(install.statusCode, 200);
  assert.deepEqual(install.json(), {
    app_id: "demo-app",
    status: "installed",
    detail: "Files written, no setup command defined"
  });

  const listed = await app.inject({
    method: "GET",
    url: `/api/v1/apps?workspace_id=${workspace.id}`
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), {
    apps: [
      {
        app_id: "demo-app",
        config_path: "apps/demo-app/app.runtime.yaml",
        lifecycle: { start: "npm run dev" },
        build_status: "unknown"
      }
    ],
    count: 1
  });

  const buildStatus = await app.inject({
    method: "GET",
    url: `/api/v1/apps/demo-app/build-status?workspace_id=${workspace.id}`
  });
  assert.equal(buildStatus.statusCode, 200);
  assert.deepEqual(buildStatus.json(), { status: "unknown" });

  const setup = await app.inject({
    method: "POST",
    url: "/api/v1/apps/demo-app/setup",
    payload: { workspace_id: workspace.id }
  });
  assert.equal(setup.statusCode, 200);
  assert.deepEqual(setup.json(), {
    app_id: "demo-app",
    status: "no_setup_command",
    detail: "No lifecycle.setup defined",
    ports: {}
  });

  await app.close();
  store.close();
});

test("queue route persists input, user message, and runtime state", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode",
    status: "active",
    mainSessionId: "session-main"
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/agent-sessions/queue",
    payload: {
      workspace_id: workspace.id,
      text: "hello world"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().session_id, "session-main");
  assert.equal(response.json().status, "QUEUED");

  const queued = store.getInput(response.json().input_id);
  assert.ok(queued);
  assert.equal(queued.payload.text, "hello world");
  assert.equal("holaboss_user_id" in queued.payload, false);

  const runtimeStates = store.listRuntimeStates(workspace.id);
  assert.equal(runtimeStates[0].status, "QUEUED");
  assert.equal(runtimeStates[0].currentInputId, response.json().input_id);

  const history = store.listSessionMessages({ workspaceId: workspace.id, sessionId: "session-main" });
  assert.equal(history.length, 1);
  assert.equal(history[0].role, "user");
  assert.equal(history[0].text, "hello world");

  await app.close();
  store.close();
});
