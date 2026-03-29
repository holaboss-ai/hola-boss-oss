import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import type { AppLifecycleExecutorLike } from "./app-lifecycle-worker.js";
import { runOpencodeAppBootstrapCli } from "./opencode-app-bootstrap.js";
import { bootstrapResolvedApplications, startResolvedApplications } from "./resolved-app-bootstrap.js";

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

async function withEnv(name: string, value: string, fn: () => Promise<void>): Promise<void> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

test("startResolvedApplications validates the workspace and starts resolved apps", async () => {
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
        ports: { http: params.httpPort ?? 0, mcp: params.mcpPort ?? 0 }
      };
    },
    async stopApp() {
      throw new Error("not implemented");
    },
    async shutdownAll() {
      throw new Error("not implemented");
    }
  };

  const result = await startResolvedApplications({
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

  assert.equal(result.applications.length, 1);
  const app = result.applications[0]!;
  assert.equal(app.app_id, "app-a");
  assert.equal(app.timeout_ms, 60000);
  assert.ok(app.ports.http >= 13100, "http port should be in dynamic range");
  assert.ok(app.ports.mcp >= 13100, "mcp port should be in dynamic range");
  assert.notEqual(app.ports.http, app.ports.mcp, "http and mcp should be different ports");
  assert.equal(app.mcp_url, `http://localhost:${app.ports.mcp}/mcp`);
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
        ports: { http: params.httpPort ?? 0, mcp: params.mcpPort ?? 0 }
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

  assert.equal(result.applications.length, 1);
  const app = result.applications[0]!;
  assert.equal(app.app_id, "app-a");
  assert.ok(app.ports.http >= 13100);
  assert.ok(app.ports.mcp >= 13100);
  assert.notEqual(app.ports.http, app.ports.mcp);
  assert.equal(app.mcp_url, `http://localhost:${app.ports.mcp}/mcp`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.appId, "app-a");
  assert.equal(calls[0]?.appDir, path.join(workspaceDir, "apps", "app-a"));
  assert.equal(calls[0]?.skipSetup, true);
  store.close();
});

test("bootstrapResolvedApplications waits for an in-flight app setup before starting", async () => {
  const root = makeTempDir("hb-opencode-bootstrap-wait-");
  const store = createStore(root);
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode"
  });
  const workspaceDir = path.join(root, "workspace", "workspace-1");
  fs.mkdirSync(path.join(workspaceDir, "apps", "app-a"), { recursive: true });
  store.upsertAppBuild({
    workspaceId: "workspace-1",
    appId: "app-a",
    status: "building"
  });
  const calls: Array<Record<string, unknown>> = [];
  const appLifecycleExecutor: AppLifecycleExecutorLike = {
    async startApp(params) {
      calls.push(params as unknown as Record<string, unknown>);
      return {
        app_id: params.appId,
        status: "running",
        detail: "ok",
        ports: { http: params.httpPort ?? 0, mcp: params.mcpPort ?? 0 }
      };
    },
    async stopApp() {
      throw new Error("not implemented");
    },
    async shutdownAll() {
      throw new Error("not implemented");
    }
  };

  setTimeout(() => {
    store.upsertAppBuild({
      workspaceId: "workspace-1",
      appId: "app-a",
      status: "completed"
    });
  }, 20);

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

  assert.equal(result.applications.length, 1);
  const app = result.applications[0]!;
  assert.ok(app.ports.http >= 13100);
  assert.ok(app.ports.mcp >= 13100);
  assert.notEqual(app.ports.http, app.ports.mcp);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.skipSetup, true);
  store.close();
});

