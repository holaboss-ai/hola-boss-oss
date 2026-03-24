import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  AppLifecycleExecutorError,
  findComposeCommand,
  RuntimeAppLifecycleExecutor,
  shutdownComposeTargets,
  startComposeAppTarget,
  startSubprocessAppTarget,
  startShellLifecycleAppTarget,
  stopComposeAppTarget,
  stopSubprocessAppTarget,
  stopShellLifecycleAppTarget
} from "./app-lifecycle-worker.js";

function makeSpawnStub(handlers: Record<string, { code: number }>) {
  return ((command: string, args?: readonly string[]) => {
    const key = `${command} ${(args ?? []).join(" ")}`.trim();
    const handler = handlers[key];
    if (!handler) {
      throw new Error(`unexpected spawn: ${key}`);
    }
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    queueMicrotask(() => {
      child.emit("close", handler.code);
    });
    return child;
  }) as typeof import("node:child_process").spawn;
}

test("findComposeCommand prefers docker compose when available", async () => {
  const spawnStub = makeSpawnStub({
    "docker compose version": { code: 0 }
  });

  const command = await findComposeCommand(spawnStub);

  assert.deepEqual(command, ["docker", "compose"]);
});

test("shutdownComposeTargets runs docker compose down for explicit targets", async () => {
  const calls: Array<{ key: string; cwd?: string }> = [];
  const spawnStub = ((command: string, args?: readonly string[], options?: { cwd?: string }) => {
    const key = `${command} ${(args ?? []).join(" ")}`.trim();
    calls.push({ key, cwd: options?.cwd });
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    queueMicrotask(() => {
      if (key === "docker compose version") {
        child.emit("close", 0);
        return;
      }
      child.emit("close", options?.cwd?.includes("/app-b") ? 1 : 0);
    });
    return child;
  }) as typeof import("node:child_process").spawn;

  const result = await shutdownComposeTargets(
    [
      { appId: "app-a", appDir: "/tmp/app-a" },
      { appId: "app-b", appDir: "/tmp/app-b" }
    ],
    spawnStub
  );

  assert.deepEqual(result, {
    stopped: ["app-a"],
    failed: ["app-b"]
  });
  assert.deepEqual(calls, [
    { key: "docker compose version", cwd: undefined },
    { key: "docker compose down --remove-orphans", cwd: "/tmp/app-a" },
    { key: "docker compose down --remove-orphans", cwd: "/tmp/app-b" }
  ]);
});

test("startComposeAppTarget patches ports, runs compose up, and waits healthy", async () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-compose-app-"));
  fs.writeFileSync(
    path.join(appDir, "docker-compose.yml"),
    ['services:', '  app:', '    ports:', '      - "9999:8080"', '      - "9998:4100"'].join("\n"),
    "utf8"
  );

  let started = false;
  const calls: Array<{ key: string; cwd?: string }> = [];
  const spawnStub = ((command: string, args?: readonly string[], options?: { cwd?: string }) => {
    const key = `${command} ${(args ?? []).join(" ")}`.trim();
    calls.push({ key, cwd: options?.cwd });
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    queueMicrotask(() => {
      if (key === "docker compose images -q") {
        child.stdout.emit("data", "image-1\n");
      }
      if (key === "docker compose config --services") {
        child.stdout.emit("data", "app\n");
      }
      if (key === "docker compose up -d") {
        started = true;
      }
      child.emit("close", 0);
    });
    return child;
  }) as typeof import("node:child_process").spawn;
  const fetchStub = (async (input: string | URL | RequestInfo) => {
    if (!started) {
      throw new Error("not healthy yet");
    }
    return new Response("", { status: String(input).includes("/health") ? 200 : 503 });
  }) as typeof fetch;

  const result = await startComposeAppTarget({
    appId: "app-a",
    appDir,
    resolvedApp: {
      appId: "app-a",
      mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
      healthCheck: { path: "/health", timeoutS: 1, intervalS: 0.01 },
      envContract: [],
      startCommand: "",
      baseDir: "apps/app-a",
      lifecycle: { setup: "", start: "", stop: "" }
    },
    httpPort: 18081,
    mcpPort: 13101,
    spawnImpl: spawnStub,
    fetchImpl: fetchStub
  });

  assert.deepEqual(result, {
    app_id: "app-a",
    status: "started",
    detail: "app started with lifecycle manager",
    ports: { http: 18081, mcp: 13101 }
  });
  assert.deepEqual(calls, [
    { key: "docker compose version", cwd: undefined },
    { key: "docker compose images -q", cwd: appDir },
    { key: "docker compose config --services", cwd: appDir },
    { key: "docker compose up -d", cwd: appDir }
  ]);
  const patched = fs.readFileSync(path.join(appDir, "docker-compose.yml"), "utf8");
  assert.match(patched, /18081:8080/);
  assert.match(patched, /13101:4100/);
});

