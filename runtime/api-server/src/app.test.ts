import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";
import yazl from "yazl";

import { buildRuntimeApiServer, type BuildRuntimeApiServerOptions } from "./app.js";
import { appLocalNpmCacheDir, buildAppSetupEnv } from "./app-setup-env.js";
import type { AppLifecycleExecutorLike } from "./app-lifecycle-worker.js";
import type { MemoryServiceLike } from "./memory.js";
import type { RuntimeConfigServiceLike } from "./runtime-config.js";
import type { RunnerExecutorLike } from "./runner-worker.js";

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

async function createZipBuffer(
  entries: Array<{ path: string; content: string | Buffer; mode?: number }>
): Promise<Buffer> {
  const zipFile = new yazl.ZipFile();
  for (const entry of entries) {
    zipFile.addBuffer(
      Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8"),
      entry.path,
      entry.mode ? { mode: entry.mode } : undefined
    );
  }

  const chunks: Buffer[] = [];
  const output = zipFile.outputStream;
  output.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  const completed = new Promise<Buffer>((resolve, reject) => {
    output.once("error", reject);
    output.once("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });

  zipFile.end();
  return completed;
}

function rewriteZipEntryName(archive: Buffer, fromPath: string, toPath: string): Buffer {
  const from = Buffer.from(fromPath, "utf8");
  const to = Buffer.from(toPath, "utf8");
  assert.equal(from.length, to.length, "zip entry rewrite must preserve encoded path length");

  const mutated = Buffer.from(archive);
  let offset = 0;
  let replaced = 0;
  while (offset >= 0) {
    offset = mutated.indexOf(from, offset);
    if (offset < 0) {
      break;
    }
    to.copy(mutated, offset);
    offset += from.length;
    replaced += 1;
  }

  assert.ok(replaced >= 2, "expected to rewrite local and central directory zip entries");
  return mutated;
}

async function startStaticHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
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

test("buildAppSetupEnv uses an app-local npm cache", () => {
  const appDir = makeTempDir("hb-app-env-");
  const env = buildAppSetupEnv(appDir, { PATH: process.env.PATH });

  const expectedCacheDir = appLocalNpmCacheDir(appDir);
  assert.equal(env.npm_config_cache, expectedCacheDir);
  assert.equal(env.NPM_CONFIG_CACHE, expectedCacheDir);
  assert.ok(fs.existsSync(expectedCacheDir));
});

test("runtime config routes delegate to the runtime config executor", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const calls: string[] = [];
  const runtimeConfigService: RuntimeConfigServiceLike = {
    async getConfig() {
      calls.push("get-config");
      return {
        config_path: "/tmp/runtime-config.json",
        loaded_from_file: false,
        auth_token_present: false,
        user_id: null,
        sandbox_id: null,
        model_proxy_base_url: null,
        default_model: "openai/gpt-5.1",
        runtime_mode: "oss",
        default_provider: null,
        holaboss_enabled: false,
        desktop_browser_enabled: false,
        desktop_browser_url: null
      };
    },
    async getStatus() {
      calls.push("get-status");
      return {
        harness: "opencode",
        config_loaded: true,
        config_path: "/tmp/runtime-config.json",
        opencode_config_present: true,
        harness_ready: true,
        harness_state: "ready",
        browser_available: false,
        browser_state: "unavailable",
        browser_url: null
      };
    },
    async updateConfig(payload) {
      calls.push(`put-config:${JSON.stringify(payload)}`);
      return {
        config_path: "/tmp/runtime-config.json",
        loaded_from_file: true,
        auth_token_present: true,
        user_id: "user-1",
        sandbox_id: "sandbox-1",
        model_proxy_base_url: "https://runtime.example/api/v1/model-proxy",
        default_model: "openai/gpt-5.1",
        runtime_mode: "oss",
        default_provider: "holaboss_model_proxy",
        holaboss_enabled: true,
        desktop_browser_enabled: false,
        desktop_browser_url: null
      };
    }
  };
  const app = buildTestRuntimeApiServer({ store, runtimeConfigService });

  const config = await app.inject({
    method: "GET",
    url: "/api/v1/runtime/config"
  });
  const status = await app.inject({
    method: "GET",
    url: "/api/v1/runtime/status"
  });
  const updated = await app.inject({
    method: "PUT",
    url: "/api/v1/runtime/config",
    payload: {
      auth_token: "token-1",
      user_id: "user-1",
      sandbox_id: "sandbox-1",
      model_proxy_base_url: "https://runtime.example/api/v1/model-proxy",
      default_model: "openai/gpt-5.1"
    }
  });

  assert.equal(config.statusCode, 200);
  assert.equal(status.statusCode, 200);
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(calls, [
    "get-config",
    "get-status",
    "put-config:{\"auth_token\":\"token-1\",\"user_id\":\"user-1\",\"sandbox_id\":\"sandbox-1\",\"model_proxy_base_url\":\"https://runtime.example/api/v1/model-proxy\",\"default_model\":\"openai/gpt-5.1\"}"
  ]);

  await app.close();
  store.close();
});

test("runner routes delegate to the runner executor", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const calls: Array<{ operation: string; payload: Record<string, unknown> }> = [];
  const runnerExecutor: RunnerExecutorLike = {
    async run(payload) {
      calls.push({ operation: "run", payload });
      return {
        session_id: "session-1",
        input_id: "input-1",
        events: [
          {
            session_id: "session-1",
            input_id: "input-1",
            sequence: 1,
            event_type: "run_started",
            payload: { instruction_preview: "hello" }
          },
          {
            session_id: "session-1",
            input_id: "input-1",
            sequence: 2,
            event_type: "run_completed",
            payload: { status: "success" }
          }
        ]
      };
    },
    async stream(payload) {
      calls.push({ operation: "stream", payload });
      return Readable.from([
        "event: run_started\nid: input-1:1\ndata: {\"session_id\":\"session-1\",\"input_id\":\"input-1\",\"sequence\":1,\"event_type\":\"run_started\",\"payload\":{\"instruction_preview\":\"hello\"}}\n\n",
        "event: run_completed\nid: input-1:2\ndata: {\"session_id\":\"session-1\",\"input_id\":\"input-1\",\"sequence\":2,\"event_type\":\"run_completed\",\"payload\":{\"status\":\"success\"}}\n\n"
      ]);
    }
  };
  const app = buildTestRuntimeApiServer({ store, runnerExecutor });

  const runResponse = await app.inject({
    method: "POST",
    url: "/api/v1/agent-runs",
    payload: {
      workspace_id: "workspace-1",
      session_id: "session-1",
      input_id: "input-1",
      instruction: "hello",
      context: {}
    }
  });
  const streamResponse = await app.inject({
    method: "POST",
    url: "/api/v1/agent-runs/stream",
    payload: {
      workspace_id: "workspace-1",
      session_id: "session-1",
      input_id: "input-1",
      instruction: "hello",
      context: {}
    }
  });

  assert.equal(runResponse.statusCode, 200);
  assert.deepEqual(runResponse.json(), {
    session_id: "session-1",
    input_id: "input-1",
    events: [
      {
        session_id: "session-1",
        input_id: "input-1",
        sequence: 1,
        event_type: "run_started",
        payload: { instruction_preview: "hello" }
      },
      {
        session_id: "session-1",
        input_id: "input-1",
        sequence: 2,
        event_type: "run_completed",
        payload: { status: "success" }
      }
    ]
  });
  assert.equal(streamResponse.statusCode, 200);
  assert.match(streamResponse.body, /event: run_started/);
  assert.match(streamResponse.body, /event: run_completed/);
  assert.deepEqual(calls, [
    {
      operation: "run",
      payload: {
        workspace_id: "workspace-1",
        session_id: "session-1",
        input_id: "input-1",
        instruction: "hello",
        context: {}
      }
    },
    {
      operation: "stream",
      payload: {
        workspace_id: "workspace-1",
        session_id: "session-1",
        input_id: "input-1",
        instruction: "hello",
        context: {}
      }
    }
  ]);

  await app.close();
  store.close();
});

test("memory routes delegate to the memory service and preserve payloads", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const calls: Array<{ operation: string; payload: Record<string, unknown> }> = [];
  const memoryService: MemoryServiceLike = {
    async search(payload) {
      calls.push({ operation: "search", payload });
      return { workspace_id: payload.workspace_id, query: payload.query, hits: [] };
    },
    async get(payload) {
      calls.push({ operation: "get", payload });
      return { path: payload.path, text: "" };
    },
    async upsert(payload) {
      calls.push({ operation: "upsert", payload });
      return { path: payload.path, updated: true };
    },
    async status(payload) {
      calls.push({ operation: "status", payload });
      return { workspace_id: payload.workspace_id, synced: true };
    },
    async sync(payload) {
      calls.push({ operation: "sync", payload });
      return { workspace_id: payload.workspace_id, queued: true, reason: payload.reason };
    }
  };
  const app = buildTestRuntimeApiServer({ store, memoryService });

  const searched = await app.inject({
    method: "POST",
    url: "/api/v1/memory/search",
    payload: {
      workspace_id: "workspace-1",
      query: "durable preferences",
      max_results: 5,
      min_score: 0.1
    }
  });
  const fetched = await app.inject({
    method: "POST",
    url: "/api/v1/memory/get",
    payload: {
      workspace_id: "workspace-1",
      path: "memory/preferences.md"
    }
  });
  const upserted = await app.inject({
    method: "POST",
    url: "/api/v1/memory/upsert",
    payload: {
      workspace_id: "workspace-1",
      path: "memory/preferences.md",
      content: "coffee",
      append: false
    }
  });
  const status = await app.inject({
    method: "POST",
    url: "/api/v1/memory/status",
    payload: {
      workspace_id: "workspace-1"
    }
  });
  const synced = await app.inject({
    method: "POST",
    url: "/api/v1/memory/sync",
    payload: {
      workspace_id: "workspace-1",
      reason: "manual",
      force: true
    }
  });

  assert.equal(searched.statusCode, 200);
  assert.deepEqual(searched.json(), {
    workspace_id: "workspace-1",
    query: "durable preferences",
    hits: []
  });
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(fetched.json(), {
    path: "memory/preferences.md",
    text: ""
  });
  assert.equal(upserted.statusCode, 200);
  assert.deepEqual(upserted.json(), {
    path: "memory/preferences.md",
    updated: true
  });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json(), {
    workspace_id: "workspace-1",
    synced: true
  });
  assert.equal(synced.statusCode, 200);
  assert.deepEqual(synced.json(), {
    workspace_id: "workspace-1",
    queued: true,
    reason: "manual"
  });
  assert.deepEqual(calls, [
    {
      operation: "search",
      payload: {
        workspace_id: "workspace-1",
        query: "durable preferences",
        max_results: 5,
        min_score: 0.1
      }
    },
    {
      operation: "get",
      payload: {
        workspace_id: "workspace-1",
        path: "memory/preferences.md"
      }
    },
    {
      operation: "upsert",
      payload: {
        workspace_id: "workspace-1",
        path: "memory/preferences.md",
        content: "coffee",
        append: false
      }
    },
    {
      operation: "status",
      payload: {
        workspace_id: "workspace-1"
      }
    },
    {
      operation: "sync",
      payload: {
        workspace_id: "workspace-1",
        reason: "manual",
        force: true
      }
    }
  ]);

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

test("workspace apply-template-from-url downloads and extracts a zip archive", async () => {
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
      name: "Workspace Template URL",
      harness: "opencode",
      status: "active"
    }
  });
  const workspace = created.json().workspace as { id: string };
  const workspaceDir = path.join(workspaceRoot, workspace.id);
  fs.writeFileSync(path.join(workspaceDir, "stale.txt"), "stale\n", "utf8");

  const zipArchive = await createZipBuffer([
    { path: "README.md", content: "# Remote Template\n" },
    { path: "scripts/run.sh", content: "echo remote\n", mode: 0o755 }
  ]);
  const requests: string[] = [];
  const server = await startStaticHttpServer((request, response) => {
    requests.push(String(request.headers["x-api-key"] ?? ""));
    response.writeHead(200, { "content-type": "application/zip" });
    response.end(zipArchive);
  });

  try {
    const applied = await app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspace.id}/apply-template-from-url`,
      payload: {
        url: `${server.url}/template.zip`,
        api_key: "template-key",
        replace_existing: true
      }
    });

    assert.equal(applied.statusCode, 200);
    assert.equal(applied.json().files_written, 2);
    assert.deepEqual(requests, ["template-key"]);
    assert.equal(fs.existsSync(path.join(workspaceDir, "stale.txt")), false);
    assert.equal(
      fs.readFileSync(path.join(workspaceDir, "README.md"), "utf8"),
      "# Remote Template\n"
    );
    assert.equal(
      fs.readFileSync(path.join(workspaceDir, "scripts", "run.sh"), "utf8"),
      "echo remote\n"
    );
    assert.notEqual(fs.statSync(path.join(workspaceDir, "scripts", "run.sh")).mode & 0o111, 0);
  } finally {
    await server.close();
    await app.close();
    store.close();
  }
});

test("workspace apply-template-from-url rejects invalid archive paths", async () => {
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
      name: "Workspace Template Invalid URL",
      harness: "opencode",
      status: "active"
    }
  });
  const workspace = created.json().workspace as { id: string };
  const zipArchive = rewriteZipEntryName(
    await createZipBuffer([{ path: "good/file.x", content: "owned\n" }]),
    "good/file.x",
    "../evil.txt"
  );
  const server = await startStaticHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/zip" });
    response.end(zipArchive);
  });

  try {
    const applied = await app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspace.id}/apply-template-from-url`,
      payload: {
        url: `${server.url}/template.zip`
      }
    });

    assert.equal(applied.statusCode, 400);
    assert.match(applied.json().detail, /invalid relative path|path traversal not allowed/i);
    assert.equal(fs.existsSync(path.join(workspaceRoot, "evil.txt")), false);
  } finally {
    await server.close();
    await app.close();
    store.close();
  }
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

  const calls: Array<Record<string, unknown>> = [];
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
    },
    async shutdownAll() {
      throw new Error("not used");
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
    {
      action: "start",
      appId: "app-b",
      appDir: path.join(workspaceDir, "apps", "app-b"),
      httpPort: 18081,
      mcpPort: 13101,
      resolvedApp: {
        appId: "app-b",
        mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
        healthCheck: { path: "/health", timeoutS: 60, intervalS: 5 },
        envContract: [],
        startCommand: "",
        baseDir: "apps/app-b",
        lifecycle: { setup: "", start: "", stop: "" }
      }
    },
    {
      action: "stop",
      appId: "app-b",
      appDir: path.join(workspaceDir, "apps", "app-b"),
      resolvedApp: {
        appId: "app-b",
        mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
        healthCheck: { path: "/health", timeoutS: 60, intervalS: 5 },
        envContract: [],
        startCommand: "",
        baseDir: "apps/app-b",
        lifecycle: { setup: "", start: "", stop: "" }
      }
    },
    {
      action: "stop",
      appId: "app-b",
      appDir: path.join(workspaceDir, "apps", "app-b"),
      resolvedApp: {
        appId: "app-b",
        mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
        healthCheck: { path: "/health", timeoutS: 60, intervalS: 5 },
        envContract: [],
        startCommand: "",
        baseDir: "apps/app-b",
        lifecycle: { setup: "", start: "", stop: "" }
      }
    }
  ]);
  assert.equal(fs.existsSync(path.join(workspaceDir, "apps", "app-b")), false);
  assert.equal(store.getAppBuild({ workspaceId: workspace.id, appId: "app-b" }), null);
  const workspaceYaml = fs.readFileSync(path.join(workspaceDir, "workspace.yaml"), "utf8");
  assert.equal(workspaceYaml.includes("app-b"), false);

  await app.close();
  store.close();
});

