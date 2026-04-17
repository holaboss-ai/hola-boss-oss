import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";
import yazl from "yazl";
import * as tar from "tar";

import { buildRuntimeApiServer, type BuildRuntimeApiServerOptions } from "./app.js";
import { appLocalNpmCacheDir, buildAppSetupEnv } from "./app-setup-env.js";
import { parseInstalledAppRuntime, writeWorkspaceMcpRegistryEntry, removeWorkspaceMcpRegistryEntry } from "./workspace-apps.js";
import type { AppLifecycleExecutorLike } from "./app-lifecycle-worker.js";
import { FilesystemMemoryService, type MemoryServiceLike } from "./memory.js";
import type { RuntimeConfigServiceLike } from "./runtime-config.js";
import type { RunnerExecutorLike } from "./runner-worker.js";

const tempDirs: string[] = [];
const ORIGINAL_ENV = {
  HB_SANDBOX_ROOT: process.env.HB_SANDBOX_ROOT,
  HOLABOSS_RUNTIME_CONFIG_PATH: process.env.HOLABOSS_RUNTIME_CONFIG_PATH,
};

const MINIMAL_APP_FIXTURE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "__fixtures__",
  "minimal-app.tar.gz",
);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (ORIGINAL_ENV.HB_SANDBOX_ROOT === undefined) {
    delete process.env.HB_SANDBOX_ROOT;
  } else {
    process.env.HB_SANDBOX_ROOT = ORIGINAL_ENV.HB_SANDBOX_ROOT;
  }
  if (ORIGINAL_ENV.HOLABOSS_RUNTIME_CONFIG_PATH === undefined) {
    delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  } else {
    process.env.HOLABOSS_RUNTIME_CONFIG_PATH = ORIGINAL_ENV.HOLABOSS_RUNTIME_CONFIG_PATH;
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function buildTestRuntimeApiServer(options: BuildRuntimeApiServerOptions) {
  return buildRuntimeApiServer({
    queueWorker: null,
    durableMemoryWorker: null,
    cronWorker: null,
    bridgeWorker: null,
    recallEmbeddingBackfillWorker: null,
    enableAppHealthMonitor: false,
    startAppsOnReady: false,
    ...options,
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

test("error handler preserves Fastify statusCode for client errors", async () => {
  const root = makeTempDir("hb-runtime-api-error-handler-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { "content-type": "application/json" },
      payload: "{not json"
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { code?: string; message?: string };
    assert.equal(body.code, "FST_ERR_CTP_INVALID_JSON_BODY");
    assert.ok(typeof body.message === "string" && body.message.length > 0);

    const notFound = await app.inject({
      method: "GET",
      url: "/api/v1/does-not-exist"
    });
    assert.equal(notFound.statusCode, 404);
  } finally {
    await app.close();
    store.close();
  }
});

test("healthz still returns ok when remote bridge is enabled without product auth", async () => {
  const root = makeTempDir("hb-runtime-api-bridge-disabled-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const previousBridge = process.env.PROACTIVE_ENABLE_REMOTE_BRIDGE;
  const previousAuth = process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
  const previousConfigPath = process.env.HOLABOSS_RUNTIME_CONFIG_PATH;

  process.env.PROACTIVE_ENABLE_REMOTE_BRIDGE = "1";
  delete process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
  delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;

  try {
    const app = buildRuntimeApiServer({
      store,
      queueWorker: null,
      cronWorker: null
    });

    const response = await app.inject({ method: "GET", url: "/healthz" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
    await app.close();
  } finally {
    if (previousBridge === undefined) {
      delete process.env.PROACTIVE_ENABLE_REMOTE_BRIDGE;
    } else {
      process.env.PROACTIVE_ENABLE_REMOTE_BRIDGE = previousBridge;
    }
    if (previousAuth === undefined) {
      delete process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
    } else {
      process.env.HOLABOSS_SANDBOX_AUTH_TOKEN = previousAuth;
    }
    if (previousConfigPath === undefined) {
      delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
    } else {
      process.env.HOLABOSS_RUNTIME_CONFIG_PATH = previousConfigPath;
    }
    store.close();
  }
});

test("browser capability routes proxy to the browser tool service", async () => {
  const root = makeTempDir("hb-runtime-api-browser-capability-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const browserToolService = {
    async getStatus(context?: { workspaceId?: string | null; sessionId?: string | null }) {
      return {
        available: true,
        workspace_id: context?.workspaceId ?? null,
        session_id: context?.sessionId ?? null,
        tools: [{ id: "browser_get_state" }]
      };
    },
    async execute(
      toolId: string,
      args: Record<string, unknown>,
      context?: { workspaceId?: string | null; sessionId?: string | null }
    ) {
      return {
        tool_id: toolId,
        workspace_id: context?.workspaceId ?? null,
        session_id: context?.sessionId ?? null,
        args
      };
    }
  };
  const app = buildTestRuntimeApiServer({ store, browserToolService });

  const statusResponse = await app.inject({
    method: "GET",
    url: "/api/v1/capabilities/browser",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
      "x-holaboss-session-id": "session-1"
    }
  });
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(statusResponse.json(), {
    available: true,
    workspace_id: "workspace-1",
    session_id: "session-1",
    tools: [{ id: "browser_get_state" }]
  });

  const executeResponse = await app.inject({
    method: "POST",
    url: "/api/v1/capabilities/browser/tools/browser_click",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
      "x-holaboss-session-id": "session-1"
    },
    payload: {
      index: 3
    }
  });
  assert.equal(executeResponse.statusCode, 200);
  assert.deepEqual(executeResponse.json(), {
    tool_id: "browser_click",
    workspace_id: "workspace-1",
    session_id: "session-1",
    args: {
      index: 3
    }
  });

  await app.close();
  store.close();
});

test("terminal session routes proxy to the terminal session manager", async () => {
  const root = makeTempDir("hb-runtime-api-terminal-sessions-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  let currentSession: any = {
    terminalId: "term-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    inputId: "input-1",
    title: "Dev Server",
    backend: "node_pty",
    owner: "agent",
    status: "running",
    cwd: "/tmp/workspace-1",
    shell: "/bin/bash",
    command: "npm run dev",
    exitCode: null,
    lastEventSeq: 1,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    metadata: { source: "test" }
  };
  const events = [
    {
      id: 1,
      terminalId: "term-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sequence: 1,
      eventType: "started",
      payload: { command: "npm run dev" },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const terminalSessionManager: any = {
    async start() {},
    async close() {},
    async createSession(params: Record<string, unknown>) {
      currentSession = {
        ...currentSession,
        title: String(params.title ?? currentSession.title),
        command: String(params.command ?? currentSession.command),
      };
      return currentSession;
    },
    getSession(params: { terminalId: string; workspaceId?: string }) {
      if (params.terminalId !== currentSession.terminalId) {
        return null;
      }
      if (params.workspaceId && params.workspaceId !== currentSession.workspaceId) {
        return null;
      }
      return currentSession;
    },
    listSessions() {
      return [currentSession];
    },
    listEvents(params: { terminalId: string; afterSequence?: number }) {
      return events.filter((event) => event.terminalId === params.terminalId && event.sequence > (params.afterSequence ?? 0));
    },
    async sendInput() {
      return currentSession;
    },
    async resize() {
      return currentSession;
    },
    async signal() {
      return currentSession;
    },
    async closeSession() {
      currentSession = {
        ...currentSession,
        status: "closed",
      };
      return currentSession;
    },
    subscribe() {
      return () => {};
    },
  };
  const app = buildTestRuntimeApiServer({ store, terminalSessionManager });

  const listResponse = await app.inject({
    method: "GET",
    url: "/api/v1/terminal-sessions?workspace_id=workspace-1",
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json()[0].terminalId, "term-1");

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/v1/terminal-sessions",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
      "x-holaboss-session-id": "session-1",
      "x-holaboss-input-id": "input-1",
    },
    payload: {
      title: "Build",
      command: "npm run build",
    },
  });
  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.json().command, "npm run build");
  assert.equal(createResponse.json().title, "Build");

  const getResponse = await app.inject({
    method: "GET",
    url: "/api/v1/terminal-sessions/term-1?workspace_id=workspace-1",
  });
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json().terminalId, "term-1");

  const eventsResponse = await app.inject({
    method: "GET",
    url: "/api/v1/terminal-sessions/term-1/events?after_sequence=0",
  });
  assert.equal(eventsResponse.statusCode, 200);
  assert.equal(eventsResponse.json().events.length, 1);
  assert.equal(eventsResponse.json().events[0].eventType, "started");

  const closeResponse = await app.inject({
    method: "POST",
    url: "/api/v1/terminal-sessions/term-1/close",
  });
  assert.equal(closeResponse.statusCode, 200);
  assert.equal(closeResponse.json().status, "closed");

  await app.close();
  store.close();
});

test("terminal session stream route replays history and forwards live events", async () => {
  const root = makeTempDir("hb-runtime-api-terminal-ws-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const currentSession: any = {
    terminalId: "term-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    inputId: "input-1",
    title: "Dev Server",
    backend: "node_pty",
    owner: "agent",
    status: "running",
    cwd: "/tmp/workspace-1",
    shell: "/bin/bash",
    command: "npm run dev",
    exitCode: null,
    lastEventSeq: 1,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    metadata: {}
  };
  const historicalEvent = {
    id: 1,
    terminalId: "term-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    sequence: 1,
    eventType: "started",
    payload: { command: "npm run dev" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  let subscriber: any = null;
  const terminalSessionManager: any = {
    async start() {},
    async close() {},
    async createSession() {
      return currentSession;
    },
    getSession() {
      return currentSession;
    },
    listSessions() {
      return [currentSession];
    },
    listEvents() {
      return [historicalEvent];
    },
    async sendInput() {
      return currentSession;
    },
    async resize() {
      return currentSession;
    },
    async signal() {
      return currentSession;
    },
    async closeSession() {
      return currentSession;
    },
    subscribe(_terminalId: string, listener: (event: typeof historicalEvent) => void) {
      subscriber = listener;
      return () => {
        subscriber = null;
      };
    },
  };
  const app = buildTestRuntimeApiServer({ store, terminalSessionManager });
  const baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  const wsUrl = `${String(baseUrl).replace(/^http/, "ws")}/api/v1/terminal-sessions/term-1/stream`;
  const socket = new WebSocket(wsUrl);
  const messages: Array<Record<string, unknown>> = [];
  const waitForMessageCount = async (expectedCount: number) => {
    for (let attempt = 0; attempt < 80 && messages.length < expectedCount; attempt += 1) {
      await sleep(25);
    }
    assert.ok(
      messages.length >= expectedCount,
      `expected at least ${expectedCount} websocket messages, saw ${messages.length}`,
    );
  };

  try {
    socket.addEventListener("message", (event) => {
      messages.push(JSON.parse(String(event.data)) as Record<string, unknown>);
    });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
    });

    await waitForMessageCount(2);
    assert.equal(messages[0]?.type, "connected");
    assert.equal((messages[1]?.event as { eventType?: string })?.eventType, "started");

    if (subscriber) {
      subscriber({
        id: 2,
        terminalId: "term-1",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        sequence: 2,
        eventType: "output",
        payload: { data: "ready\n" },
        createdAt: "2026-01-01T00:00:01.000Z",
      });
    }

    await waitForMessageCount(3);
    assert.equal((messages[2]?.event as { eventType?: string })?.eventType, "output");
  } finally {
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        socket.addEventListener("close", () => resolve(), { once: true });
        socket.close();
      });
    }
    await app.close();
    store.close();
  }
});

test("runtime tools capability routes expose local onboarding and cronjob actions", async () => {
  const root = makeTempDir("hb-runtime-api-runtime-tools-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    onboardingStatus: "pending",
    onboardingSessionId: "session-1"
  });
  const app = buildTestRuntimeApiServer({ store });

  const capabilityStatus = await app.inject({
    method: "GET",
    url: "/api/v1/capabilities/runtime-tools",
    headers: {
      "x-holaboss-workspace-id": "workspace-1"
    }
  });
  assert.equal(capabilityStatus.statusCode, 200);
  assert.equal(capabilityStatus.json().available, true);
  assert.equal(capabilityStatus.json().workspace_id, "workspace-1");
  assert.ok(
    capabilityStatus
      .json()
      .tools.some((tool: { id: string }) => tool.id === "holaboss_onboarding_complete")
  );
  assert.ok(
    capabilityStatus
      .json()
      .tools.some((tool: { id: string }) => tool.id === "image_generate")
  );
  assert.ok(
    capabilityStatus
      .json()
      .tools.some((tool: { id: string }) => tool.id === "write_report")
  );
  assert.ok(
    capabilityStatus
      .json()
      .tools.some((tool: { id: string }) => tool.id === "terminal_session_start")
  );

  const onboardingStatus = await app.inject({
    method: "GET",
    url: "/api/v1/capabilities/runtime-tools/onboarding/status",
    headers: {
      "x-holaboss-workspace-id": "workspace-1"
    }
  });
  assert.equal(onboardingStatus.statusCode, 200);
  assert.equal(onboardingStatus.json().onboarding_status, "pending");

  const onboardingComplete = await app.inject({
    method: "POST",
    url: "/api/v1/capabilities/runtime-tools/onboarding/complete",
    headers: {
      "x-holaboss-workspace-id": "workspace-1"
    },
    payload: {
      summary: "ready to work"
    }
  });
  assert.equal(onboardingComplete.statusCode, 200);
  assert.equal(onboardingComplete.json().onboarding_status, "completed");
  assert.equal(onboardingComplete.json().onboarding_completion_summary, "ready to work");

  const createdJob = await app.inject({
    method: "POST",
    url: "/api/v1/capabilities/runtime-tools/cronjobs",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
      "x-holaboss-session-id": "session-main",
      "x-holaboss-selected-model": "openai/gpt-5.4"
    },
    payload: {
      cron: "0 9 * * *",
      description: "Daily check"
    }
  });
  assert.equal(createdJob.statusCode, 200);
  assert.equal(createdJob.json().initiated_by, "workspace_agent");
  assert.deepEqual(createdJob.json().delivery, {
    mode: "announce",
    channel: "session_run",
    to: null
  });
  assert.equal(createdJob.json().metadata.model, "openai/gpt-5.4");
  assert.equal(createdJob.json().metadata.source_session_id, "session-main");

  const listedJobs = await app.inject({
    method: "GET",
    url: "/api/v1/capabilities/runtime-tools/cronjobs",
    headers: {
      "x-holaboss-workspace-id": "workspace-1"
    }
  });
  assert.equal(listedJobs.statusCode, 200);
  assert.equal(listedJobs.json().count, 1);

  await app.close();
  store.close();
});