test("bootstrapResolvedApplications surfaces a failed in-flight app setup", async () => {
  const root = makeTempDir("hb-opencode-bootstrap-failed-");
  const store = createStore(root);
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "opencode"
  });
  const workspaceDir = path.join(root, "workspace", "workspace-1");
  fs.mkdirSync(path.join(workspaceDir, "apps", "app-a"), { recursive: true });
  store.upsertAppBuild({
    workspaceId: "workspace-1",
    appId: "app-a",
    status: "building"
  });
  const appLifecycleExecutor: AppLifecycleExecutorLike = {
    async startApp() {
      throw new Error("startApp should not be called when setup fails");
    },
    async stopApp() {
      throw new Error("not implemented");
    },
    async shutdownAll() {
      throw new Error("not implemented");
    }
  };

  setTimeout(() => {
    store.upsertAppBuild({
      workspaceId: "workspace-1",
      appId: "app-a",
      status: "failed",
      error: "simulated failure"
    });
  }, 20);

  await assert.rejects(
    bootstrapResolvedApplications({
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
    }),
    /App 'app-a' setup failed: simulated failure/
  );
  store.close();
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
        ports: { http: params.httpPort ?? 0, mcp: params.mcpPort ?? 0 }
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
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.applications.length, 1);
  const app = parsed.applications[0];
  assert.equal(app.app_id, "app-a");
  assert.equal(app.timeout_ms, 60000);
  assert.ok(app.ports.http >= 13100);
  assert.ok(app.ports.mcp >= 13100);
  assert.notEqual(app.ports.http, app.ports.mcp);
  assert.equal(app.mcp_url, `http://localhost:${app.ports.mcp}/mcp`);
  store.close();
});

test("bootstrapResolvedApplications allocates unique ports per workspace in embedded runtime", async () => {
  await withEnv("HOLABOSS_EMBEDDED_RUNTIME", "1", async () => {
    const root = makeTempDir("hb-opencode-bootstrap-embedded-");
    const store = createStore(root);
    const appLifecycleExecutor: AppLifecycleExecutorLike = {
      async startApp(params) {
        return {
          app_id: params.appId,
          status: "running",
          detail: "ok",
          ports: { http: params.httpPort ?? 0, mcp: params.mcpPort ?? 0 }
        };
      },
      async stopApp() {
        throw new Error("not implemented");
      },
      async shutdownAll() {
        throw new Error("not implemented");
      }
    };

    for (const workspaceId of ["workspace-1", "workspace-2"]) {
      store.createWorkspace({
        workspaceId,
        name: workspaceId,
        harness: "opencode"
      });
      store.upsertAppBuild({
        workspaceId,
        appId: "app-a",
        status: "completed"
      });
      fs.mkdirSync(path.join(root, "workspace", workspaceId, "apps", "app-a"), { recursive: true });
    }

    const resultA = await bootstrapResolvedApplications({
      workspaceDir: path.join(root, "workspace", "workspace-1"),
      holabossUserId: "user-1",
      store,
      workspaceId: "workspace-1",
      resolvedApplications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 3099, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: [],
          start_command: "npm run start",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "", stop: "" }
        }
      ],
      appLifecycleExecutor
    });
    const resultB = await bootstrapResolvedApplications({
      workspaceDir: path.join(root, "workspace", "workspace-2"),
      holabossUserId: "user-1",
      store,
      workspaceId: "workspace-2",
      resolvedApplications: [
        {
          app_id: "app-a",
          mcp: { transport: "http-sse", port: 3099, path: "/mcp" },
          health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
          env_contract: [],
          start_command: "npm run start",
          base_dir: "apps/app-a",
          lifecycle: { setup: "", start: "", stop: "" }
        }
      ],
      appLifecycleExecutor
    });

    assert.equal(resultA.applications[0]?.ports.http, 38080);
    assert.equal(resultA.applications[0]?.ports.mcp, 38081);
    assert.equal(resultB.applications[0]?.ports.http, 38082);
    assert.equal(resultB.applications[0]?.ports.mcp, 38083);
    assert.notEqual(resultA.applications[0]?.ports.mcp, resultB.applications[0]?.ports.mcp);

    store.close();
  });
});
