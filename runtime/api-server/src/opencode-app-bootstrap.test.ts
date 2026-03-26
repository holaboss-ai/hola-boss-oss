import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import type { AppLifecycleExecutorLike } from "./app-lifecycle-worker.js";
import { runOpencodeAppBootstrapCli } from "./opencode-app-bootstrap.js";
import { bootstrapResolvedApplications, startOpencodeApplications } from "./opencode-bootstrap-shared.js";

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

function createStore(root: string): RuntimeStateStore {
  return new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
}

test("startOpencodeApplications validates the workspace and starts resolved apps", async () => {
  const root = makeTempDir("hb-opencode-bootstrap-");
  const store = createStore(root);
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode"
  });
  store.upsertAppBuild({
    workspaceId: workspace.id,
    appId: "app-a",
    status: "completed"
  });
  const calls: Array<Record<string, unknown>> = [];
  const appLifecycleExecutor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push(params as unknown as Record<string, unknown>);
      return {
        app_id: params.appId,
        status: "running",
        detail: "ok",
        ports: { http: params.httpPort ?? 18080, mcp: params.mcpPort ?? 13100 }
      };
    },
    async stopApp() {
      throw new Error("not implemented");
    },
    async shutdownAll() {
      throw new Error("not implemented");
    }
  };

  const result = await startOpencodeApplications({
    store,
    appLifecycleExecutor,
    workspaceId: workspace.id,
    body: {
      workspace_dir: store.workspaceDir(workspace.id),
      holaboss_user_id: "user-1",
      resolved_applications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 3099, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: ["HOLABOSS_USER_ID"],
          start_command: "npm run start",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "", stop: "" }
        }
      ]
    }
  });

  assert.deepEqual(result, {
    applications: [
      {
        app_id: "app-a",
        mcp_url: "http://localhost:13100/mcp",
        timeout_ms: 60000,
        ports: { http: 18080, mcp: 13100 }
      }
    ]
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.appId, "app-a");
  assert.equal(calls[0]?.appDir, path.join(store.workspaceDir(workspace.id), "apps", "app-a"));
  assert.equal(calls[0]?.skipSetup, true);
  store.close();
});

test("bootstrapResolvedApplications starts resolved apps without a runtime API hop", async () => {
  const root = makeTempDir("hb-opencode-bootstrap-direct-");
  const store = createStore(root);
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode"
  });
  store.upsertAppBuild({
    workspaceId: "workspace-1",
    appId: "app-a",
    status: "completed"
  });
  const workspaceDir = path.join(root, "workspace", "workspace-1");
  fs.mkdirSync(path.join(workspaceDir, "apps", "app-a"), { recursive: true });
  const calls: Array<Record<string, unknown>> = [];
  const appLifecycleExecutor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push(params as unknown as Record<string, unknown>);
      return {
        app_id: params.appId,
        status: "running",
        detail: "ok",
        ports: { http: params.httpPort ?? 18080, mcp: params.mcpPort ?? 13100 }
      };
    },
    async stopApp() {
      throw new Error("not implemented");
    },
    async shutdownAll() {
      throw new Error("not implemented");
    }
  };

  const result = await bootstrapResolvedApplications({
    workspaceDir,
    holabossUserId: "user-1",
    store,
    workspaceId: "workspace-1",
    resolvedApplications: [
      {
        app_id: "app-a",
        mcp: { transport: "http-sse", port: 3099, path: "/mcp" },
        health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
        env_contract: ["HOLABOSS_USER_ID"],
        start_command: "npm run start",
        base_dir: "apps/app-a",
        lifecycle: { setup: "", start: "", stop: "" }
      }
    ],
    appLifecycleExecutor
  });

  assert.deepEqual(result, {
    applications: [
      {
        app_id: "app-a",
        mcp_url: "http://localhost:13100/mcp",
        timeout_ms: 60000,
        ports: { http: 18080, mcp: 13100 }
      }
    ]
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.appId, "app-a");
  assert.equal(calls[0]?.appDir, path.join(workspaceDir, "apps", "app-a"));
  assert.equal(calls[0]?.skipSetup, true);
  store.close();
});