test("runtime terminal session tools proxy terminal session manager operations", async () => {
  const root = makeTempDir("hb-runtime-api-runtime-terminal-tools-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace"),
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  fs.mkdirSync(path.join(root, "workspace", "workspace-1"), { recursive: true });

  let currentSession: any = {
    terminalId: "term-1",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    title: "Background task",
    backend: "node_pty",
    owner: "agent",
    status: "running",
    cwd: path.join(root, "workspace", "workspace-1"),
    shell: "/bin/bash",
    command: "npm run dev",
    exitCode: null,
    lastEventSeq: 1,
    createdBy: "runtime_tool",
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    metadata: { origin_type: "runtime_tool" },
  };
  const events: any[] = [
    {
      id: 1,
      terminalId: "term-1",
      workspaceId: "workspace-1",
      sessionId: "session-main",
      sequence: 1,
      eventType: "started",
      payload: { command: "npm run dev" },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  let subscriber: ((event: any) => void) | null = null;
  const terminalSessionManager: any = {
    async start() {},
    async close() {},
    async createSession(params: Record<string, unknown>) {
      currentSession = {
        ...currentSession,
        title: String(params.title ?? currentSession.title),
        command: String(params.command ?? currentSession.command),
        cwd: typeof params.cwd === "string" && params.cwd ? params.cwd : currentSession.cwd,
      };
      return currentSession;
    },
    getSession(params: { terminalId: string; workspaceId?: string }) {
      if (params.terminalId !== currentSession.terminalId) {
        return null;
      }
      if (params.workspaceId && params.workspaceId !== currentSession.workspaceId) {
        return null;
      }
      return currentSession;
    },
    listSessions() {
      return [currentSession];
    },
    listEvents(params: { terminalId: string; afterSequence?: number; limit?: number }) {
      return events
        .filter((event) => event.terminalId === params.terminalId && event.sequence > (params.afterSequence ?? 0))
        .slice(0, params.limit ?? events.length);
    },
    async sendInput() {
      currentSession = {
        ...currentSession,
        lastActivityAt: "2026-01-01T00:00:02.000Z",
      };
      return currentSession;
    },
    async resize() {
      return currentSession;
    },
    async signal() {
      currentSession = {
        ...currentSession,
        status: "failed",
        exitCode: 130,
      };
      return currentSession;
    },
    async closeSession() {
      currentSession = {
        ...currentSession,
        status: "closed",
        endedAt: "2026-01-01T00:00:03.000Z",
      };
      return currentSession;
    },
    subscribe(_terminalId: string, listener: (event: any) => void) {
      subscriber = listener;
      return () => {
        subscriber = null;
      };
    },
  };

  const app = buildTestRuntimeApiServer({ store, terminalSessionManager });

  const listResponse = await app.inject({
    method: "GET",
    url: "/api/v1/capabilities/runtime-tools/terminal-sessions",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
      "x-holaboss-session-id": "session-main",
    },
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().count, 1);
  assert.equal(listResponse.json().sessions[0].terminal_id, "term-1");

  const startResponse = await app.inject({
    method: "POST",
    url: "/api/v1/capabilities/runtime-tools/terminal-sessions",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
      "x-holaboss-session-id": "session-main",
      "x-holaboss-input-id": "input-1",
      "x-holaboss-selected-model": "openai/gpt-5.4",
    },
    payload: {
      title: "Build",
      cwd: "workspace-1",
      command: "npm run build",
    },
  });
  assert.equal(startResponse.statusCode, 200);
  assert.equal(startResponse.json().title, "Build");
  assert.equal(startResponse.json().command, "npm run build");

  const getResponse = await app.inject({
    method: "GET",
    url: "/api/v1/capabilities/runtime-tools/terminal-sessions/term-1",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
    },
  });
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json().terminal_id, "term-1");

  const readResponse = await app.inject({
    method: "POST",
    url: "/api/v1/capabilities/runtime-tools/terminal-sessions/term-1/read",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
    },
    payload: {
      after_sequence: 0,
    },
  });
  assert.equal(readResponse.statusCode, 200);
  assert.equal(readResponse.json().count, 1);
  assert.equal(readResponse.json().events[0].event_type, "started");

  const waitPromise = app.inject({
    method: "POST",
    url: "/api/v1/capabilities/runtime-tools/terminal-sessions/term-1/wait",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
    },
    payload: {
      after_sequence: 1,
      timeout_ms: 250,
    },
  });
  setTimeout(() => {
    const event = {
      id: 2,
      terminalId: "term-1",
      workspaceId: "workspace-1",
      sessionId: "session-main",
      sequence: 2,
      eventType: "output",
      payload: { data: "ready\n" },
      createdAt: "2026-01-01T00:00:01.000Z",
    };
    events.push(event);
    currentSession = {
      ...currentSession,
      lastEventSeq: 2,
      lastActivityAt: "2026-01-01T00:00:01.000Z",
    };
    subscriber?.(event);
  }, 10);
  const waitResponse = await waitPromise;
  assert.equal(waitResponse.statusCode, 200);
  assert.equal(waitResponse.json().timed_out, false);
  assert.equal(waitResponse.json().events[0].event_type, "output");

  const inputResponse = await app.inject({
    method: "POST",
    url: "/api/v1/capabilities/runtime-tools/terminal-sessions/term-1/input",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
    },
    payload: {
      data: "npm test\r",
    },
  });
  assert.equal(inputResponse.statusCode, 200);
  assert.equal(inputResponse.json().terminal_id, "term-1");

  const signalResponse = await app.inject({
    method: "POST",
    url: "/api/v1/capabilities/runtime-tools/terminal-sessions/term-1/signal",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
    },
    payload: {
      signal: "SIGINT",
    },
  });
  assert.equal(signalResponse.statusCode, 200);
  assert.equal(signalResponse.json().status, "failed");

  const closeResponse = await app.inject({
    method: "POST",
    url: "/api/v1/capabilities/runtime-tools/terminal-sessions/term-1/close",
    headers: {
      "x-holaboss-workspace-id": "workspace-1",
    },
    payload: {},
  });
  assert.equal(closeResponse.statusCode, 200);
  assert.equal(closeResponse.json().status, "closed");

  await app.close();
  store.close();
});

test("runtime write_report tool writes a markdown report and persists it as a session output", async () => {
  const root = makeTempDir("hb-runtime-api-report-tools-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.ensureRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    status: "BUSY",
    currentInputId: "input-1",
  });

  const app = buildTestRuntimeApiServer({ store });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities/runtime-tools/reports",
      headers: {
        "x-holaboss-workspace-id": "workspace-1",
        "x-holaboss-session-id": "session-main",
        "x-holaboss-input-id": "input-1",
        "x-holaboss-selected-model": "openai/gpt-5.4",
      },
      payload: {
        title: "Tariff update brief",
        filename: "tariff-update-brief",
        summary: "Short research brief on current tariff developments.",
        content: "# Tariff update brief\n\n- Court challenges are active.\n- Consumer impact remains debated.\n",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().title, "Tariff update brief");
    assert.equal(response.json().file_path, "outputs/reports/tariff-update-brief.md");
    assert.equal(response.json().mime_type, "text/markdown");
    assert.ok(
      fs.existsSync(path.join(workspaceRoot, "workspace-1", "outputs/reports/tariff-update-brief.md")),
    );
    assert.equal(
      fs.readFileSync(
        path.join(workspaceRoot, "workspace-1", "outputs/reports/tariff-update-brief.md"),
        "utf8",
      ),
      "# Tariff update brief\n\n- Court challenges are active.\n- Consumer impact remains debated.\n",
    );

    const outputs = store.listOutputs({
      workspaceId: "workspace-1",
      sessionId: "session-main",
      inputId: "input-1",
      limit: 20,
      offset: 0,
    });
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].title, "Tariff update brief");
    assert.equal(outputs[0].filePath, "outputs/reports/tariff-update-brief.md");
    assert.equal(outputs[0].metadata.artifact_type, "report");
    assert.equal(outputs[0].metadata.origin_type, "runtime_tool");
    assert.equal(outputs[0].metadata.tool_id, "write_report");
    assert.equal(outputs[0].metadata.model, "openai/gpt-5.4");
  } finally {
    await app.close();
    store.close();
  }
});