test("app setup route does not start duplicate setup for an app already building", async () => {
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
  const workspaceDir = path.join(workspaceRoot, workspace.id);
  const appDir = path.join(workspaceDir, "apps", "app-a");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "app.runtime.yaml"),
    [
      "app_id: app-a",
      "mcp:",
      "  port: 4100",
      "lifecycle:",
      "  setup: 'sleep 1'"
    ].join("\n"),
    "utf8"
  );
  const app = buildTestRuntimeApiServer({ store });

  const first = await app.inject({
    method: "POST",
    url: "/api/v1/apps/app-a/setup",
    payload: { workspace_id: workspace.id }
  });
  const second = await app.inject({
    method: "POST",
    url: "/api/v1/apps/app-a/setup",
    payload: { workspace_id: workspace.id }
  });

  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), {
    app_id: "app-a",
    status: "setup_started",
    detail: "Running: sleep 1",
    ports: {}
  });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json(), {
    app_id: "app-a",
    status: "setup_started",
    detail: "Setup already in progress",
    ports: {}
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const build = store.getAppBuild({ workspaceId: workspace.id, appId: "app-a" });
  assert.equal(build?.status, "completed");

  await app.close();
  store.close();
});

test("internal opencode app bootstrap route starts resolved apps and returns MCP urls", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });
  fs.mkdirSync(path.join(workspaceRoot, "workspace-1", "apps", "app-a"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "workspace-1", "apps", "app-b"), { recursive: true });

  const calls: Array<Record<string, unknown>> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push({ action: "start", ...params });
      return {
        app_id: params.appId,
        status: "started",
        detail: "app started with lifecycle manager",
        ports: { http: params.httpPort ?? 18080, mcp: params.mcpPort ?? 13100 }
      };
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/workspaces/workspace-1/opencode-apps/start",
    payload: {
      workspace_dir: path.join(workspaceRoot, "workspace-1"),
      holaboss_user_id: "user-1",
      resolved_applications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: ["HOLABOSS_USER_ID"],
          start_command: "",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
        },
        {
          app_id: "app-b",
          mcp: { transport: "http-sse", port: 4200, path: "/mcp" },
          health_check: { path: "/ready", timeout_s: 30, interval_s: 2 },
          env_contract: [],
          start_command: "npm run legacy-start",
          base_dir: "apps/app-b",
          lifecycle: { setup: "", start: "", stop: "" }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    applications: [
      {
        app_id: "app-a",
        mcp_url: "http://localhost:13100/mcp",
        timeout_ms: 60000,
        ports: { http: 18080, mcp: 13100 }
      },
      {
        app_id: "app-b",
        mcp_url: "http://localhost:13101/mcp",
        timeout_ms: 30000,
        ports: { http: 18081, mcp: 13101 }
      }
    ]
  });
  assert.deepEqual(calls, [
    {
      action: "start",
      appId: "app-a",
      appDir: path.join(workspaceRoot, "workspace-1", "apps", "app-a"),
      httpPort: 18080,
      mcpPort: 13100,
      holabossUserId: "user-1",
      resolvedApp: {
        appId: "app-a",
        mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
        healthCheck: { path: "/health", timeoutS: 60, intervalS: 5 },
        envContract: ["HOLABOSS_USER_ID"],
        startCommand: "",
        baseDir: "apps/app-a",
        lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
      }
    },
    {
      action: "start",
      appId: "app-b",
      appDir: path.join(workspaceRoot, "workspace-1", "apps", "app-b"),
      httpPort: 18081,
      mcpPort: 13101,
      holabossUserId: "user-1",
      resolvedApp: {
        appId: "app-b",
        mcp: { transport: "http-sse", port: 4200, path: "/mcp" },
        healthCheck: { path: "/ready", timeoutS: 30, intervalS: 2 },
        envContract: [],
        startCommand: "npm run legacy-start",
        baseDir: "apps/app-b",
        lifecycle: { setup: "", start: "", stop: "" }
      }
    }
  ]);

  await app.close();
  store.close();
});