test("bootstrapResolvedApplications starts multiple apps in parallel", async () => {
  const root = makeTempDir("hb-opencode-bootstrap-parallel-");
  const workspaceDir = path.join(root, "workspace", "workspace-1");
  fs.mkdirSync(path.join(workspaceDir, "apps", "app-a"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "apps", "app-b"), { recursive: true });

  const startedAppIds: string[] = [];
  let resolveBothStarted: (() => void) | null = null;
  const bothStarted = new Promise<void>((resolve) => {
    resolveBothStarted = resolve;
  });
  let releaseStarts: (() => void) | null = null;
  const releaseGate = new Promise<void>((resolve) => {
    releaseStarts = resolve;
  });

  const appLifecycleExecutor: AppLifecycleExecutorLike = {
    async startApp(params) {
      startedAppIds.push(params.appId);
      if (startedAppIds.length === 2) {
        resolveBothStarted?.();
      }
      await releaseGate;
      return {
        app_id: params.appId,
        status: "running",
        detail: "ok",
        ports: { http: params.httpPort ?? 18080, mcp: params.mcpPort ?? 13100 }
      };
    },
    async stopApp() {
      throw new Error("not implemented");
    },
    async shutdownAll() {
      throw new Error("not implemented");
    }
  };

  const resultPromise = bootstrapResolvedApplications({
    workspaceDir,
    holabossUserId: "user-1",
    resolvedApplications: [
      {
        app_id: "app-a",
        mcp: { transport: "http-sse", port: 3099, path: "/mcp" },
        health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
        env_contract: ["HOLABOSS_USER_ID"],
        start_command: "npm run start",
        base_dir: "apps/app-a",
        lifecycle: { setup: "", start: "", stop: "" }
      },
      {
        app_id: "app-b",
        mcp: { transport: "http-sse", port: 3099, path: "/mcp" },
        health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
        env_contract: ["HOLABOSS_USER_ID"],
        start_command: "npm run start",
        base_dir: "apps/app-b",
        lifecycle: { setup: "", start: "", stop: "" }
      }
    ],
    appLifecycleExecutor
  });

  await bothStarted;
  assert.deepEqual(new Set(startedAppIds), new Set(["app-a", "app-b"]));
  releaseStarts?.();

  const result = await resultPromise;
  assert.deepEqual(
    result.applications.map((application) => application.app_id),
    ["app-a", "app-b"]
  );
});

test("runOpencodeAppBootstrapCli writes JSON response for a valid request", async () => {
  const root = makeTempDir("hb-opencode-bootstrap-cli-");
  const store = createStore(root);
  const workspace = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode"
  });
  const appLifecycleExecutor: AppLifecycleExecutorLike = {
    async startApp(params) {
      return {
        app_id: params.appId,
        status: "running",
        detail: "ok",
        ports: { http: params.httpPort ?? 18080, mcp: params.mcpPort ?? 13100 }
      };
    },
    async stopApp() {
      throw new Error("not implemented");
    },
    async shutdownAll() {
      throw new Error("not implemented");
    }
  };
  let stdout = "";
  let stderr = "";
  const exitCode = await runOpencodeAppBootstrapCli(
    [
      "--request-base64",
      Buffer.from(
        JSON.stringify({
          workspace_id: workspace.id,
          workspace_dir: store.workspaceDir(workspace.id),
          holaboss_user_id: "user-1",
          resolved_applications: [
            {
              app_id: "app-a",
              mcp: { transport: "http-sse", port: 3099, path: "/mcp" },
              health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
              env_contract: ["HOLABOSS_USER_ID"],
              start_command: "npm run start",
              base_dir: "apps/app-a",
              lifecycle: { setup: "", start: "", stop: "" }
            }
          ]
        }),
        "utf8"
      ).toString("base64")
    ],
    {
      store,
      appLifecycleExecutor,
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    applications: [
      {
        app_id: "app-a",
        mcp_url: "http://localhost:13100/mcp",
        timeout_ms: 60000,
        ports: { http: 18080, mcp: 13100 }
      }
    ]
  });
  store.close();
});