test("runtime image generation tool writes a generated image into the workspace", async () => {
  const root = makeTempDir("hb-runtime-api-image-tools-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });

  const configPath = path.join(root, "state", "runtime-config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({
      runtime: {
        image_generation: {
          provider: "openai_direct",
          model: "gpt-image-1.5",
        },
      },
      providers: {
        openai_direct: {
          kind: "openai_compatible",
          base_url: "https://api.openai.com/v1",
          api_key: "sk-openai",
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  process.env.HB_SANDBOX_ROOT = root;
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;

  const originalFetch = globalThis.fetch;
  let recordedRequestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input, init) => {
    recordedRequestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yJ3sAAAAASUVORK5CYII=",
            revised_prompt: "A tiny generated test image",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const app = buildTestRuntimeApiServer({ store });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities/runtime-tools/images/generate",
      headers: {
        "x-holaboss-workspace-id": "workspace-1",
        "x-holaboss-session-id": "session-main",
        "x-holaboss-selected-model": "openai_direct/gpt-5.4",
      },
      payload: {
        prompt: "Generate a tiny test image",
        filename: "sample-output",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.ok(recordedRequestBody);
    assert.equal(recordedRequestBody["model"], "gpt-image-1.5");
    assert.equal(recordedRequestBody["prompt"], "Generate a tiny test image");
    assert.ok(!Object.hasOwn(recordedRequestBody, "response_format"));
    assert.equal(response.json().file_path, "outputs/images/sample-output.png");
    assert.equal(response.json().provider_id, "openai_direct");
    assert.equal(response.json().model_id, "gpt-image-1.5");
    assert.ok(
      fs.existsSync(path.join(workspaceRoot, "workspace-1", "outputs/images/sample-output.png")),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    store.close();
  }
});

test("runtime image generation tool uses native Gemini image generation for gemini_direct", async () => {
  const root = makeTempDir("hb-runtime-api-gemini-image-tools-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });

  const configPath = path.join(root, "state", "runtime-config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({
      runtime: {
        image_generation: {
          provider: "gemini_direct",
          model: "gemini-3.1-flash-image-preview",
        },
      },
      providers: {
        gemini_direct: {
          kind: "openai_compatible",
          base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
          api_key: "gemini-key",
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  process.env.HB_SANDBOX_ROOT = root;
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;

  const originalFetch = globalThis.fetch;
  let recordedUrl = "";
  let recordedHeaders: Record<string, string> | null = null;
  let recordedRequestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input, init) => {
    recordedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    recordedHeaders = init?.headers && !Array.isArray(init.headers)
      ? Object.fromEntries(Object.entries(init.headers as Record<string, string>))
      : null;
    recordedRequestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "A tiny generated Gemini test image" },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yJ3sAAAAASUVORK5CYII=",
                  },
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const app = buildTestRuntimeApiServer({ store });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities/runtime-tools/images/generate",
      headers: {
        "x-holaboss-workspace-id": "workspace-1",
        "x-holaboss-session-id": "session-main",
        "x-holaboss-selected-model": "gemini_direct/gemini-2.5-flash",
      },
      payload: {
        prompt: "Generate a tiny Gemini test image",
        filename: "gemini-sample-output",
        size: "1024x1024",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      recordedUrl,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
    );
    assert.ok(recordedHeaders);
    assert.equal(recordedHeaders["x-goog-api-key"], "gemini-key");
    assert.ok(recordedRequestBody);
    assert.deepEqual(recordedRequestBody, {
      contents: [
        {
          role: "user",
          parts: [{ text: "Generate a tiny Gemini test image" }],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K",
        },
      },
    });
    assert.equal(response.json().file_path, "outputs/images/gemini-sample-output.png");
    assert.equal(response.json().provider_id, "gemini_direct");
    assert.equal(response.json().model_id, "gemini-3.1-flash-image-preview");
    assert.ok(
      fs.existsSync(path.join(workspaceRoot, "workspace-1", "outputs/images/gemini-sample-output.png")),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    store.close();
  }
});

test("runtime image generation tool uses OpenRouter chat image generation for openrouter_direct", async () => {
  const root = makeTempDir("hb-runtime-api-openrouter-image-tools-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });

  const configPath = path.join(root, "state", "runtime-config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({
      runtime: {
        image_generation: {
          provider: "openrouter_direct",
          model: "google/gemini-3.1-flash-image-preview",
        },
      },
      providers: {
        openrouter_direct: {
          kind: "openrouter",
          base_url: "https://openrouter.ai/api/v1",
          api_key: "sk-or-test",
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  process.env.HB_SANDBOX_ROOT = root;
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;

  const originalFetch = globalThis.fetch;
  let recordedUrl = "";
  let recordedRequestBody: Record<string, unknown> | null = null;
  let recordedHeaders: Record<string, string> | null = null;
  globalThis.fetch = (async (input, init) => {
    recordedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    recordedRequestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    recordedHeaders =
      init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
        ? Object.fromEntries(Object.entries(init.headers as Record<string, string>))
        : null;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Here is your image.",
              images: [
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yJ3sAAAAASUVORK5CYII=",
                  },
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const app = buildTestRuntimeApiServer({ store });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities/runtime-tools/images/generate",
      headers: {
        "x-holaboss-workspace-id": "workspace-1",
        "x-holaboss-session-id": "session-main",
        "x-holaboss-selected-model": "openrouter_direct/openai/gpt-5.4",
      },
      payload: {
        prompt: "Generate a Nano Banana 2 style image",
        filename: "openrouter-sample-output",
        size: "1024x1024",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(recordedUrl, "https://openrouter.ai/api/v1/chat/completions");
    assert.ok(recordedRequestBody);
    assert.deepEqual(recordedHeaders, {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-or-test",
      "HTTP-Referer": "https://holaboss.ai",
      "X-OpenRouter-Title": "holaOS",
      "X-OpenRouter-Categories": "personal-agent,general-chat",
    });
    assert.deepEqual(recordedRequestBody, {
      model: "google/gemini-3.1-flash-image-preview",
      messages: [
        {
          role: "user",
          content: "Generate a Nano Banana 2 style image",
        },
      ],
      modalities: ["image", "text"],
      image_config: {
        aspect_ratio: "1:1",
        image_size: "1K",
      },
    });
    assert.equal(response.json().file_path, "outputs/images/openrouter-sample-output.png");
    assert.equal(response.json().provider_id, "openrouter_direct");
    assert.equal(response.json().model_id, "google/gemini-3.1-flash-image-preview");
    assert.ok(
      fs.existsSync(path.join(workspaceRoot, "workspace-1", "outputs/images/openrouter-sample-output.png")),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    store.close();
  }
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
        default_model: "openai/gpt-5.4",
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
        harness: "pi",
        config_loaded: true,
        config_path: "/tmp/runtime-config.json",
        backend_config_present: true,
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
        default_model: "openai/gpt-5.4",
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
      default_model: "openai/gpt-5.4"
    }
  });

  assert.equal(config.statusCode, 200);
  assert.equal(status.statusCode, 200);
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(calls, [
    "get-config",
    "get-status",
    "put-config:{\"auth_token\":\"token-1\",\"user_id\":\"user-1\",\"sandbox_id\":\"sandbox-1\",\"model_proxy_base_url\":\"https://runtime.example/api/v1/model-proxy\",\"default_model\":\"openai/gpt-5.4\"}"
  ]);

  await app.close();
  store.close();
});

test("runtime profile routes persist canonical name and apply auth fallback only when empty", async () => {
  const root = makeTempDir("hb-runtime-api-profile-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const initial = await app.inject({
    method: "GET",
    url: "/api/v1/runtime/profile"
  });
  const fallback = await app.inject({
    method: "POST",
    url: "/api/v1/runtime/profile/auth-fallback",
    payload: {
      name: "Jeffrey"
    }
  });
  const manual = await app.inject({
    method: "PUT",
    url: "/api/v1/runtime/profile",
    payload: {
      name: "Jeff",
      name_source: "manual"
    }
  });
  const preserved = await app.inject({
    method: "POST",
    url: "/api/v1/runtime/profile/auth-fallback",
    payload: {
      name: "Ignored Auth Name"
    }
  });

  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.json(), {
    profile_id: "default",
    name: null,
    name_source: null,
    created_at: null,
    updated_at: null,
  });
  assert.equal(fallback.statusCode, 200);
  assert.equal(fallback.json().name, "Jeffrey");
  assert.equal(fallback.json().name_source, "auth_fallback");
  assert.equal(manual.statusCode, 200);
  assert.equal(manual.json().name, "Jeff");
  assert.equal(manual.json().name_source, "manual");
  assert.equal(preserved.statusCode, 200);
  assert.equal(preserved.json().name, "Jeff");
  assert.equal(preserved.json().name_source, "manual");

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
    },
    async capture(payload) {
      calls.push({ operation: "capture", payload });
      return { workspace_id: payload.workspace_id, files: {} };
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

test("proactive context capture route returns the bundled workspace context", async () => {
  const previousUserId = process.env.HOLABOSS_USER_ID;
  process.env.HOLABOSS_USER_ID = "user-1";

  const root = makeTempDir("hb-runtime-api-proactive-context-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace One",
    harness: "pi",
    status: "active"
  });
  const workspaceDir = store.workspaceDir("workspace-1");
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    [
      "applications:",
      "  - app_id: twitter",
      "mcp_registry:",
      "  allowlist:",
      "    tool_ids:",
      "      - twitter.performance",
    ].join("\n"),
    "utf8"
  );

  const app = buildTestRuntimeApiServer({ store });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/proactive/context/capture",
      payload: {
        workspace_id: "workspace-1"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { context: Record<string, unknown> };
    const context = body.context;
    const workspace = context.workspace as Record<string, unknown>;
    const snapshot = context.snapshot as Record<string, unknown>;
    assert.equal(workspace.id, "workspace-1");
    assert.equal(workspace.holaboss_user_id, "user-1");
    assert.equal(snapshot.workspace_id, "workspace-1");
    assert.deepEqual(snapshot.applications, ["twitter"]);
    assert.deepEqual(snapshot.mcp_tool_ids, ["twitter.performance"]);
    assert.equal(typeof context.captured_at, "string");
  } finally {
    await app.close();
    store.close();
    if (previousUserId === undefined) {
      delete process.env.HOLABOSS_USER_ID;
    } else {
      process.env.HOLABOSS_USER_ID = previousUserId;
    }
  }
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
      harness: "pi",
      status: "provisioning"
    }
  });
  assert.equal(created.statusCode, 200);
  const workspace = created.json().workspace as { id: string };
  const workspaceDir = store.workspaceDir(workspace.id);
  assert.equal(fs.existsSync(workspaceDir), true);

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
  assert.equal(fs.existsSync(workspaceDir), false);

  await app.close();
  store.close();
});

test("workspace delete stops installed apps and clears local workspace files", async () => {
  const root = makeTempDir("hb-runtime-api-delete-workspace-cleanup-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  const appId = "app-a";
  const appDir = path.join(workspaceDir, "apps", appId);
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    `applications:\n  - app_id: ${appId}\n    config_path: apps/${appId}/app.runtime.yaml\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(appDir, "app.runtime.yaml"),
    [
      `app_id: ${appId}`,
      "mcp:",
      "  transport: http-sse",
      "  port: 4100",
      "  path: /mcp",
      "healthchecks:",
      "  mcp:",
      "    path: /health",
      "    timeout_s: 60",
      "    interval_s: 5",
      "lifecycle:",
      "  setup: ''",
      "  start: npm run start",
      "  stop: npm run stop"
    ].join("\n"),
    "utf8"
  );
  store.upsertAppBuild({ workspaceId: workspace.id, appId, status: "running" });
  store.allocateAppPort({ workspaceId: workspace.id, appId: `${appId}__http` });
  store.allocateAppPort({ workspaceId: workspace.id, appId: `${appId}__mcp` });
  assert.equal(store.listAppPorts({ workspaceId: workspace.id }).length, 2);

  const stopCalls: Array<{ appId: string; appDir?: string; hasResolvedApp: boolean }> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp() {
      throw new Error("not used");
    },
    async stopApp(params) {
      stopCalls.push({
        appId: params.appId,
        appDir: params.appDir,
        hasResolvedApp: Boolean(params.resolvedApp)
      });
      return {
        app_id: params.appId,
        status: "stopped",
        detail: "stopped",
        ports: {}
      };
    },
    async shutdownAll() {
      throw new Error("not used");
    }
  };
  const app = buildTestRuntimeApiServer({ store, appLifecycleExecutor: executor });

  const deleted = await app.inject({ method: "DELETE", url: `/api/v1/workspaces/${workspace.id}` });

  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().workspace.status, "deleted");
  assert.equal(stopCalls.length, 1);
  assert.deepEqual(stopCalls[0], {
    appId,
    appDir,
    hasResolvedApp: true
  });
  assert.equal(store.getAppBuild({ workspaceId: workspace.id, appId }), null);
  assert.equal(store.listAppPorts({ workspaceId: workspace.id }).length, 0);
  assert.equal(fs.existsSync(workspaceDir), false);
  const deletedWorkspace = store.getWorkspace(workspace.id, { includeDeleted: true });
  assert.ok(deletedWorkspace);
  assert.equal(deletedWorkspace.status, "deleted");
  assert.ok(deletedWorkspace.deletedAtUtc);

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
    harness: "pi",
    status: "active",
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "pi",
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
  store.upsertTurnResult({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    status: "completed",
    stopReason: "ok",
    assistantText: "hi",
    toolUsageSummary: {
      total_calls: 1,
      completed_calls: 1,
      failed_calls: 0,
      tool_names: ["read_file"],
      tool_ids: []
    },
    permissionDenials: [],
    promptSectionIds: ["runtime_core", "execution_policy"],
    capabilityManifestFingerprint: "b".repeat(64),
    requestSnapshotFingerprint: "c".repeat(64),
    promptCacheProfile: {
      cacheable_section_ids: ["runtime_core"],
      volatile_section_ids: ["execution_policy"],
    },
    compactedSummary: null,
    compactionBoundaryId: "compaction:input-1",
    tokenUsage: {
      input_tokens: 10,
      output_tokens: 20
    }
  });
  store.upsertTurnRequestSnapshot({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    snapshotKind: "harness_host_request",
    fingerprint: "c".repeat(64),
    payload: {
      provider_id: "openai",
      model_id: "gpt-5.4",
      system_prompt: "You are concise.",
    },
  });
  store.upsertCompactionBoundary({
    boundaryId: "compaction:input-1",
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    summary: "hi",
    recentRuntimeContext: {
      summary: "hi",
      last_stop_reason: "ok",
      last_error: null,
      waiting_for_user: null,
    },
    restorationContext: {
      compaction_source: "executor_post_turn",
      restoration_order: [
        "boundary_summary",
        "recent_runtime_context",
        "session_resume_context",
        "preserved_turn_input_ids",
        "restored_memory_paths",
      ],
      session_resume_context: {
        recent_turns: [
          {
            input_id: "input-1",
            status: "completed",
            stop_reason: "ok",
            summary: "hi",
            completed_at: "2026-01-01T00:00:05.000Z",
          },
        ],
        recent_user_messages: ["hello"],
      },
      restored_memory_paths: [`workspace/${workspace.id}/runtime/latest-turn.md`],
    },
    preservedTurnInputIds: ["input-1"],
    requestSnapshotFingerprint: "c".repeat(64),
  });
  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "proposal-session-1",
    kind: "task_proposal",
    title: "Follow up",
    parentSessionId: "session-main",
    sourceProposalId: "proposal-1",
    createdBy: "workspace_user"
  });
  store.ensureRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main",
    status: "IDLE",
  });

  const sessions = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions?workspace_id=${workspace.id}`
  });
  const states = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/by-workspace/${workspace.id}/runtime-states`
  });
  const history = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/history?workspace_id=${workspace.id}`
  });
  const turnResults = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/turn-results?workspace_id=${workspace.id}`
  });
  const requestSnapshots = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/request-snapshots?workspace_id=${workspace.id}`
  });
  const compactionBoundaries = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/compaction-boundaries?workspace_id=${workspace.id}`
  });
  const resumeContext = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/resume-context?workspace_id=${workspace.id}&input_id=input-2`
  });

  assert.equal(sessions.statusCode, 200);
  assert.equal(sessions.json().count, 2);
  const proposalSession = sessions
    .json()
    .items.find((item: { session_id: string }) => item.session_id === "proposal-session-1");
  assert.ok(proposalSession);
  assert.equal(proposalSession.kind, "task_proposal");
  assert.equal(proposalSession.parent_session_id, "session-main");
  assert.equal(states.statusCode, 200);
  assert.equal(states.json().count, 1);
  assert.equal(states.json().items[0].session_id, "session-main");
  assert.equal(states.json().items[0].status, "IDLE");
  assert.equal(states.json().items[0].effective_state, "IDLE");
  assert.equal(states.json().items[0].has_queued_inputs, false);
  assert.equal(states.json().items[0].last_turn_status, "completed");
  assert.equal(states.json().items[0].last_turn_completed_at, "2026-01-01T00:00:05.000Z");
  assert.equal(states.json().items[0].last_turn_stop_reason, "ok");
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().source, "sandbox_local_storage");
  assert.equal(history.json().harness, "pi");
  assert.deepEqual(
    history.json().messages.map((item: { role: string }) => item.role),
    ["user", "assistant"]
  );
  assert.equal(turnResults.statusCode, 200);
  assert.equal(turnResults.json().count, 1);
  assert.equal(turnResults.json().items[0].input_id, "input-1");
  assert.equal(turnResults.json().items[0].status, "completed");
  assert.equal(turnResults.json().items[0].stop_reason, "ok");
  assert.equal(turnResults.json().items[0].capability_manifest_fingerprint, "b".repeat(64));
  assert.equal(turnResults.json().items[0].request_snapshot_fingerprint, "c".repeat(64));
  assert.deepEqual(turnResults.json().items[0].prompt_cache_profile, {
    cacheable_section_ids: ["runtime_core"],
    volatile_section_ids: ["execution_policy"],
  });
  assert.equal(turnResults.json().items[0].compaction_boundary_id, "compaction:input-1");
  assert.deepEqual(turnResults.json().items[0].prompt_section_ids, [
    "runtime_core",
    "execution_policy"
  ]);
  assert.deepEqual(turnResults.json().items[0].token_usage, {
    input_tokens: 10,
    output_tokens: 20
  });
  assert.equal(requestSnapshots.statusCode, 200);
  assert.equal(requestSnapshots.json().count, 1);
  assert.equal(requestSnapshots.json().items[0].fingerprint, "c".repeat(64));
  assert.equal(compactionBoundaries.statusCode, 200);
  assert.equal(compactionBoundaries.json().count, 1);
  assert.equal(compactionBoundaries.json().items[0].boundary_id, "compaction:input-1");
  assert.equal(compactionBoundaries.json().items[0].boundary_type, "executor_post_turn");
  assert.deepEqual(compactionBoundaries.json().items[0].compaction_restoration_context, {
    compaction_source: "executor_post_turn",
    boundary_type: "executor_post_turn",
    restoration_order: [
      "boundary_summary",
      "recent_runtime_context",
      "session_resume_context",
      "preserved_turn_input_ids",
      "restored_memory_paths",
    ],
    boundary_summary: "hi",
    recent_runtime_context: {
      summary: "hi",
      last_stop_reason: "ok",
      last_error: null,
      waiting_for_user: null,
    },
    session_resume_context: {
      recent_turns: [
        {
          input_id: "input-1",
          status: "completed",
          stop_reason: "ok",
          summary: "hi",
          completed_at: "2026-01-01T00:00:05.000Z",
        },
      ],
      recent_user_messages: ["hello"],
    },
    preserved_turn_input_ids: ["input-1"],
    restored_memory_paths: [`workspace/${workspace.id}/runtime/latest-turn.md`],
  });
  assert.equal(resumeContext.statusCode, 200);
  assert.deepEqual(resumeContext.json().compaction_restoration_context, {
    compaction_source: "executor_post_turn",
    boundary_type: "executor_post_turn",
    restoration_order: [
      "boundary_summary",
      "recent_runtime_context",
      "session_resume_context",
      "preserved_turn_input_ids",
      "restored_memory_paths",
    ],
    boundary_summary: "hi",
    recent_runtime_context: {
      summary: "hi",
      last_stop_reason: "ok",
      last_error: null,
      waiting_for_user: null
    },
    session_resume_context: {
      recent_turns: [
        {
          input_id: "input-1",
          status: "completed",
          stop_reason: "ok",
          summary: "hi",
          completed_at: "2026-01-01T00:00:05.000Z"
        }
      ],
      recent_user_messages: ["hello"]
    },
    preserved_turn_input_ids: ["input-1"],
    restored_memory_paths: [`workspace/${workspace.id}/runtime/latest-turn.md`]
  });
  assert.deepEqual(resumeContext.json().recent_runtime_context, {
    summary: "hi",
    last_stop_reason: "ok",
    last_error: null,
    waiting_for_user: null
  });
  assert.deepEqual(resumeContext.json().session_resume_context, {
    recent_turns: [
      {
        input_id: "input-1",
        status: "completed",
        stop_reason: "ok",
        summary: "hi",
        completed_at: "2026-01-01T00:00:05.000Z"
      }
    ],
    recent_user_messages: ["hello"],
    compaction_source: "executor_post_turn",
    compaction_boundary_id: "compaction:input-1",
    compaction_boundary_summary: "hi",
    restoration_order: [
      "boundary_summary",
      "recent_runtime_context",
      "session_resume_context",
      "preserved_turn_input_ids",
      "restored_memory_paths"
    ],
    preserved_turn_input_ids: ["input-1"],
    restored_memory_paths: [`workspace/${workspace.id}/runtime/latest-turn.md`]
  });

  await app.close();
  store.close();
});