test("stopComposeAppTarget runs compose down", async () => {
  const calls: Array<{ key: string; cwd?: string }> = [];
  const spawnStub = ((command: string, args?: readonly string[], options?: { cwd?: string }) => {
    const key = `${command} ${(args ?? []).join(" ")}`.trim();
    calls.push({ key, cwd: options?.cwd });
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    queueMicrotask(() => {
      child.emit("close", 0);
    });
    return child;
  }) as typeof import("node:child_process").spawn;

  const result = await stopComposeAppTarget({
    appId: "app-a",
    appDir: "/tmp/app-a",
    spawnImpl: spawnStub
  });

  assert.deepEqual(result, {
    app_id: "app-a",
    status: "stopped",
    detail: "app stopped via lifecycle manager",
    ports: {}
  });
  assert.deepEqual(calls, [
    { key: "docker compose version", cwd: undefined },
    { key: "docker compose down --remove-orphans", cwd: "/tmp/app-a" }
  ]);
});

test("startShellLifecycleAppTarget runs lifecycle.start and waits healthy", async () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-shell-app-"));
  const calls: Array<{ key: string; cwd?: string }> = [];
  let started = false;
  const spawnStub = ((command: string, args?: readonly string[], options?: { cwd?: string; shell?: boolean }) => {
    const key = `${command} ${(args ?? []).join(" ")}`.trim();
    calls.push({ key, cwd: options?.cwd });
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
      kill: () => void;
      exitCode?: number | null;
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.kill = () => {};
    started = key === "npm run start";
    queueMicrotask(() => {
      child.exitCode = 0;
      child.emit("close", 0);
    });
    return child;
  }) as typeof import("node:child_process").spawn;
  const fetchStub = (async (input: string | URL | RequestInfo) => {
    if (!started) {
      throw new Error("app not started yet");
    }
    return new Response("", { status: String(input).includes("/health") ? 200 : 503 });
  }) as typeof fetch;

  const result = await startShellLifecycleAppTarget({
    appId: "app-a",
    appDir,
    resolvedApp: {
      appId: "app-a",
      mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
      healthCheck: { path: "/health", timeoutS: 1, intervalS: 0.01 },
      envContract: ["HOLABOSS_USER_ID"],
      startCommand: "",
      baseDir: "apps/app-a",
      lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
    },
    httpPort: 18081,
    mcpPort: 13101,
    spawnImpl: spawnStub,
    fetchImpl: fetchStub
  });

  assert.deepEqual(result, {
    app_id: "app-a",
    status: "started",
    detail: "app started with lifecycle manager",
    ports: { http: 18081, mcp: 13101 }
  });
  assert.deepEqual(calls, [{ key: "npm run start", cwd: appDir }]);
});

test("stopShellLifecycleAppTarget runs lifecycle.stop and clears tracked shell state", async () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-shell-stop-"));
  const calls: Array<{ key: string; cwd?: string }> = [];
  const spawnStub = ((command: string, args?: readonly string[], options?: { cwd?: string; shell?: boolean }) => {
    const key = `${command} ${(args ?? []).join(" ")}`.trim();
    calls.push({ key, cwd: options?.cwd });
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
      kill: () => void;
      exitCode?: number | null;
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.kill = () => {};
    queueMicrotask(() => {
      child.exitCode = 0;
      child.emit("close", 0);
    });
    return child;
  }) as typeof import("node:child_process").spawn;

  await startShellLifecycleAppTarget({
    appId: "app-a",
    appDir,
    resolvedApp: {
      appId: "app-a",
      mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
      healthCheck: { path: "/health", timeoutS: 1, intervalS: 0.01 },
      envContract: [],
      startCommand: "",
      baseDir: "apps/app-a",
      lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
    },
    httpPort: 18081,
    mcpPort: 13101,
    spawnImpl: spawnStub,
    fetchImpl: (async () => new Response("", { status: 200 })) as typeof fetch
  });

  const result = await stopShellLifecycleAppTarget({
    appId: "app-a",
    appDir,
    resolvedApp: {
      appId: "app-a",
      mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
      healthCheck: { path: "/health", timeoutS: 1, intervalS: 0.01 },
      envContract: [],
      startCommand: "",
      baseDir: "apps/app-a",
      lifecycle: { setup: "", start: "npm run start", stop: "npm run stop" }
    },
    spawnImpl: spawnStub
  });

  assert.deepEqual(result, {
    app_id: "app-a",
    status: "stopped",
    detail: "app stopped via lifecycle manager",
    ports: {}
  });
  assert.deepEqual(calls, [{ key: "npm run stop", cwd: appDir }]);
});