test("internal opencode app bootstrap route rejects base_dir that escapes the workspace", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });

  const calls: Array<Record<string, unknown>> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push({ action: "start", ...params });
      throw new Error("not used");
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/workspaces/workspace-1/opencode-apps/start",
    payload: {
      workspace_dir: path.join(workspaceRoot, "workspace-1"),
      resolved_applications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: [],
          start_command: "",
          base_dir: "../escape",
          lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    detail: "resolved_application.base_dir escapes workspace: '../escape'"
  });
  assert.deepEqual(calls, []);

  await app.close();
  store.close();
});

test("internal opencode app bootstrap route prevalidates all app dirs before starting any apps", async () => {
  const root = makeTempDir("hb-runtime-api-prevalidate-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });
  fs.mkdirSync(path.join(workspaceRoot, "workspace-1", "apps", "app-a"), { recursive: true });

  let startCalls = 0;
  const executor: AppLifecycleExecutorLike = {
    async startApp() {
      startCalls += 1;
      throw new Error("not reached");
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/workspaces/workspace-1/opencode-apps/start",
    payload: {
      workspace_dir: path.join(workspaceRoot, "workspace-1"),
      resolved_applications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: [],
          start_command: "",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
        },
        {
          app_id: "app-b",
          mcp: { transport: "http-sse", port: 4200, path: "/mcp" },
          health_check: { path: "/ready", timeout_s: 30, interval_s: 2 },
          env_contract: [],
          start_command: "",
          base_dir: "../escape",
          lifecycle: { setup: "", start: "npm run other-start", stop: "npm run other-stop" }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    detail: "resolved_application.base_dir escapes workspace: '../escape'"
  });
  assert.equal(startCalls, 0);

  await app.close();
  store.close();
});

test("internal opencode app bootstrap route rejects missing expected workspace dir", async () => {
  const root = makeTempDir("hb-runtime-api-missing-workspace-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });
  fs.rmSync(path.join(workspaceRoot, "workspace-1"), { recursive: true, force: true });

  const calls: Array<Record<string, unknown>> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push({ action: "start", ...params });
      throw new Error("not used");
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/workspaces/workspace-1/opencode-apps/start",
    payload: {
      resolved_applications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: [],
          start_command: "",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    detail: `workspace_dir not found: '${path.join(workspaceRoot, "workspace-1")}'`
  });
  assert.deepEqual(calls, []);

  await app.close();
  store.close();
});

test("internal opencode app bootstrap route rejects unknown workspace ids before startup", async () => {
  const root = makeTempDir("hb-runtime-api-unknown-workspace-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });

  const calls: Array<Record<string, unknown>> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push({ action: "start", ...params });
      throw new Error("not used");
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/workspaces/workspace-unknown/opencode-apps/start",
    payload: {
      workspace_dir: path.join(workspaceRoot, "workspace-unknown"),
      resolved_applications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: [],
          start_command: "",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    detail: "workspace not found"
  });
  assert.deepEqual(calls, []);

  await app.close();
  store.close();
});

test("internal opencode app bootstrap route rejects workspace_dir mismatches before startup", async () => {
  const root = makeTempDir("hb-runtime-api-workspace-mismatch-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });

  const calls: Array<Record<string, unknown>> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push({ action: "start", ...params });
      throw new Error("not used");
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/workspaces/workspace-1/opencode-apps/start",
    payload: {
      workspace_dir: path.join(workspaceRoot, "workspace-other"),
      resolved_applications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: [],
          start_command: "",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    detail: "workspace_dir does not match workspace 'workspace-1'"
  });
  assert.deepEqual(calls, []);

  await app.close();
  store.close();
});

test("internal opencode app bootstrap route rejects duplicate app ids", async () => {
  const root = makeTempDir("hb-runtime-api-dup-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });
  const calls: Array<Record<string, unknown>> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push({ action: "start", ...params });
      throw new Error("not reached");
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/workspaces/workspace-1/opencode-apps/start",
    payload: {
      workspace_dir: path.join(workspaceRoot, "workspace-1"),
      resolved_applications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: [],
          start_command: "",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
        },
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 4200, path: "/mcp" },
          health_check: { path: "/ready", timeout_s: 30, interval_s: 2 },
          env_contract: [],
          start_command: "",
          base_dir: "apps/app-a-2",
          lifecycle: { setup: "", start: "npm run other-start", stop: "npm run other-stop" }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    detail: "resolved_applications contains duplicate app_id 'app-a'"
  });
  assert.deepEqual(calls, []);

  await app.close();
  store.close();
});