test("history endpoint paginates in requested order without hydrating the full response page", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "pi",
    harnessSessionId: "harness-1"
  });
  store.insertSessionMessage({
    workspaceId: workspace.id,
    sessionId: "session-main",
    role: "user",
    text: "first",
    messageId: "m-1",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  store.insertSessionMessage({
    workspaceId: workspace.id,
    sessionId: "session-main",
    role: "assistant",
    text: "second",
    messageId: "m-2",
    createdAt: "2026-01-01T00:00:01.000Z"
  });
  store.insertSessionMessage({
    workspaceId: workspace.id,
    sessionId: "session-main",
    role: "user",
    text: "third",
    messageId: "m-3",
    createdAt: "2026-01-01T00:00:02.000Z"
  });

  const history = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/history?workspace_id=${workspace.id}&order=desc&limit=2&offset=1`
  });

  assert.equal(history.statusCode, 200);
  assert.equal(history.json().count, 2);
  assert.equal(history.json().total, 3);
  assert.equal(history.json().limit, 2);
  assert.equal(history.json().offset, 1);
  assert.deepEqual(
    history.json().messages.map((item: { id: string }) => item.id),
    ["m-2", "m-1"],
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
    harness: "pi",
    status: "active",
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
    eventType: "pi_native_event",
    payload: { native_type: "message_update", native_event: { type: "message_update" } }
  });
  store.appendOutputEvent({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    sequence: 3,
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
  const withNative = await app.inject({
    method: "GET",
    url: "/api/v1/agent-sessions/session-main/outputs/events?input_id=input-1&after_event_id=0&include_native=true"
  });

  assert.equal(incremental.statusCode, 200);
  assert.equal(incremental.json().count, 1);
  assert.equal(incremental.json().items[0].event_type, "output_delta");
  assert.equal(incremental.json().last_event_id, incremental.json().items[0].id);

  assert.equal(tailed.statusCode, 200);
  assert.equal(tailed.json().count, 0);
  assert.ok(tailed.json().last_event_id >= 3);

  assert.equal(withNative.statusCode, 200);
  assert.deepEqual(
    withNative
      .json()
      .items.map((item: { event_type: string }) => item.event_type),
    ["run_started", "pi_native_event", "output_delta"]
  );

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
    harness: "pi",
    status: "active",
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
    eventType: "pi_native_event",
    payload: { native_type: "message_update", native_event: { type: "message_update" } }
  });
  store.appendOutputEvent({
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    sequence: 3,
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
  assert.doesNotMatch(body, /event: pi_native_event/);

  const responseWithNative = await app.inject({
    method: "GET",
    url: "/api/v1/agent-sessions/session-main/outputs/stream?input_id=input-1&include_native=true"
  });

  assert.equal(responseWithNative.statusCode, 200);
  assert.match(responseWithNative.body, /event: pi_native_event/);

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
    harness: "pi",
    status: "active",
  });
  store.ensureRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main",
    status: "BUSY",
    currentInputId: "input-1",
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
      session_id: "session-main",
      input_id: "input-1",
      status: "completed",
    }
  });
  assert.equal(outputResp.statusCode, 200);
  assert.equal(outputResp.json().output.folder_id, folder.id);
  assert.equal(outputResp.json().output.input_id, "input-1");

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
  assert.ok(typeof artifactResp.json().artifact.output_id === "string");

  const outputsResp = await app.inject({
    method: "GET",
    url: `/api/v1/outputs?workspace_id=${workspace.id}`
  });
  const filteredOutputsResp = await app.inject({
    method: "GET",
    url: `/api/v1/outputs?workspace_id=${workspace.id}&session_id=session-main&input_id=input-1`
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
  assert.equal(filteredOutputsResp.statusCode, 200);
  assert.equal(countsResp.statusCode, 200);
  assert.equal(artifactsResp.statusCode, 200);
  assert.equal(withArtifactsResp.statusCode, 200);
  assert.equal(outputsResp.json().items.length, 2);
  assert.equal(filteredOutputsResp.json().items.length, 2);
  assert.deepEqual(
    filteredOutputsResp.json().items.map((item: { input_id: string | null }) => item.input_id),
    ["input-1", "input-1"]
  );
  assert.equal(countsResp.json().total, 2);
  assert.equal(artifactsResp.json().count, 2);
  assert.ok(
    artifactsResp.json().items.some((item: { external_id: string }) => item.external_id === "doc-1")
  );
  assert.equal(withArtifactsResp.json().items[0].artifacts.length, 2);
  assert.ok(
    withArtifactsResp.json().items[0].artifacts.some(
      (item: { external_id: string }) => item.external_id === "doc-1"
    )
  );

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
    harness: "pi",
    status: "active",
  });
  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "session-main",
    kind: "workspace_session",
    title: "Workspace 1",
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "pi",
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
      instruction: "Say hello",
      delivery: { mode: "announce", channel: "session_run", to: null }
    }
  });
  assert.equal(createdJob.statusCode, 200);
  assert.equal(createdJob.json().instruction, "Say hello");
  const jobId = createdJob.json().id as string;

  const listedJobs = await app.inject({
    method: "GET",
    url: `/api/v1/cronjobs?workspace_id=${workspace.id}`
  });
  const runNowJob = await app.inject({
    method: "POST",
    url: `/api/v1/cronjobs/${jobId}/run`
  });
  const updatedJob = await app.inject({
    method: "PATCH",
    url: `/api/v1/cronjobs/${jobId}`,
    payload: { description: "Updated check", instruction: "Say hello louder" }
  });
  assert.equal(listedJobs.statusCode, 200);
  assert.equal(listedJobs.json().count, 1);
  assert.equal(runNowJob.statusCode, 200);
  assert.equal(runNowJob.json().success, true);
  assert.equal(runNowJob.json().cronjob.id, jobId);
  assert.equal(runNowJob.json().cronjob.instruction, "Say hello");
  assert.ok(runNowJob.json().session_id);
  assert.equal(updatedJob.statusCode, 200);
  assert.equal(updatedJob.json().description, "Updated check");
  assert.equal(updatedJob.json().instruction, "Say hello louder");

  const createdNotification = store.createRuntimeNotification({
    workspaceId: workspace.id,
    cronjobId: jobId,
    sourceType: "cronjob",
    sourceLabel: workspace.name,
    title: "Drink Water",
    message: "Time to drink water.",
    level: "info"
  });
  const listedNotifications = await app.inject({
    method: "GET",
    url: `/api/v1/notifications?workspace_id=${workspace.id}`
  });
  const updatedNotification = await app.inject({
    method: "PATCH",
    url: `/api/v1/notifications/${createdNotification.id}`,
    payload: { state: "read" }
  });
  assert.equal(listedNotifications.statusCode, 200);
  assert.equal(listedNotifications.json().count, 1);
  assert.ok(
    listedNotifications
      .json()
      .items.some((item: { id: string; title: string }) => item.id === createdNotification.id && item.title === "Drink Water")
  );
  assert.equal(updatedNotification.statusCode, 200);
  assert.equal(updatedNotification.json().state, "read");
  assert.ok(updatedNotification.json().read_at);

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
  assert.equal(createdProposal.json().proposal.proposal_source, "proactive");

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
  assert.equal(updatedProposal.json().proposal.proposal_source, "proactive");

  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "session-main",
    kind: "main",
    title: "Main"
  });
  store.createMemoryUpdateProposal({
    proposalId: "memory-proposal-1",
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-1",
    proposalKind: "preference",
    targetKey: "response-style",
    title: "Response style preference",
    summary: "Prefer concise responses.",
    payload: {
      preference_type: "response_style",
      style: "concise",
    },
    evidence: "Please keep responses concise.",
    confidence: 0.99,
    sourceMessageId: "user-input-1",
    createdAt: "2026-04-03T10:00:00.000Z"
  });

  const listedMemoryProposals = await app.inject({
    method: "GET",
    url: `/api/v1/memory-update-proposals?workspace_id=${workspace.id}&session_id=session-main`
  });
  const acceptedMemoryProposal = await app.inject({
    method: "POST",
    url: "/api/v1/memory-update-proposals/memory-proposal-1/accept",
    payload: {
      summary: "Prefer concise responses."
    }
  });
  const dismissedMemoryProposal = await app.inject({
    method: "POST",
    url: "/api/v1/memory-update-proposals/memory-proposal-1/dismiss",
    payload: {}
  });

  assert.equal(listedMemoryProposals.statusCode, 200);
  assert.equal(listedMemoryProposals.json().count, 1);
  assert.equal(acceptedMemoryProposal.statusCode, 200);
  assert.equal(acceptedMemoryProposal.json().proposal.state, "accepted");
  assert.equal(acceptedMemoryProposal.json().proposal.persisted_memory_id, "user-preference:response-style");
  assert.equal(store.getMemoryEntry({ memoryId: "user-preference:response-style" })?.summary, "Prefer concise responses.");
  assert.equal(dismissedMemoryProposal.statusCode, 409);

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
      harness: "pi",
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
      harness: "pi",
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
      harness: "pi",
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
      harness: "pi",
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
      harness: "pi",
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
    harness: "pi",
    status: "active"
  });
  store.upsertAppBuild({
    workspaceId: workspace.id,
    appId: "app-b",
    status: "completed"
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
    payload: { workspace_id: workspace.id, holaboss_user_id: "user-1" }
  });

  assert.equal(started.statusCode, 200);
  assert.deepEqual(started.json(), {
    app_id: "app-b",
    status: "started",
    detail: "app started with lifecycle manager",
    ports: { http: 18081, mcp: 13101 }
  });
  assert.equal(store.getAppBuild({ workspaceId: workspace.id, appId: "app-b" })?.status, "running");

  const stopped = await app.inject({
    method: "POST",
    url: "/api/v1/apps/app-b/stop",
    payload: { workspace_id: workspace.id }
  });
  assert.equal(stopped.statusCode, 200);
  assert.deepEqual(stopped.json(), {
    app_id: "app-b",
    status: "stopped",
    detail: "app stopped via lifecycle manager",
    ports: {}
  });
  assert.equal(store.getAppBuild({ workspaceId: workspace.id, appId: "app-b" })?.status, "stopped");

  const uninstalled = await app.inject({
    method: "DELETE",
    url: "/api/v1/apps/app-b",
    payload: { workspace_id: workspace.id }
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
      holabossUserId: "user-1",
      workspaceId: "workspace-1",
      skipSetup: true,
      resolvedApp: {
        appId: "app-b",
        mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
        mcpTools: [],
        healthCheck: { path: "/health", timeoutS: 60, intervalS: 5 },
        envContract: [],
        integrations: undefined,
        startCommand: "",
        baseDir: "apps/app-b",
        lifecycle: { setup: "", start: "", stop: "" }
      }
    },
    {
      action: "stop",
      appId: "app-b",
      appDir: path.join(workspaceDir, "apps", "app-b"),
      workspaceId: "workspace-1",
      resolvedApp: {
        appId: "app-b",
        mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
        mcpTools: [],
        healthCheck: { path: "/health", timeoutS: 60, intervalS: 5 },
        envContract: [],
        integrations: undefined,
        startCommand: "",
        baseDir: "apps/app-b",
        lifecycle: { setup: "", start: "", stop: "" }
      }
    },
    {
      action: "stop",
      appId: "app-b",
      appDir: path.join(workspaceDir, "apps", "app-b"),
      workspaceId: "workspace-1",
      resolvedApp: {
        appId: "app-b",
        mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
        mcpTools: [],
        healthCheck: { path: "/health", timeoutS: 60, intervalS: 5 },
        envContract: [],
        integrations: undefined,
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

test("app start queues lifecycle setup apps in background", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
    status: "active"
  });

  const workspaceDir = path.join(workspaceRoot, workspace.id);
  fs.mkdirSync(path.join(workspaceDir, "apps", "app-a"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "apps", "app-a", "app.runtime.yaml"),
    [
      "app_id: app-a",
      "mcp:",
      "  port: 4100",
      "healthchecks:",
      "  mcp:",
      "    path: /health",
      "    timeout_s: 30",
      "lifecycle:",
      "  setup: npm install",
      "  start: npm run start"
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    [
      "applications:",
      "  - app_id: app-a",
      "    config_path: apps/app-a/app.runtime.yaml"
    ].join("\n"),
    "utf8"
  );

  const calls: Array<Record<string, unknown>> = [];
  const executor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push({ action: "start", ...params });
      await new Promise((resolve) => setTimeout(resolve, 50));
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

  const started = await app.inject({
    method: "POST",
    url: "/api/v1/apps/app-a/start",
    payload: { workspace_id: workspace.id, holaboss_user_id: "user-1" }
  });

  assert.equal(started.statusCode, 200);
  assert.deepEqual(started.json(), {
    app_id: "app-a",
    status: "building",
    detail: "App start queued in background",
    ports: { http: 18080, mcp: 13100 }
  });
  assert.equal(store.getAppBuild({ workspaceId: workspace.id, appId: "app-a" })?.status, "building");

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(store.getAppBuild({ workspaceId: workspace.id, appId: "app-a" })?.status, "running");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.skipSetup, false);

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
    harness: "pi",
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

test("ensure-running dedupes concurrent setup/start for the same app", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
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
      "healthchecks:",
      "  mcp:",
      "    path: /health",
      "    timeout_s: 30",
      "lifecycle:",
      "  setup: 'echo setup >> setup-count.txt; sleep 1'",
      "  start: 'echo start'"
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    [
      "applications:",
      "  - app_id: app-a",
      "    config_path: apps/app-a/app.runtime.yaml"
    ].join("\n"),
    "utf8"
  );

  const lifecycleCalls: Array<Record<string, unknown>> = [];
  const app = buildTestRuntimeApiServer({
    store,
    appLifecycleExecutor: {
      async startApp(params) {
        lifecycleCalls.push({ action: "start", ...params });
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
    }
  });

  const payload = { workspace_id: workspace.id };
  const [first, second] = await Promise.all([
    app.inject({
      method: "POST",
      url: "/api/v1/apps/ensure-running",
      payload
    }),
    app.inject({
      method: "POST",
      url: "/api/v1/apps/ensure-running",
      payload
    })
  ]);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(first.json(), {
    apps: [
      {
        app_id: "app-a",
        ready: true,
        error: null
      }
    ]
  });
  assert.deepEqual(second.json(), {
    apps: [
      {
        app_id: "app-a",
        ready: true,
        error: null
      }
    ]
  });
  assert.equal(lifecycleCalls.length, 1);

  const setupCountFile = path.join(appDir, "setup-count.txt");
  assert.equal(fs.existsSync(setupCountFile), true);
  const setupRuns = fs
    .readFileSync(setupCountFile, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
  assert.equal(setupRuns, 1);

  await app.close();
  store.close();
});

test("app setup timeout honors configured timeout", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-timeout",
    name: "Workspace Apps",
    harness: "pi",
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
      "  setup: 'node -e \"setTimeout(() => {}, 1000)\"'"
    ].join("\n"),
    "utf8"
  );

  const previousTimeout = process.env.HB_APP_SETUP_TIMEOUT_MS;
  process.env.HB_APP_SETUP_TIMEOUT_MS = "50";
  const app = buildTestRuntimeApiServer({ store });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/apps/app-a/setup",
      payload: { workspace_id: workspace.id }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "setup_started");

    await new Promise((resolve) => setTimeout(resolve, 200));
    const build = store.getAppBuild({ workspaceId: workspace.id, appId: "app-a" });
    assert.equal(build?.status, "failed");
    assert.match(build?.error ?? "", /^setup timed out after 1s(?: — see .+setup\.latest\.log| — see .+setup-.+\.log)?$/);
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.HB_APP_SETUP_TIMEOUT_MS;
    } else {
      process.env.HB_APP_SETUP_TIMEOUT_MS = previousTimeout;
    }
    await app.close();
    store.close();
  }
});

test("internal resolved app bootstrap route starts resolved apps and returns MCP urls", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
    status: "active"
  });
  store.upsertAppBuild({
    workspaceId: "workspace-1",
    appId: "app-a",
    status: "completed"
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
        ports: { http: params.httpPort ?? 0, mcp: params.mcpPort ?? 0 }
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
    url: "/api/v1/internal/workspaces/workspace-1/resolved-apps/start",
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
  const body = response.json();
  assert.equal(body.applications.length, 2);
  const appA = body.applications[0];
  const appB = body.applications[1];
  assert.equal(appA.app_id, "app-a");
  assert.equal(appB.app_id, "app-b");
  assert.ok(appA.ports.http >= 13100);
  assert.ok(appA.ports.mcp >= 13100);
  assert.ok(appB.ports.http >= 13100);
  assert.ok(appB.ports.mcp >= 13100);
  const allPorts = [appA.ports.http, appA.ports.mcp, appB.ports.http, appB.ports.mcp];
  assert.equal(new Set(allPorts).size, 4, "all four ports must be unique");
  assert.equal(appA.mcp_url, `http://localhost:${appA.ports.mcp}/mcp`);
  assert.equal(appB.mcp_url, `http://localhost:${appB.ports.mcp}/mcp`);
  assert.equal(appA.timeout_ms, 60000);
  assert.equal(appB.timeout_ms, 30000);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.appId, "app-a");
  assert.equal(calls[0]?.httpPort, appA.ports.http);
  assert.equal(calls[0]?.mcpPort, appA.ports.mcp);
  assert.equal(calls[0]?.holabossUserId, "user-1");
  assert.equal(calls[0]?.skipSetup, true);
  assert.equal(calls[1]?.appId, "app-b");
  assert.equal(calls[1]?.httpPort, appB.ports.http);
  assert.equal(calls[1]?.mcpPort, appB.ports.mcp);
  assert.equal(calls[1]?.skipSetup, false);

  await app.close();
  store.close();
});