test("startSubprocessAppTarget runs startCommand and waits healthy", async () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-subprocess-start-"));
  const calls: Array<{ key: string; cwd?: string }> = [];
  let started = false;
  const spawnStub = ((command: string, args?: readonly string[], options?: { cwd?: string; shell?: boolean }) => {
    const key = `${command} ${(args ?? []).join(" ")}`.trim();
    calls.push({ key, cwd: options?.cwd });
    started = true;
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
      kill: () => void;
      exitCode?: number | null;
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.kill = () => {};
    return child;
  }) as typeof import("node:child_process").spawn;

  const result = await startSubprocessAppTarget({
    appId: "app-legacy",
    appDir,
    resolvedApp: {
      appId: "app-legacy",
      mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
      healthCheck: { path: "/health", timeoutS: 1, intervalS: 0.01 },
      envContract: [],
      startCommand: "npm run legacy-start",
      baseDir: "apps/app-legacy",
      lifecycle: { setup: "", start: "", stop: "" }
    },
    httpPort: 18081,
    mcpPort: 13101,
    spawnImpl: spawnStub,
    fetchImpl: (async (input: string | URL | RequestInfo) => {
      if (!started) {
        throw new Error("app not started yet");
      }
      return new Response("", { status: String(input).includes("/health") ? 200 : 503 });
    }) as typeof fetch
  });

  assert.deepEqual(result, {
    app_id: "app-legacy",
    status: "started",
    detail: "app started with lifecycle manager",
    ports: { http: 18081, mcp: 13101 }
  });
  assert.deepEqual(calls, [{ key: "npm run legacy-start", cwd: appDir }]);
});

test("stopSubprocessAppTarget kills tracked process and clears ports", async () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-subprocess-stop-"));
  const calls: Array<{ key: string; cwd?: string }> = [];
  const spawnStub = ((command: string, args?: readonly string[], options?: { cwd?: string; shell?: boolean }) => {
    const key = `${command} ${(args ?? []).join(" ")}`.trim();
    calls.push({ key, cwd: options?.cwd });
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
      kill: () => void;
      exitCode?: number | null;
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: (_encoding: string) => {} });
    child.kill = () => {
      child.exitCode = 0;
      queueMicrotask(() => child.emit("close", 0));
    };
    return child;
  }) as typeof import("node:child_process").spawn;

  await startSubprocessAppTarget({
    appId: "app-legacy",
    appDir,
    resolvedApp: {
      appId: "app-legacy",
      mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
      healthCheck: { path: "/health", timeoutS: 1, intervalS: 0.01 },
      envContract: [],
      startCommand: "npm run legacy-start",
      baseDir: "apps/app-legacy",
      lifecycle: { setup: "", start: "", stop: "" }
    },
    httpPort: 18081,
    mcpPort: 13101,
    spawnImpl: spawnStub,
    fetchImpl: (async () => new Response("", { status: 503 })) as typeof fetch
  }).catch(() => undefined);

  const result = await stopSubprocessAppTarget({
    appId: "app-legacy",
    appDir
  });

  assert.deepEqual(result, {
    app_id: "app-legacy",
    status: "stopped",
    detail: "app stopped via lifecycle manager",
    ports: {}
  });
});

test("lifecycle executor raises for unsupported startup configs", async () => {
  const executor = new RuntimeAppLifecycleExecutor();
  await assert.rejects(
    () =>
      executor.startApp({
        workspaceId: "workspace-1",
        appId: "app-legacy",
        appDir: "/tmp/app-legacy",
        resolvedApp: {
          appId: "app-legacy",
          mcp: { transport: "http-sse", port: 4100, path: "/mcp" },
          healthCheck: { path: "/health", timeoutS: 1, intervalS: 0.01 },
          envContract: [],
          startCommand: "",
          baseDir: "apps/app-legacy",
          lifecycle: { setup: "", start: "", stop: "" }
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppLifecycleExecutorError);
      assert.equal(error.statusCode, 500);
      assert.match(error.message, /has no lifecycle\.start, no startCommand, and no docker-compose\.yml/);
      return true;
    }
  );
});