test("internal opencode app bootstrap route rejects empty resolved applications", async () => {
  const root = makeTempDir("hb-runtime-api-empty-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });
  const calls: Array<Record<string, unknown>> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push({ action: "start", ...params });
      throw new Error("not reached");
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/workspaces/workspace-1/opencode-apps/start",
    payload: {
      workspace_dir: path.join(workspaceRoot, "workspace-1"),
      resolved_applications: []
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    detail: "resolved_applications must not be empty"
  });
  assert.deepEqual(calls, []);

  await app.close();
  store.close();
});

test("internal opencode app bootstrap route rejects mismatched lifecycle response shape", async () => {
  const root = makeTempDir("hb-runtime-api-mismatch-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });
  const executor: AppLifecycleExecutorLike = {
    async startApp() {
      return {
        app_id: "other-app",
        status: "started",
        detail: "wrong app",
        ports: { http: 18080, mcp: 13100 }
      };
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/internal/workspaces/workspace-1/opencode-apps/start",
    payload: {
      workspace_dir: path.join(workspaceRoot, "workspace-1"),
      resolved_applications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: [],
          start_command: "",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), {
    detail: "opencode bootstrap returned mismatched app id 'other-app' for 'app-a'"
  });

  await app.close();
  store.close();
});

test("lifecycle shutdown route delegates to the lifecycle executor", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "opencode",
    status: "active"
  });
  const workspaceDir = path.join(workspaceRoot, "workspace-1");
  fs.mkdirSync(path.join(workspaceDir, "apps", "app-a"), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "apps", "app-a", "docker-compose.yml"), "services: {}\n", "utf8");
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

  const calls: Array<Record<string, unknown>> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp() {
      throw new Error("not used");
    },
    async stopApp() {
      throw new Error("not used");
    },
    async shutdownAll(params = {}) {
      calls.push({ action: "shutdown", ...params });
      return {
        stopped: ["app-a"],
        failed: ["app-b"]
      };
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/lifecycle/shutdown"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    stopped: ["app-a"],
    failed: ["app-b"]
  });
  assert.deepEqual(calls, [
    {
      action: "shutdown",
      targets: [{ appId: "app-a", appDir: path.join(workspaceDir, "apps", "app-a") }]
    }
  ]);

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