test("internal resolved app bootstrap route rejects base_dir that escapes the workspace", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
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
    url: "/api/v1/internal/workspaces/workspace-1/resolved-apps/start",
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

test("internal resolved app bootstrap route prevalidates all app dirs before starting any apps", async () => {
  const root = makeTempDir("hb-runtime-api-prevalidate-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
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
    url: "/api/v1/internal/workspaces/workspace-1/resolved-apps/start",
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

test("internal resolved app bootstrap route rejects missing expected workspace dir", async () => {
  const root = makeTempDir("hb-runtime-api-missing-workspace-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
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
    url: "/api/v1/internal/workspaces/workspace-1/resolved-apps/start",
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

test("internal resolved app bootstrap route rejects unknown workspace ids before startup", async () => {
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
    url: "/api/v1/internal/workspaces/workspace-unknown/resolved-apps/start",
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

test("internal resolved app bootstrap route rejects workspace_dir mismatches before startup", async () => {
  const root = makeTempDir("hb-runtime-api-workspace-mismatch-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
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
    url: "/api/v1/internal/workspaces/workspace-1/resolved-apps/start",
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

test("internal resolved app bootstrap route rejects duplicate app ids", async () => {
  const root = makeTempDir("hb-runtime-api-dup-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
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
    url: "/api/v1/internal/workspaces/workspace-1/resolved-apps/start",
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

test("internal resolved app bootstrap route rejects empty resolved applications", async () => {
  const root = makeTempDir("hb-runtime-api-empty-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
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
    url: "/api/v1/internal/workspaces/workspace-1/resolved-apps/start",
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

test("internal resolved app bootstrap route rejects mismatched lifecycle response shape", async () => {
  const root = makeTempDir("hb-runtime-api-mismatch-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
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
    url: "/api/v1/internal/workspaces/workspace-1/resolved-apps/start",
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
    detail: "resolved app startup returned mismatched app id 'other-app' for 'app-a'"
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
    harness: "pi",
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
  const lifecycleCalls: Array<Record<string, unknown>> = [];
  const app = buildTestRuntimeApiServer({
    store,
    appLifecycleExecutor: {
      async startApp(params) {
        lifecycleCalls.push({ action: "start", ...params });
        return {
          app_id: params.appId,
          status: "started",
          detail: "app started with lifecycle manager",
          ports: { http: params.httpPort ?? 18081, mcp: params.mcpPort ?? 13101 }
        };
      },
      async stopApp() {
        throw new Error("not used");
      },
      async shutdownAll() {
        throw new Error("not used");
      }
    }
  });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/workspaces",
    payload: {
      name: "Workspace Apps",
      harness: "pi",
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
    status: "enabled",
    detail: "App installed and running",
    ready: true,
    error: null
  });
  assert.equal(lifecycleCalls.length, 1);

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
        build_status: "running",
        ready: true,
        error: null
      }
    ],
    count: 1
  });

  const buildStatus = await app.inject({
    method: "GET",
    url: `/api/v1/apps/demo-app/build-status?workspace_id=${workspace.id}`
  });
  assert.equal(buildStatus.statusCode, 200);
  assert.equal(buildStatus.json().status, "running");

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

test("app list and build-status infer pending when installed app has setup but no build record yet", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace Apps",
    harness: "pi",
    status: "active"
  });
  const workspaceDir = path.join(workspaceRoot, workspace.id);
  fs.mkdirSync(path.join(workspaceDir, "apps", "demo-app"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    [
      "applications:",
      "  - app_id: demo-app",
      "    config_path: apps/demo-app/app.runtime.yaml",
      "    lifecycle:",
      "      setup: npm install"
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceDir, "apps", "demo-app", "app.runtime.yaml"),
    [
      "app_id: demo-app",
      "mcp:",
      "  port: 4100",
      "lifecycle:",
      "  setup: npm install"
    ].join("\n"),
    "utf8"
  );
  const app = buildTestRuntimeApiServer({ store });

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
        lifecycle: { setup: "npm install" },
        build_status: "pending",
        ready: false,
        error: null
      }
    ],
    count: 1
  });

  const buildStatus = await app.inject({
    method: "GET",
    url: `/api/v1/apps/demo-app/build-status?workspace_id=${workspace.id}`
  });
  assert.equal(buildStatus.statusCode, 200);
  assert.deepEqual(buildStatus.json(), { status: "pending" });

  await app.close();
  store.close();
});

test("queue route persists input and runtime state without writing session history until claim", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
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
  assert.equal(response.json().status, "QUEUED");
  assert.equal(response.json().effective_state, "QUEUED");
  assert.equal(response.json().runtime_status, "QUEUED");
  assert.equal(response.json().has_queued_inputs, true);
  const sessionId = response.json().session_id;
  assert.ok(typeof sessionId === "string" && sessionId.trim().length > 0);

  const queued = store.getInput(response.json().input_id);
  assert.ok(queued);
  assert.equal(queued.payload.text, "hello world");
  assert.equal("holaboss_user_id" in queued.payload, false);
  assert.equal(queued.sessionId, sessionId);

  const runtimeStates = store.listRuntimeStates(workspace.id);
  assert.equal(runtimeStates[0].status, "QUEUED");
  assert.equal(runtimeStates[0].currentInputId, response.json().input_id);
  assert.equal(runtimeStates[0].sessionId, sessionId);

  const session = store.getSession({ workspaceId: workspace.id, sessionId });
  assert.ok(session);
  assert.equal(session.kind, "workspace_session");
  assert.equal(session.title, "hello world");

  const binding = store.getBinding({ workspaceId: workspace.id, sessionId });
  assert.ok(binding);
  assert.equal(binding.harnessSessionId, sessionId);

  const history = store.listSessionMessages({ workspaceId: workspace.id, sessionId });
  assert.equal(history.length, 0);

  await app.close();
  store.close();
});

test("queue route preserves the active claimed input while adding later queued work", async () => {
  const root = makeTempDir("hb-runtime-api-queue-preserve-active-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

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
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "pi",
    harnessSessionId: "session-main",
  });
  const active = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "currently running" },
  });
  store.updateInput(active.inputId, {
    status: "CLAIMED",
    claimedBy: "worker-1",
    claimedUntil: "2026-04-17T12:00:00.000Z",
  });
  store.updateRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main",
    status: "BUSY",
    currentInputId: active.inputId,
    currentWorkerId: "worker-1",
    leaseUntil: "2026-04-17T12:00:00.000Z",
    heartbeatAt: "2026-04-17T11:55:00.000Z",
    lastError: null,
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/agent-sessions/queue",
    payload: {
      workspace_id: workspace.id,
      session_id: "session-main",
      text: "queue this next",
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "QUEUED");
  assert.equal(response.json().effective_state, "BUSY");
  assert.equal(response.json().runtime_status, "BUSY");
  assert.equal(response.json().current_input_id, active.inputId);
  assert.equal(response.json().has_queued_inputs, true);

  const runtimeState = store.getRuntimeState({
    workspaceId: workspace.id,
    sessionId: "session-main",
  });
  assert.equal(runtimeState?.status, "BUSY");
  assert.equal(runtimeState?.currentInputId, active.inputId);
  assert.equal(runtimeState?.currentWorkerId, "worker-1");
  const history = store.listSessionMessages({
    workspaceId: workspace.id,
    sessionId: "session-main",
  });
  assert.equal(history.length, 0);

  const states = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/by-workspace/${workspace.id}/runtime-states`
  });

  assert.equal(states.statusCode, 200);
  assert.equal(states.json().items[0].status, "BUSY");
  assert.equal(states.json().items[0].effective_state, "BUSY");
  assert.equal(states.json().items[0].runtime_status, "BUSY");
  assert.equal(states.json().items[0].has_queued_inputs, true);
  assert.equal(states.json().items[0].current_input_id, active.inputId);

  await app.close();
  store.close();
});

test("queue route preserves an existing explicit session title", async () => {
  const root = makeTempDir("hb-runtime-api-session-title-preserve-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

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
    title: "Pinned title",
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/agent-sessions/queue",
    payload: {
      workspace_id: workspace.id,
      session_id: "session-main",
      text: "replace me if you can"
    }
  });

  assert.equal(response.statusCode, 200);
  const session = store.getSession({ workspaceId: workspace.id, sessionId: "session-main" });
  assert.ok(session);
  assert.equal(session.title, "Pinned title");

  await app.close();
  store.close();
});

test("queued input edit route updates queued input text without writing session history", async () => {
  const root = makeTempDir("hb-runtime-api-edit-queued-input-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace"),
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: {
      text: "draft this first",
      attachments: [],
      image_urls: [],
      model: null,
      thinking_value: null,
      context: {},
    },
  });

  const response = await app.inject({
    method: "PATCH",
    url: `/api/v1/agent-sessions/session-main/inputs/${queued.inputId}`,
    payload: {
      workspace_id: workspace.id,
      text: "draft this second",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().input_id, queued.inputId);
  assert.equal(response.json().session_id, "session-main");
  assert.equal(response.json().status, "QUEUED");
  assert.equal(response.json().text, "draft this second");

  const updated = store.getInput(queued.inputId);
  assert.ok(updated);
  assert.equal(updated?.payload.text, "draft this second");
  const history = store.listSessionMessages({
    workspaceId: workspace.id,
    sessionId: "session-main",
  });
  assert.equal(history.length, 0);

  await app.close();
  store.close();
});

test("queued input edit route rejects edits after the input is claimed", async () => {
  const root = makeTempDir("hb-runtime-api-edit-claimed-input-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace"),
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: {
      text: "draft this first",
      attachments: [],
      image_urls: [],
      model: null,
      thinking_value: null,
      context: {},
    },
  });
  store.updateInput(queued.inputId, {
    status: "CLAIMED",
    claimedBy: "worker-1",
    claimedUntil: "2026-04-17T12:00:00.000Z",
  });

  const response = await app.inject({
    method: "PATCH",
    url: `/api/v1/agent-sessions/session-main/inputs/${queued.inputId}`,
    payload: {
      workspace_id: workspace.id,
      text: "edited too late",
    },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(
    response.json().detail,
    "queued input can no longer be edited",
  );

  await app.close();
  store.close();
});

test("pause route delegates to the configured queue worker", async () => {
  const root = makeTempDir("hb-runtime-api-pause-route-");
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
  const queued = store.enqueueInput({
    workspaceId: workspace.id,
    sessionId: "session-main",
    payload: { text: "hello world" }
  });

  let pausedParams: { workspaceId: string; sessionId: string } | null = null;
  const app = buildRuntimeApiServer({
    store,
    queueWorker: {
      async start() {},
      wake() {},
      async close() {},
      async pauseSessionRun(params) {
        pausedParams = params;
        return {
          inputId: queued.inputId,
          sessionId: params.sessionId,
          status: "PAUSING",
        };
      },
    },
    cronWorker: null,
    bridgeWorker: null,
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/agent-sessions/session-main/pause",
    payload: {
      workspace_id: workspace.id,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(pausedParams, {
    workspaceId: workspace.id,
    sessionId: "session-main",
  });
  assert.deepEqual(response.json(), {
    input_id: queued.inputId,
    session_id: "session-main",
    status: "PAUSING",
  });

  await app.close();
  store.close();
});

test("runtime api server starts and closes the recall embedding backfill worker", async () => {
  const root = makeTempDir("hb-runtime-api-recall-embedding-worker-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace"),
  });
  let started = 0;
  let closed = 0;
  let woke = 0;
  const app = buildRuntimeApiServer({
    store,
    queueWorker: null,
    durableMemoryWorker: null,
    cronWorker: null,
    bridgeWorker: null,
    recallEmbeddingBackfillWorker: {
      async start() {
        started += 1;
      },
      wake() {
        woke += 1;
      },
      async close() {
        closed += 1;
      },
    },
    enableAppHealthMonitor: false,
    startAppsOnReady: false,
  });

  await app.ready();
  assert.equal(started, 1);
  assert.equal(woke, 0);

  await app.close();
  assert.equal(closed, 1);

  store.close();
});

test("queue route creates pending user memory proposals from strong preference signals", async () => {
  const root = makeTempDir("hb-runtime-api-memory-proposals-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/agent-sessions/queue",
    payload: {
      workspace_id: workspace.id,
      text: "Please keep your responses concise and do not zip the files; deliver them individually."
    }
  });

  assert.equal(response.statusCode, 200);
  const sessionId = response.json().session_id;
  assert.ok(typeof sessionId === "string" && sessionId.trim().length > 0);
  const proposals = store.listMemoryUpdateProposals({
    workspaceId: workspace.id,
    sessionId,
    inputId: response.json().input_id,
    limit: 10,
    offset: 0
  });

  assert.equal(proposals.length, 2);
  assert.deepEqual(
    proposals.map((proposal) => proposal.targetKey).sort(),
    ["file-delivery", "response-style"]
  );
  assert.ok(proposals.every((proposal) => proposal.state === "pending"));

  await app.close();
  store.close();
});

test("accept task proposal creates a child session with queued work", async () => {
  const root = makeTempDir("hb-runtime-api-task-proposal-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  let wakeCount = 0;
  const app = buildRuntimeApiServer({
    store,
    queueWorker: {
      async start() {},
      async close() {},
      wake() {
        wakeCount += 1;
      }
    },
    cronWorker: null,
    bridgeWorker: null
  });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "pi",
    harnessSessionId: "session-main"
  });
  store.createTaskProposal({
    proposalId: "proposal-1",
    workspaceId: workspace.id,
    taskName: "Follow up",
    taskPrompt: "Write a follow-up message",
    taskGenerationRationale: "User has not replied",
    sourceEventIds: ["evt-1"],
    createdAt: "2026-01-01T00:00:00+00:00"
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/task-proposals/proposal-1/accept",
    payload: {
      parent_session_id: "session-main",
      task_name: "Follow up",
      task_prompt: "Write the follow-up and send a reminder",
      model: "openai/gpt-5.2",
      priority: 2,
      created_by: "workspace_user"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.proposal.state, "accepted");
  assert.equal(body.proposal.proposal_source, "proactive");
  assert.equal(body.proposal.accepted_input_id, body.input.input_id);
  assert.equal(body.proposal.accepted_session_id, body.session.session_id);
  assert.equal(body.session.kind, "task_proposal");
  assert.equal(body.session.parent_session_id, "session-main");
  assert.equal(body.session.source_proposal_id, "proposal-1");
  assert.equal(body.session.title, "Follow up");
  assert.equal(body.input.session_id, body.session.session_id);
  assert.equal(body.input.status, "QUEUED");
  assert.equal(wakeCount, 1);

  const childBinding = store.getBinding({ workspaceId: workspace.id, sessionId: body.session.session_id });
  assert.ok(childBinding);
  assert.equal(childBinding.harness, "pi");
  assert.equal(childBinding.harnessSessionId, body.session.session_id);

  const childRuntimeState = store.getRuntimeState({
    workspaceId: workspace.id,
    sessionId: body.session.session_id
  });
  assert.ok(childRuntimeState);
  assert.equal(childRuntimeState.status, "QUEUED");
  assert.equal(childRuntimeState.currentInputId, body.input.input_id);

  const childInput = store.getInput(body.input.input_id);
  assert.ok(childInput);
  assert.equal(childInput.sessionId, body.session.session_id);
  assert.equal(childInput.priority, 2);
  assert.equal(childInput.payload.text, "Write the follow-up and send a reminder");
  assert.equal(childInput.payload.model, "openai/gpt-5.2");
  assert.deepEqual(childInput.payload.context, {
    source: "task_proposal",
    proposal_id: "proposal-1",
    proposal_source: "proactive",
    parent_session_id: "session-main",
    evolve_candidate: null,
  });

  const childHistory = store.listSessionMessages({
    workspaceId: workspace.id,
    sessionId: body.session.session_id
  });
  assert.equal(childHistory.length, 0);

  const secondAccept = await app.inject({
    method: "POST",
    url: "/api/v1/task-proposals/proposal-1/accept",
    payload: {}
  });
  assert.equal(secondAccept.statusCode, 409);

  await app.close();
  store.close();
});

test("accepting and dismissing evolve task proposals updates linked skill candidates", async () => {
  const root = makeTempDir("hb-runtime-api-evolve-task-proposal-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const memoryService = new FilesystemMemoryService({ workspaceRoot: store.workspaceRoot });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.ensureSession({
    workspaceId: workspace.id,
    sessionId: "session-main",
    kind: "main",
    title: "Main"
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "pi",
    harnessSessionId: "session-main"
  });
  store.createEvolveSkillCandidate({
    candidateId: "evolve-skill-input-10",
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-10",
    kind: "skill_create",
    status: "proposed",
    taskProposalId: "evolve-proposal-1",
    title: "Release verification skill",
    summary: "Reusable release verification workflow.",
    slug: "release-verification",
    skillPath: `workspace/${workspace.id}/evolve/skills/evolve-skill-input-10/SKILL.md`,
    contentFingerprint: "fp-1",
    sourceTurnInputIds: ["input-10"],
    proposedAt: "2026-04-10T00:00:00.000Z",
  });
  await memoryService.upsert({
    workspace_id: workspace.id,
    path: `workspace/${workspace.id}/evolve/skills/evolve-skill-input-10/SKILL.md`,
    content: [
      "---",
      "name: release-verification",
      "description: Reusable release verification workflow.",
      "---",
      "# Release verification skill",
      "",
      "## Workflow",
      "1. Run verification checks.",
    ].join("\n"),
  });
  store.createTaskProposal({
    proposalId: "evolve-proposal-1",
    workspaceId: workspace.id,
    taskName: "Review new reusable skill: Release verification skill",
    taskPrompt: "Review and promote the candidate skill.",
    taskGenerationRationale: "Evolve detected a reusable workflow.",
    proposalSource: "evolve",
    sourceEventIds: ["input-10"],
    createdAt: "2026-04-10T00:00:00.000Z"
  });
  store.createTaskProposal({
    proposalId: "evolve-proposal-2",
    workspaceId: workspace.id,
    taskName: "Dismiss me",
    taskPrompt: "Dismiss evolve candidate.",
    taskGenerationRationale: "Evolve needs a user decision.",
    proposalSource: "evolve",
    sourceEventIds: ["input-11"],
    createdAt: "2026-04-10T00:01:00.000Z"
  });
  store.createEvolveSkillCandidate({
    candidateId: "evolve-skill-input-11",
    workspaceId: workspace.id,
    sessionId: "session-main",
    inputId: "input-11",
    kind: "skill_create",
    status: "proposed",
    taskProposalId: "evolve-proposal-2",
    title: "Deploy status check skill",
    summary: "Reusable deploy status verification workflow.",
    slug: "deploy-status-check",
    skillPath: `workspace/${workspace.id}/evolve/skills/evolve-skill-input-11/SKILL.md`,
    contentFingerprint: "fp-2",
    sourceTurnInputIds: ["input-11"],
    proposedAt: "2026-04-10T00:01:00.000Z",
  });

  let wakeCount = 0;
  const app = buildTestRuntimeApiServer({
    store,
    memoryService,
    queueWorker: {
      async start() {},
      wake() {
        wakeCount += 1;
      },
      async close() {},
    }
  });

  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/task-proposals/evolve-proposal-1/accept",
    payload: {
      parent_session_id: "session-main",
      created_by: "workspace_user"
    }
  });
  assert.equal(accepted.statusCode, 200);
  const acceptedBody = accepted.json();
  assert.equal(acceptedBody.proposal.proposal_source, "evolve");
  const acceptedInput = store.getInput(acceptedBody.input.input_id);
  assert.ok(acceptedInput);
  assert.deepEqual(acceptedInput.payload.context, {
    source: "task_proposal",
    proposal_id: "evolve-proposal-1",
    proposal_source: "evolve",
    parent_session_id: "session-main",
    evolve_candidate: {
      candidate_id: "evolve-skill-input-10",
      kind: "skill_create",
      title: "Release verification skill",
      summary: "Reusable release verification workflow.",
      slug: "release-verification",
      skill_path: `workspace/${workspace.id}/evolve/skills/evolve-skill-input-10/SKILL.md`,
      target_skill_path: "skills/release-verification/SKILL.md",
      skill_markdown: [
        "---",
        "name: release-verification",
        "description: Reusable release verification workflow.",
        "---",
        "# Release verification skill",
        "",
        "## Workflow",
        "1. Run verification checks.",
      ].join("\n"),
      task_proposal_id: "evolve-proposal-1",
    },
  });
  assert.equal(store.getEvolveSkillCandidate("evolve-skill-input-10")?.status, "accepted");
  assert.equal(wakeCount, 1);

  const dismissed = await app.inject({
    method: "PATCH",
    url: "/api/v1/task-proposals/evolve-proposal-2",
    payload: { state: "dismissed" }
  });
  assert.equal(dismissed.statusCode, 200);
  assert.equal(dismissed.json().proposal.proposal_source, "evolve");
  assert.equal(store.getEvolveSkillCandidate("evolve-skill-input-11")?.status, "dismissed");
  assert.ok(store.getEvolveSkillCandidate("evolve-skill-input-11")?.dismissedAt);

  await app.close();
  store.close();
});

test("queue route rejects inputs while workspace apps are still building", async () => {
  const root = makeTempDir("hb-runtime-api-queue-app-build-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });

  const workspaceDir = store.workspaceDir(workspace.id);
  fs.mkdirSync(path.join(workspaceDir, "apps", "gmail"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    [
      "applications:",
      "  - app_id: gmail",
      "    config_path: apps/gmail/app.runtime.yaml",
      "    lifecycle:",
      "      setup: npm run build"
    ].join("\n"),
    "utf8"
  );
  store.upsertAppBuild({
    workspaceId: workspace.id,
    appId: "gmail",
    status: "building"
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/agent-sessions/queue",
    payload: {
      workspace_id: workspace.id,
      text: "hello world"
    }
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().detail, "workspace apps are still building: gmail (building)");
  assert.equal(store.listRuntimeStates(workspace.id).length, 0);

  await app.close();
  store.close();
});

test("queue route accepts staged file and folder attachments and history hydrates attachment metadata", async () => {
  const root = makeTempDir("hb-runtime-api-queue-attachments-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const app = buildTestRuntimeApiServer({ store });

  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.upsertBinding({
    workspaceId: workspace.id,
    sessionId: "session-main",
    harness: "pi",
    harnessSessionId: "session-main"
  });

  const workspaceDir = store.workspaceDir(workspace.id);
  const attachmentPath = path.join(workspaceDir, ".holaboss", "input-attachments", "batch-1", "diagram.png");
  const attachedFolderPath = path.join(workspaceDir, "docs");
  fs.mkdirSync(path.dirname(attachmentPath), { recursive: true });
  fs.mkdirSync(attachedFolderPath, { recursive: true });
  fs.writeFileSync(attachmentPath, "png-bytes", "utf8");
  fs.writeFileSync(path.join(attachedFolderPath, "brief.md"), "# brief\n", "utf8");

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/agent-sessions/queue",
    payload: {
      workspace_id: workspace.id,
      text: "",
      attachments: [
        {
          id: "attachment-1",
          kind: "image",
          name: "diagram.png",
          mime_type: "image/png",
          size_bytes: 9,
          workspace_path: ".holaboss/input-attachments/batch-1/diagram.png"
        },
        {
          id: "attachment-2",
          kind: "folder",
          name: "docs",
          mime_type: "inode/directory",
          size_bytes: 0,
          workspace_path: "docs"
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const queued = store.getInput(response.json().input_id);
  assert.ok(queued);
  assert.deepEqual(queued.payload.attachments, [
    {
      id: "attachment-1",
      kind: "image",
      name: "diagram.png",
      mime_type: "image/png",
      size_bytes: 9,
      workspace_path: ".holaboss/input-attachments/batch-1/diagram.png"
    },
    {
      id: "attachment-2",
      kind: "folder",
      name: "docs",
      mime_type: "inode/directory",
      size_bytes: 0,
      workspace_path: "docs"
    }
  ]);

  const historyResponse = await app.inject({
    method: "GET",
    url: `/api/v1/agent-sessions/session-main/history?workspace_id=${workspace.id}`
  });

  assert.equal(historyResponse.statusCode, 200);
  assert.deepEqual(historyResponse.json().messages, [
    {
      id: `user-${response.json().input_id}`,
      role: "user",
      text: "",
      created_at: historyResponse.json().messages[0]?.created_at,
      metadata: {
        attachments: [
          {
            id: "attachment-1",
            kind: "image",
            name: "diagram.png",
            mime_type: "image/png",
            size_bytes: 9,
            workspace_path: ".holaboss/input-attachments/batch-1/diagram.png"
          },
          {
            id: "attachment-2",
            kind: "folder",
            name: "docs",
            mime_type: "inode/directory",
            size_bytes: 0,
            workspace_path: "docs"
          }
        ]
      }
    }
  ]);

  await app.close();
  store.close();
});

test("GET /api/v1/apps/catalog returns entries filtered by source", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const app = buildTestRuntimeApiServer({ store });

  store.upsertAppCatalogEntry({
    appId: "twitter",
    source: "marketplace",
    name: "Twitter / X",
    description: null,
    icon: null,
    category: null,
    tags: ["social"],
    version: "v0.1.0",
    archiveUrl: "https://example.test/twitter-module-darwin-arm64.tar.gz",
    archivePath: null,
    target: "darwin-arm64",
    cachedAt: "2026-04-09T00:00:00Z",
  });
  store.upsertAppCatalogEntry({
    appId: "linkedin",
    source: "local",
    name: "LinkedIn",
    description: null,
    icon: null,
    category: null,
    tags: [],
    version: null,
    archiveUrl: null,
    archivePath: "/tmp/linkedin-module-darwin-arm64.tar.gz",
    target: "darwin-arm64",
    cachedAt: "2026-04-09T00:00:00Z",
  });

  const res = await app.inject({ method: "GET", url: "/api/v1/apps/catalog?source=marketplace" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.count, 1);
  assert.equal(body.entries[0].app_id, "twitter");
  assert.deepEqual(body.entries[0].tags, ["social"]);

  await app.close();
  store.close();
});

test("POST /api/v1/apps/catalog/sync replaces all entries for a source", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const app = buildTestRuntimeApiServer({ store });

  store.upsertAppCatalogEntry({
    appId: "old",
    source: "marketplace",
    name: "Old",
    description: null,
    icon: null,
    category: null,
    tags: [],
    version: "v0.0.1",
    archiveUrl: "https://example.test/old.tar.gz",
    archivePath: null,
    target: "darwin-arm64",
    cachedAt: "2026-04-08T00:00:00Z",
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/catalog/sync",
    payload: {
      source: "marketplace",
      target: "darwin-arm64",
      entries: [
        {
          app_id: "twitter",
          name: "Twitter / X",
          description: "Tweet stuff",
          icon: null,
          category: "social",
          tags: ["social"],
          version: "v0.1.0",
          archive_url: "https://example.test/twitter.tar.gz",
          archive_path: null,
        },
      ],
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.synced, 1);
  assert.equal(body.source, "marketplace");

  const remaining = store.listAppCatalogEntries({ source: "marketplace" });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].appId, "twitter");

  await app.close();
  store.close();
});

test("POST /api/v1/apps/catalog/sync rejects invalid source", async () => {
  const root = makeTempDir("hb-runtime-api-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot
  });
  const app = buildTestRuntimeApiServer({ store });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/catalog/sync",
    payload: { source: "bogus", target: "darwin-arm64", entries: [] },
  });
  assert.equal(res.statusCode, 400);

  await app.close();
  store.close();
});

test("isAllowedArchivePath accepts tmpdir and rejects arbitrary paths", async () => {
  const { isAllowedArchivePath } = await import("./app.js");
  const tmp = path.join(os.tmpdir(), "holaboss-test-archive.tar.gz");
  assert.equal(isAllowedArchivePath(tmp), true);
  assert.equal(isAllowedArchivePath("/etc/passwd"), false);
  assert.equal(isAllowedArchivePath(""), false);
});

test("POST /apps/install-archive rejects path outside allowed roots", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const app = buildTestRuntimeApiServer({ store });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspace.id,
      app_id: "minimal",
      archive_path: "/etc/passwd",
    },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  const msg = body.error || body.detail || body.message || "";
  assert.match(String(msg), /outside allowed roots/);

  await app.close();
  store.close();
});

test("POST /apps/install-archive rejects missing file", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const app = buildTestRuntimeApiServer({ store });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspace.id,
      app_id: "minimal",
      archive_path: path.join(os.tmpdir(), `does-not-exist-${Date.now()}.tar.gz`),
    },
  });
  assert.equal(res.statusCode, 400);

  await app.close();
  store.close();
});

test("POST /apps/install-archive extracts tarball and registers in workspace.yaml", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  fs.mkdirSync(workspaceDir, { recursive: true });
  const app = buildTestRuntimeApiServer({ store });

  const stagedArchive = path.join(os.tmpdir(), `install-archive-test-${Date.now()}.tar.gz`);
  fs.copyFileSync(MINIMAL_APP_FIXTURE, stagedArchive);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspace.id,
      app_id: "minimal",
      archive_path: stagedArchive,
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.app_id, "minimal");
  assert.equal(body.status, "enabled");

  const appDir = path.join(workspaceDir, "apps", "minimal");
  assert.equal(fs.existsSync(path.join(appDir, "app.runtime.yaml")), true);
  assert.equal(fs.existsSync(path.join(appDir, "package.json")), true);

  const yamlBody = fs.readFileSync(path.join(workspaceDir, "workspace.yaml"), "utf8");
  assert.match(yamlBody, /app_id:\s*["']?minimal["']?/);

  fs.rmSync(stagedArchive, { force: true });

  await app.close();
  store.close();
});

test("POST /apps/install-archive rejects re-install when apps/{id} already exists", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  const preDir = path.join(workspaceDir, "apps", "minimal");
  fs.mkdirSync(preDir, { recursive: true });
  fs.writeFileSync(path.join(preDir, "sentinel.txt"), "existing");
  const app = buildTestRuntimeApiServer({ store });

  const stagedArchive = path.join(os.tmpdir(), `install-archive-reinstall-${Date.now()}.tar.gz`);
  fs.copyFileSync(MINIMAL_APP_FIXTURE, stagedArchive);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/apps/install-archive",
    payload: {
      workspace_id: workspace.id,
      app_id: "minimal",
      archive_path: stagedArchive,
    },
  });
  assert.equal(res.statusCode, 409);
  fs.rmSync(stagedArchive, { force: true });

  await app.close();
  store.close();
});

test("parseInstalledAppRuntime extracts mcp.tools list", () => {
  const yamlBody = `
app_id: "twitter"
name: "Twitter"
slug: "twitter"

lifecycle:
  setup: "true"
  start: "true"
  stop: "true"

mcp:
  enabled: true
  transport: http-sse
  port: 3099
  path: /mcp/sse
  tools:
    - create_post
    - list_posts
    - publish_post
`;
  const parsed = parseInstalledAppRuntime(yamlBody, "twitter", "apps/twitter/app.runtime.yaml");
  assert.deepEqual(parsed.mcpTools, ["create_post", "list_posts", "publish_post"]);
});

test("parseInstalledAppRuntime returns empty mcpTools when not declared", () => {
  const yamlBody = `
app_id: "twitter"
name: "Twitter"
slug: "twitter"

lifecycle:
  setup: "true"

mcp:
  enabled: true
  transport: http-sse
  port: 3099
  path: /mcp/sse
`;
  const parsed = parseInstalledAppRuntime(yamlBody, "twitter", "apps/twitter/app.runtime.yaml");
  assert.deepEqual(parsed.mcpTools, []);
});

test("parseInstalledAppRuntime returns empty mcpTools when mcp block missing", () => {
  const yamlBody = `
app_id: "minimal"
name: "Minimal"

lifecycle:
  setup: "true"
`;
  const parsed = parseInstalledAppRuntime(yamlBody, "minimal", "apps/minimal/app.runtime.yaml");
  assert.deepEqual(parsed.mcpTools, []);
});

test("writeWorkspaceMcpRegistryEntry adds server and tool_ids to workspace.yaml", () => {
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "wmcp-test-"));
  try {
    fs.writeFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      "template_id: test\nname: Test\n",
    );

    writeWorkspaceMcpRegistryEntry(tmpWorkspace, "twitter", {
      mcpEnabled: true,
      mcpTools: ["create_post", "list_posts"],
      mcpPath: "/mcp/sse",
      mcpTimeoutMs: 30000,
      mcpPort: 13100,
    });

    const yamlText = fs.readFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      "utf8",
    );
    assert.match(yamlText, /mcp_registry/);
    assert.match(yamlText, /servers:/);
    assert.match(yamlText, /twitter:/);
    assert.match(yamlText, /allowlist:/);
    assert.match(yamlText, /twitter\.create_post/);
    assert.match(yamlText, /twitter\.list_posts/);
    assert.match(yamlText, /13100/);
  } finally {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

test("writeWorkspaceMcpRegistryEntry is a no-op when mcp is disabled", () => {
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "wmcp-test-"));
  try {
    fs.writeFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      "template_id: test\nname: Test\n",
    );

    writeWorkspaceMcpRegistryEntry(tmpWorkspace, "twitter", {
      mcpEnabled: false,
      mcpTools: ["create_post"],
      mcpPath: "/mcp/sse",
      mcpTimeoutMs: 30000,
      mcpPort: 13100,
    });

    const yamlText = fs.readFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      "utf8",
    );
    assert.doesNotMatch(yamlText, /mcp_registry/);
  } finally {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

test("writeWorkspaceMcpRegistryEntry replaces existing entry for the same app", () => {
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "wmcp-test-"));
  try {
    fs.writeFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      `template_id: test
name: Test
mcp_registry:
  allowlist:
    tool_ids:
      - twitter.old_tool
      - linkedin.create_post
  servers:
    twitter:
      type: remote
      url: http://localhost:99999/old
      enabled: true
    linkedin:
      type: remote
      url: http://localhost:13101/mcp/sse
      enabled: true
`,
    );

    writeWorkspaceMcpRegistryEntry(tmpWorkspace, "twitter", {
      mcpEnabled: true,
      mcpTools: ["new_tool"],
      mcpPath: "/mcp/sse",
      mcpTimeoutMs: 30000,
      mcpPort: 13100,
    });

    const yamlText = fs.readFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      "utf8",
    );
    // old twitter tool replaced
    assert.doesNotMatch(yamlText, /twitter\.old_tool/);
    assert.match(yamlText, /twitter\.new_tool/);
    // linkedin entries untouched
    assert.match(yamlText, /linkedin\.create_post/);
    assert.match(yamlText, /13101/);
    // twitter server replaced
    assert.doesNotMatch(yamlText, /99999/);
    assert.match(yamlText, /13100/);
  } finally {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

test("removeWorkspaceMcpRegistryEntry strips server and tool_ids for the app", () => {
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "wmcp-rm-test-"));
  try {
    fs.writeFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      `template_id: test
name: Test
mcp_registry:
  allowlist:
    tool_ids:
      - twitter.create_post
      - twitter.list_posts
      - linkedin.create_post
  servers:
    twitter:
      type: remote
      url: http://localhost:13100/mcp/sse
      enabled: true
    linkedin:
      type: remote
      url: http://localhost:13101/mcp/sse
      enabled: true
`,
    );

    removeWorkspaceMcpRegistryEntry(tmpWorkspace, "twitter");

    const yamlText = fs.readFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      "utf8",
    );
    assert.doesNotMatch(yamlText, /twitter\.create_post/);
    assert.doesNotMatch(yamlText, /twitter\.list_posts/);
    assert.match(yamlText, /linkedin\.create_post/);
    assert.match(yamlText, /linkedin:/);
  } finally {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

test("removeWorkspaceMcpRegistryEntry is a no-op when workspace.yaml has no mcp_registry", () => {
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "wmcp-rm-test-"));
  try {
    fs.writeFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      "template_id: test\nname: Test\n",
    );

    // Should not throw
    removeWorkspaceMcpRegistryEntry(tmpWorkspace, "twitter");

    const yamlText = fs.readFileSync(
      path.join(tmpWorkspace, "workspace.yaml"),
      "utf8",
    );
    assert.doesNotMatch(yamlText, /mcp_registry/);
  } finally {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

test("install-archive populates workspace.yaml mcp_registry from declared mcp.tools", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-mcp-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  fs.mkdirSync(workspaceDir, { recursive: true });
  const app = buildTestRuntimeApiServer({ store });

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-fixture-"));
  fs.writeFileSync(
    path.join(stageDir, "app.runtime.yaml"),
    `app_id: "twitter"
name: "Twitter"
slug: "twitter"

lifecycle:
  setup: "true"
  start: "true"
  stop: "true"

healthchecks:
  mcp:
    path: /mcp/health
    timeout_s: 5

mcp:
  enabled: true
  transport: http-sse
  port: 3099
  path: /mcp/sse
  tools:
    - create_post
    - list_posts
`,
  );
  fs.writeFileSync(path.join(stageDir, "package.json"), "{}");

  const archivePath = path.join(os.tmpdir(), `mcp-test-${Date.now()}.tar.gz`);
  await tar.c(
    { gzip: true, file: archivePath, cwd: stageDir, portable: true, noMtime: true },
    ["app.runtime.yaml", "package.json"],
  );

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: workspace.id,
        app_id: "twitter",
        archive_path: archivePath,
      },
    });
    assert.equal(res.statusCode, 200);

    const yamlBody = fs.readFileSync(
      path.join(workspaceDir, "workspace.yaml"),
      "utf8",
    );
    assert.match(yamlBody, /mcp_registry/);
    assert.match(yamlBody, /twitter\.create_post/);
    assert.match(yamlBody, /twitter\.list_posts/);
    assert.match(yamlBody, /servers:/);
    assert.match(yamlBody, /twitter:/);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.rmSync(archivePath, { force: true });
    await app.close();
    store.close();
  }
});

test("DELETE /apps/:appId removes mcp_registry entry", async () => {
  const root = makeTempDir("hb-runtime-api-delete-app-mcp-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);

  // Pre-seed workspace.yaml with applications + mcp_registry
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    `template_id: test
name: Test
applications:
  - app_id: twitter
    config_path: apps/twitter/app.runtime.yaml
    lifecycle:
      stop: "true"
mcp_registry:
  allowlist:
    tool_ids:
      - twitter.create_post
      - linkedin.create_post
  servers:
    twitter:
      type: remote
      url: http://localhost:13100/mcp/sse
      enabled: true
    linkedin:
      type: remote
      url: http://localhost:13101/mcp/sse
      enabled: true
`,
  );

  // Create apps/twitter dir with a minimal app.runtime.yaml so the DELETE
  // handler can stop the app (best-effort) before uninstalling
  const appDir = path.join(workspaceDir, "apps", "twitter");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "app.runtime.yaml"),
    `app_id: twitter
name: Twitter
lifecycle:
  stop: "true"
mcp:
  enabled: false
  port: 3099
`,
  );

  const app = buildTestRuntimeApiServer({ store });

  try {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/apps/twitter",
      payload: { workspace_id: workspace.id },
    });
    assert.equal(res.statusCode, 200);

    const yamlBody = fs.readFileSync(
      path.join(workspaceDir, "workspace.yaml"),
      "utf8",
    );
    assert.doesNotMatch(yamlBody, /twitter\.create_post/);
    assert.match(yamlBody, /linkedin\.create_post/);
    assert.match(yamlBody, /linkedin:/);
  } finally {
    await app.close();
    store.close();
  }
});

// ── archive_url tests ──────────────────────────────────────────────────────────

test("isAllowedArchiveUrl accepts github releases and rejects others", async () => {
  const { isAllowedArchiveUrl } = await import("./app.js");
  assert.equal(
    isAllowedArchiveUrl(
      "https://github.com/holaboss-ai/holaboss-apps/releases/download/v0.1.0/twitter-module-darwin-arm64.tar.gz",
    ),
    true,
  );
  assert.equal(isAllowedArchiveUrl("https://evil.test/twitter.tar.gz"), false);
  assert.equal(
    isAllowedArchiveUrl("http://github.com/holaboss-ai/holaboss-apps/releases/download/x.tar.gz"),
    false,
  );
  assert.equal(isAllowedArchiveUrl(""), false);
  assert.equal(isAllowedArchiveUrl("not-a-url"), false);
});

test("POST /apps/install-archive rejects url outside allowlist", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-url-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  fs.mkdirSync(workspaceDir, { recursive: true });
  const app = buildTestRuntimeApiServer({ store });

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: workspace.id,
        app_id: "evil",
        archive_url: "https://evil.test/twitter.tar.gz",
      },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.match(
      String(body.error ?? body.detail ?? body.message ?? ""),
      /allowlist|archive_url/,
    );
  } finally {
    await app.close();
    store.close();
  }
});

test("POST /apps/install-archive rejects both archive_path and archive_url", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-both-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  fs.mkdirSync(workspaceDir, { recursive: true });
  const app = buildTestRuntimeApiServer({ store });

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: workspace.id,
        app_id: "twitter",
        archive_path: "/tmp/x.tar.gz",
        archive_url:
          "https://github.com/holaboss-ai/holaboss-modules/releases/download/v0.1.0/twitter-module-darwin-arm64.tar.gz",
      },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await app.close();
    store.close();
  }
});

test("POST /apps/install-archive rejects request with neither path nor url", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-neither-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  fs.mkdirSync(workspaceDir, { recursive: true });
  const app = buildTestRuntimeApiServer({ store });

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: workspace.id,
        app_id: "twitter",
      },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await app.close();
    store.close();
  }
});

test("POST /apps/install-archive with archive_url downloads and installs", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-url-dl-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  fs.mkdirSync(workspaceDir, { recursive: true });
  const app = buildTestRuntimeApiServer({ store });

  const fixtureBuf = fs.readFileSync(MINIMAL_APP_FIXTURE);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/gzip" });
    res.end(fixtureBuf);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no server address");
  const url = `http://127.0.0.1:${addr.port}/minimal.tar.gz`;

  const savedEnv = process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST;
  process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST = `http://127.0.0.1:${addr.port}/`;

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: workspace.id,
        app_id: "minimal",
        archive_url: url,
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.app_id, "minimal");

    const installed = path.join(
      store.workspaceDir(workspace.id),
      "apps",
      "minimal",
      "app.runtime.yaml",
    );
    assert.equal(fs.existsSync(installed), true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    if (savedEnv === undefined) {
      delete process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST;
    } else {
      process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST = savedEnv;
    }
    await app.close();
    store.close();
  }
});

// Regression: a 409 "already installed" must release the install lock so the
// same (workspaceId, appId) can be retried. Previously the lock was set before
// the early return but the try/finally only wrapped the later flow, so a single
// failed reinstall pinned the app id until the runtime restarted.
test("POST /apps/install-archive releases install lock on already-installed 409", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-lock-release-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  const preDir = path.join(workspaceDir, "apps", "minimal");
  fs.mkdirSync(preDir, { recursive: true });
  fs.writeFileSync(path.join(preDir, "sentinel.txt"), "existing");
  const app = buildTestRuntimeApiServer({ store });

  const stagedArchive = path.join(os.tmpdir(), `install-archive-lock-release-${Date.now()}.tar.gz`);
  fs.copyFileSync(MINIMAL_APP_FIXTURE, stagedArchive);

  try {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: workspace.id,
        app_id: "minimal",
        archive_path: stagedArchive,
      },
    });
    assert.equal(first.statusCode, 409);
    assert.match(first.json().detail ?? "", /already installed/);

    // Second request for the same (workspaceId, appId) must still hit the
    // "already installed" branch — NOT "install already in progress", which
    // would indicate a stale lock.
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/apps/install-archive",
      payload: {
        workspace_id: workspace.id,
        app_id: "minimal",
        archive_path: stagedArchive,
      },
    });
    assert.equal(second.statusCode, 409);
    assert.match(second.json().detail ?? "", /already installed/);
    assert.doesNotMatch(second.json().detail ?? "", /install already in progress/);
  } finally {
    fs.rmSync(stagedArchive, { force: true });
    await app.close();
    store.close();
  }
});

// Regression: concurrent archive_url installs for the same (workspaceId, appId)
// must be serialized. Previously the install lock was only set after the await
// on downloadArchiveToTemp, so two simultaneous requests could both pass the
// in-flight check, both download, and both reach extraction/registration.
test("POST /apps/install-archive serializes concurrent archive_url installs", async () => {
  const root = makeTempDir("hb-runtime-api-install-archive-url-race-");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Test Workspace",
    harness: "pi",
    status: "active",
  });
  const workspaceDir = store.workspaceDir(workspace.id);
  fs.mkdirSync(workspaceDir, { recursive: true });
  const app = buildTestRuntimeApiServer({ store });

  const fixtureBuf = fs.readFileSync(MINIMAL_APP_FIXTURE);
  // Delay every response by 300ms so the first download is still in flight
  // when the second request arrives, exercising the in-flight guard.
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/gzip" });
      res.end(fixtureBuf);
    }, 300);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no server address");
  const url = `http://127.0.0.1:${addr.port}/minimal.tar.gz`;

  const savedEnv = process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST;
  process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST = `http://127.0.0.1:${addr.port}/`;

  try {
    const payload = {
      workspace_id: workspace.id,
      app_id: "minimal",
      archive_url: url,
    };
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/v1/apps/install-archive", payload }),
      app.inject({ method: "POST", url: "/api/v1/apps/install-archive", payload }),
    ]);

    const codes = [a.statusCode, b.statusCode].sort((x, y) => x - y);
    assert.deepEqual(codes, [200, 409], `expected one 200 and one 409, got ${codes.join(",")}`);

    const loser = a.statusCode === 409 ? a : b;
    assert.match(
      loser.json().detail ?? "",
      /install already in progress/,
      "losing concurrent request must be rejected by the in-flight guard",
    );

    // Winner must have actually installed — exactly one install should win.
    const installed = path.join(
      store.workspaceDir(workspace.id),
      "apps",
      "minimal",
      "app.runtime.yaml",
    );
    assert.equal(fs.existsSync(installed), true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    if (savedEnv === undefined) {
      delete process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST;
    } else {
      process.env.HOLABOSS_APP_ARCHIVE_URL_ALLOWLIST = savedEnv;
    }
    await app.close();
    store.close();
  }
});
