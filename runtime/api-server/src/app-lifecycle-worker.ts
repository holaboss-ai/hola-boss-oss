import { spawn } from "node:child_process";
import fs from "node:fs";

import { type RuntimeStateStore } from "@holaboss/runtime-state-store";

import { resolveIntegrationRuntime } from "./integration-runtime.js";
import type { ResolvedApplicationRuntime, WorkspaceComposeShutdownTarget } from "./workspace-apps.js";
import { buildAppSetupEnv } from "./app-setup-env.js";

export interface AppLifecycleActionResult {
  app_id: string;
  status: string;
  detail: string;
  ports: Record<string, number>;
}

export interface LifecycleShutdownResult {
  stopped: string[];
  failed: string[];
}

export interface LifecycleShutdownParams {
  targets?: WorkspaceComposeShutdownTarget[];
}

export interface AppLifecycleStartParams {
  appId: string;
  appDir?: string;
  httpPort?: number;
  mcpPort?: number;
  holabossUserId?: string;
  resolvedApp?: ResolvedApplicationRuntime;
  skipSetup?: boolean;
  spawnImpl?: SpawnLike;
  fetchImpl?: typeof fetch;
}

export interface RuntimeAppLifecycleExecutorOptions {
  store?: RuntimeStateStore | null;
  runtimeApiUrl?: string | null;
}

export interface AppLifecycleExecutorLike {
  startApp(params: AppLifecycleStartParams): Promise<AppLifecycleActionResult>;
  stopApp(params: {
    appId: string;
    appDir?: string;
    resolvedApp?: ResolvedApplicationRuntime;
  }): Promise<AppLifecycleActionResult>;
  shutdownAll(params?: LifecycleShutdownParams): Promise<LifecycleShutdownResult>;
}

export class AppLifecycleExecutorError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

type SpawnLike = typeof spawn;
type ChildLike = ReturnType<SpawnLike>;

type ShellLifecyclePorts = { http: number; mcp: number };

const shellLifecycleProcesses = new Map<string, ChildLike>();
const shellLifecyclePorts = new Map<string, ShellLifecyclePorts>();
const appStartOperations = new Map<string, Promise<AppLifecycleActionResult>>();

export function appBuildHasCompletedSetup(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "completed" || normalized === "running" || normalized === "stopped";
}

function appStartKey(params: {
  appId: string;
  appDir?: string;
  httpPort?: number;
  mcpPort?: number;
}): string {
  if (params.appDir && params.appDir.trim()) {
    return params.appDir;
  }
  return `${params.appId}:${params.httpPort ?? "http"}:${params.mcpPort ?? "mcp"}`;
}

async function withAppStartOperation(
  params: {
    appId: string;
    appDir?: string;
    httpPort?: number;
    mcpPort?: number;
  },
  operation: () => Promise<AppLifecycleActionResult>
): Promise<AppLifecycleActionResult> {
  const key = appStartKey(params);
  const inFlight = appStartOperations.get(key);
  if (inFlight) {
    return await inFlight;
  }
  const promise = (async () => await operation())();
  appStartOperations.set(key, promise);
  try {
    return await promise;
  } finally {
    if (appStartOperations.get(key) === promise) {
      appStartOperations.delete(key);
    }
  }
}

async function waitForExit(child: ChildLike, options: { captureStderr?: boolean } = {}): Promise<{ code: number; stderr: string }> {
  return await new Promise((resolve, reject) => {
    let stderr = "";
    if (options.captureStderr && child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stderr: stderr.trim() });
    });
  });
}

function patchComposePorts(
  composePath: string,
  params: {
    containerHttpPort: number;
    hostHttpPort: number;
    containerMcpPort: number;
    hostMcpPort: number;
  }
): void {
  const original = fs.readFileSync(composePath, "utf8");
  let next = original.replace(
    new RegExp(`(- (?:["']?))\\d+:${params.containerHttpPort}\\b`, "g"),
    `$1${params.hostHttpPort}:${params.containerHttpPort}`
  );
  next = next.replace(
    new RegExp(`(- (?:["']?))\\d+:${params.containerMcpPort}\\b`, "g"),
    `$1${params.hostMcpPort}:${params.containerMcpPort}`
  );
  if (next !== original) {
    fs.writeFileSync(composePath, next, "utf8");
  }
}

function composeFilePath(appDir: string): string | null {
  for (const candidate of ["docker-compose.yml", "docker-compose.yaml"]) {
    const fullPath = `${appDir}/${candidate}`;
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function hasNativeComposeLifecycle(params: {
  appDir?: string;
  resolvedApp?: ResolvedApplicationRuntime;
}): params is { appDir: string; resolvedApp: ResolvedApplicationRuntime } {
  if (!params.appDir || !params.resolvedApp) {
    return false;
  }
  if (params.resolvedApp.lifecycle.start || params.resolvedApp.lifecycle.stop || params.resolvedApp.startCommand) {
    return false;
  }
  return composeFilePath(params.appDir) !== null;
}

function hasNativeShellLifecycle(params: {
  appDir?: string;
  resolvedApp?: ResolvedApplicationRuntime;
}): params is { appDir: string; resolvedApp: ResolvedApplicationRuntime } {
  if (!params.appDir || !params.resolvedApp) {
    return false;
  }
  if (params.resolvedApp.startCommand) {
    return false;
  }
  if (!params.resolvedApp.lifecycle.start && !params.resolvedApp.lifecycle.stop) {
    return false;
  }
  return true;
}

function hasNativeStartCommandLifecycle(params: {
  appDir?: string;
  resolvedApp?: ResolvedApplicationRuntime;
}): params is { appDir: string; resolvedApp: ResolvedApplicationRuntime } {
  if (!params.appDir || !params.resolvedApp) {
    return false;
  }
  if (params.resolvedApp.lifecycle.start || params.resolvedApp.lifecycle.stop) {
    return false;
  }
  return Boolean(params.resolvedApp.startCommand.trim());
}

async function runSpawn(
  spawnImpl: SpawnLike,
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    captureStdout?: boolean;
    captureStderr?: boolean;
    shell?: boolean;
  } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell,
      stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", options.captureStderr ? "pipe" : "ignore"]
    });
    if (options.captureStdout && child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }
    if (options.captureStderr && child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function buildShellLifecycleEnv(
  params: {
    appDir?: string;
    httpPort?: number;
    mcpPort?: number;
    holabossUserId?: string;
    resolvedApp?: ResolvedApplicationRuntime;
    integrationEnv?: NodeJS.ProcessEnv;
  }
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = params.appDir ? buildAppSetupEnv(params.appDir) : { ...process.env };
  if (params.integrationEnv) {
    Object.assign(env, params.integrationEnv);
  }
  if (params.httpPort !== undefined) {
    env.PORT = String(params.httpPort);
  }
  if (params.mcpPort !== undefined) {
    env.MCP_PORT = String(params.mcpPort);
  }
  if (
    params.holabossUserId &&
    params.resolvedApp &&
    params.resolvedApp.envContract.includes("HOLABOSS_USER_ID")
  ) {
    env.HOLABOSS_USER_ID = params.holabossUserId;
  }
  return env;
}

async function runLifecycleSetup(params: {
  appId: string;
  appDir: string;
  resolvedApp: ResolvedApplicationRuntime;
  httpPort: number;
  mcpPort: number;
  holabossUserId?: string;
  integrationEnv?: NodeJS.ProcessEnv;
  spawnImpl?: SpawnLike;
}): Promise<void> {
  const setupCommand = params.resolvedApp.lifecycle.setup.trim();
  if (!setupCommand) {
    return;
  }
  const spawnImpl = params.spawnImpl ?? spawn;
  const result = await runSpawn(spawnImpl, setupCommand, [], {
    cwd: params.appDir,
    env: buildShellLifecycleEnv(params),
    shell: true,
    captureStderr: true
  });
  if (result.code !== 0) {
    throw new Error(
      `App '${params.appId}' lifecycle.setup failed (rc=${result.code}): ${result.stderr.slice(0, 500)}`
    );
  }
}

async function killTrackedProcess(proc: ChildLike, timeoutMs: number): Promise<void> {
  if (typeof proc.exitCode === "number") {
    return;
  }
  try {
    proc.kill();
    await Promise.race([
      waitForExit(proc),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      })
    ]);
  } catch {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }
}

async function killAllocatedPortListeners(appId: string, appDir: string, ports: ShellLifecyclePorts): Promise<void> {
  const killTerms = [ports.http, ports.mcp].map((port) => `kill $(lsof -t -i :${port} 2>/dev/null) 2>/dev/null || true`);
  await runSpawn(spawn, "/bin/bash", ["-lc", killTerms.join(" ; ")], {
    cwd: appDir,
    env: process.env
  });
  shellLifecyclePorts.delete(appId);
}

export async function findComposeCommand(spawnImpl: SpawnLike = spawn): Promise<string[] | null> {
  for (const cmd of [["docker", "compose"], ["docker-compose"]]) {
    try {
      const child = spawnImpl(cmd[0]!, [...cmd.slice(1), "version"], {
        stdio: ["ignore", "ignore", "ignore"]
      });
      const { code } = await waitForExit(child);
      if (code === 0) {
        return cmd;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function shutdownComposeTargets(
  targets: WorkspaceComposeShutdownTarget[],
  spawnImpl: SpawnLike = spawn
): Promise<LifecycleShutdownResult> {
  const composeCmd = await findComposeCommand(spawnImpl);
  if (!composeCmd) {
    return { stopped: [], failed: targets.map((target) => target.appId) };
  }

  const stopped: string[] = [];
  const failed: string[] = [];
  for (const target of targets) {
    try {
      const child = spawnImpl(composeCmd[0]!, [...composeCmd.slice(1), "down", "--remove-orphans"], {
        cwd: target.appDir,
        env: process.env,
        stdio: ["ignore", "ignore", "pipe"]
      });
      const { code } = await waitForExit(child, { captureStderr: true });
      if (code === 0) {
        stopped.push(target.appId);
      } else {
        failed.push(target.appId);
      }
    } catch {
      failed.push(target.appId);
    }
  }
  return { stopped, failed };
}

async function composeImagesExist(
  composeCmd: string[],
  appDir: string,
  spawnImpl: SpawnLike,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const images = await runSpawn(spawnImpl, composeCmd[0]!, [...composeCmd.slice(1), "images", "-q"], {
    cwd: appDir,
    env,
    captureStdout: true
  });
  const services = await runSpawn(spawnImpl, composeCmd[0]!, [...composeCmd.slice(1), "config", "--services"], {
    cwd: appDir,
    env,
    captureStdout: true
  });
  const imageCount = images.stdout ? images.stdout.split("\n").filter(Boolean).length : 0;
  const serviceCount = services.stdout ? services.stdout.split("\n").filter(Boolean).length : 0;
  return serviceCount > 0 && imageCount >= serviceCount;
}

function healthProbeUrls(params: {
  resolvedApp: ResolvedApplicationRuntime;
  httpPort: number;
  mcpPort: number;
}): Array<{ kind: "http" | "mcp"; url: string }> {
  return [
    { kind: "http", url: `http://localhost:${params.httpPort}/` },
    { kind: "mcp", url: `http://localhost:${params.mcpPort}${params.resolvedApp.healthCheck.path}` }
  ];
}

export async function isAppHealthy(
  params: {
    resolvedApp: ResolvedApplicationRuntime;
    httpPort: number;
    mcpPort: number;
    fetchImpl?: typeof fetch;
  }
): Promise<boolean> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const probes = healthProbeUrls(params);
  if (probes.length === 0) {
    return false;
  }
  for (const probe of probes) {
    try {
      const response = await fetchImpl(probe.url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(3000)
      });
      if (probe.kind === "http") {
        if (response.status >= 200 && response.status < 400) {
          continue;
        }
        return false;
      }
      if (probe.kind === "mcp") {
        if (response.status === 200) {
          continue;
        }
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function waitHealthy(
  params: {
    resolvedApp: ResolvedApplicationRuntime;
    httpPort: number;
    mcpPort: number;
    fetchImpl?: typeof fetch;
    timeoutSeconds?: number;
    intervalSeconds?: number;
  }
): Promise<void> {
  const timeoutMs = (params.timeoutSeconds ?? params.resolvedApp.healthCheck.timeoutS) * 1000;
  const intervalMs = (params.intervalSeconds ?? params.resolvedApp.healthCheck.intervalS) * 1000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAppHealthy(params)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`App '${params.resolvedApp.appId}' did not become healthy within ${params.resolvedApp.healthCheck.timeoutS}s`);
}

export async function startComposeAppTarget(params: {
  appId: string;
  appDir: string;
  resolvedApp: ResolvedApplicationRuntime;
  httpPort: number;
  mcpPort: number;
  holabossUserId?: string;
  integrationEnv?: NodeJS.ProcessEnv;
  spawnImpl?: SpawnLike;
  fetchImpl?: typeof fetch;
}): Promise<AppLifecycleActionResult> {
  return await withAppStartOperation(params, async () => {
    const spawnImpl = params.spawnImpl ?? spawn;
    const composeCmd = await findComposeCommand(spawnImpl);
    if (!composeCmd) {
      throw new Error(`App '${params.appId}' requires docker compose but it is not available`);
    }

    if (await isAppHealthy(params)) {
      return {
        app_id: params.appId,
        status: "started",
        detail: "app started with lifecycle manager",
        ports: { http: params.httpPort, mcp: params.mcpPort }
      };
    }

    const composePath = composeFilePath(params.appDir);
    if (!composePath) {
      throw new Error(`App '${params.appId}' has no docker-compose.yml; cannot launch`);
    }

    patchComposePorts(composePath, {
      containerHttpPort: 8080,
      hostHttpPort: params.httpPort,
      containerMcpPort: params.resolvedApp.mcp.port,
      hostMcpPort: params.mcpPort
    });
    const composeEnv = buildShellLifecycleEnv(params);

    const hasImages = await composeImagesExist(composeCmd, params.appDir, spawnImpl, composeEnv);
    const upArgs = hasImages ? [...composeCmd.slice(1), "up", "-d"] : [...composeCmd.slice(1), "up", "--build", "-d"];
    let upResult = await runSpawn(spawnImpl, composeCmd[0]!, upArgs, {
      cwd: params.appDir,
      env: composeEnv,
      captureStderr: true
    });
    if (upResult.code !== 0) {
      throw new Error(`App '${params.appId}' docker compose up failed (rc=${upResult.code}): ${upResult.stderr.slice(0, 500)}`);
    }

    try {
      await waitHealthy(params);
    } catch (error) {
      upResult = await runSpawn(spawnImpl, composeCmd[0]!, [...composeCmd.slice(1), "up", "--build", "-d"], {
        cwd: params.appDir,
        env: composeEnv,
        captureStderr: true
      });
      if (upResult.code !== 0) {
        throw error;
      }
      await waitHealthy(params);
    }

    return {
      app_id: params.appId,
      status: "started",
      detail: "app started with lifecycle manager",
      ports: { http: params.httpPort, mcp: params.mcpPort }
    };
  });
}

export async function startShellLifecycleAppTarget(params: {
  appId: string;
  appDir: string;
  resolvedApp: ResolvedApplicationRuntime;
  httpPort: number;
  mcpPort: number;
  holabossUserId?: string;
  integrationEnv?: NodeJS.ProcessEnv;
  skipSetup?: boolean;
  spawnImpl?: SpawnLike;
  fetchImpl?: typeof fetch;
}): Promise<AppLifecycleActionResult> {
  return await withAppStartOperation(params, async () => {
    const spawnImpl = params.spawnImpl ?? spawn;
    const lifecycleStart = params.resolvedApp.lifecycle.start.trim();
    if (!lifecycleStart) {
      throw new Error(`App '${params.appId}' does not define lifecycle.start`);
    }

    if (await isAppHealthy(params)) {
      return {
        app_id: params.appId,
        status: "started",
        detail: "app started with lifecycle manager",
        ports: { http: params.httpPort, mcp: params.mcpPort }
      };
    }

    if (!params.skipSetup) {
      await runLifecycleSetup(params);
    }

    const child = spawnImpl(lifecycleStart, [], {
      cwd: params.appDir,
      env: buildShellLifecycleEnv(params),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    shellLifecycleProcesses.set(params.appId, child);
    shellLifecyclePorts.set(params.appId, { http: params.httpPort, mcp: params.mcpPort });

    await waitHealthy(params);
    return {
      app_id: params.appId,
      status: "started",
      detail: "app started with lifecycle manager",
      ports: { http: params.httpPort, mcp: params.mcpPort }
    };
  });
}

export async function startSubprocessAppTarget(params: {
  appId: string;
  appDir: string;
  resolvedApp: ResolvedApplicationRuntime;
  httpPort: number;
  mcpPort: number;
  holabossUserId?: string;
  integrationEnv?: NodeJS.ProcessEnv;
  skipSetup?: boolean;
  spawnImpl?: SpawnLike;
  fetchImpl?: typeof fetch;
}): Promise<AppLifecycleActionResult> {
  return await withAppStartOperation(params, async () => {
    const spawnImpl = params.spawnImpl ?? spawn;
    const startCommand = params.resolvedApp.startCommand.trim();
    if (!startCommand) {
      throw new Error(`App '${params.appId}' does not define startCommand`);
    }

    if (await isAppHealthy(params)) {
      return {
        app_id: params.appId,
        status: "started",
        detail: "app started with lifecycle manager",
        ports: { http: params.httpPort, mcp: params.mcpPort }
      };
    }

    if (!params.skipSetup) {
      await runLifecycleSetup(params);
    }

    const child = spawnImpl(startCommand, [], {
      cwd: params.appDir,
      env: buildShellLifecycleEnv(params),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    shellLifecycleProcesses.set(params.appId, child);
    shellLifecyclePorts.set(params.appId, { http: params.httpPort, mcp: params.mcpPort });

    await waitHealthy(params);
    return {
      app_id: params.appId,
      status: "started",
      detail: "app started with lifecycle manager",
      ports: { http: params.httpPort, mcp: params.mcpPort }
    };
  });
}

export async function stopShellLifecycleAppTarget(params: {
  appId: string;
  appDir: string;
  resolvedApp: ResolvedApplicationRuntime;
  spawnImpl?: SpawnLike;
}): Promise<AppLifecycleActionResult> {
  const spawnImpl = params.spawnImpl ?? spawn;
  const lifecycleStop = params.resolvedApp.lifecycle.stop.trim();
  const trackedProc = shellLifecycleProcesses.get(params.appId) ?? null;
  let stopError: Error | null = null;

  if (lifecycleStop) {
    try {
      const child = spawnImpl(lifecycleStop, [], {
        cwd: params.appDir,
        env: buildShellLifecycleEnv({}),
        shell: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let timeoutHandle: NodeJS.Timeout | null = null;
      const stopper = await Promise.race([
        waitForExit(child, { captureStderr: true }),
        new Promise<{ code: number; stderr: string }>((resolve) => {
          timeoutHandle = setTimeout(() => resolve({ code: 124, stderr: "timeout" }), 30000);
        })
      ]);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (stopper.code !== 0) {
        if (stopper.code === 124) {
          try {
            child.kill();
          } catch {
            // ignore
          }
        }
        stopError = new Error(`App '${params.appId}' lifecycle.stop failed (rc=${stopper.code}): ${stopper.stderr.slice(0, 500)}`);
      }
    } catch (error) {
      stopError = error instanceof Error ? error : new Error(String(error));
    }
  } else if (trackedProc) {
    await killTrackedProcess(trackedProc, 10000);
  }

  if (trackedProc) {
    await killTrackedProcess(trackedProc, 10000);
  }
  shellLifecycleProcesses.delete(params.appId);
  const ports = shellLifecyclePorts.get(params.appId);
  if (ports) {
    await killAllocatedPortListeners(params.appId, params.appDir, ports);
  }

  if (stopError) {
    throw stopError;
  }

  return {
    app_id: params.appId,
    status: "stopped",
    detail: "app stopped via lifecycle manager",
    ports: {}
  };
}

export async function stopSubprocessAppTarget(params: {
  appId: string;
  appDir: string;
}): Promise<AppLifecycleActionResult> {
  const trackedProc = shellLifecycleProcesses.get(params.appId) ?? null;
  if (trackedProc) {
    await killTrackedProcess(trackedProc, 10000);
  }
  shellLifecycleProcesses.delete(params.appId);
  const ports = shellLifecyclePorts.get(params.appId);
  if (ports) {
    await killAllocatedPortListeners(params.appId, params.appDir, ports);
  }
  return {
    app_id: params.appId,
    status: "stopped",
    detail: "app stopped via lifecycle manager",
    ports: {}
  };
}

export async function stopComposeAppTarget(params: {
  appId: string;
  appDir: string;
  spawnImpl?: SpawnLike;
}): Promise<AppLifecycleActionResult> {
  const spawnImpl = params.spawnImpl ?? spawn;
  const composeCmd = await findComposeCommand(spawnImpl);
  if (!composeCmd) {
    throw new Error(`App '${params.appId}' requires docker compose but it is not available`);
  }
  const result = await runSpawn(spawnImpl, composeCmd[0]!, [...composeCmd.slice(1), "down", "--remove-orphans"], {
    cwd: params.appDir,
    env: process.env,
    captureStderr: true
  });
  if (result.code !== 0) {
    throw new Error(`App '${params.appId}' docker compose down failed (rc=${result.code}): ${result.stderr.slice(0, 500)}`);
  }
  return {
    app_id: params.appId,
    status: "stopped",
    detail: "app stopped via lifecycle manager",
    ports: {}
  };
}

function unsupportedStartError(params: {
  appId: string;
  appDir?: string;
  resolvedApp?: ResolvedApplicationRuntime;
}): AppLifecycleExecutorError {
  const composePresent = params.appDir ? composeFilePath(params.appDir) !== null : false;
  const hasLifecycleStart = Boolean(params.resolvedApp?.lifecycle.start?.trim());
  const hasStartCommand = Boolean(params.resolvedApp?.startCommand?.trim());
  if (!params.resolvedApp) {
    return new AppLifecycleExecutorError(400, `App '${params.appId}' metadata is not available`);
  }
  if (!hasLifecycleStart && !hasStartCommand && !composePresent) {
    return new AppLifecycleExecutorError(
      500,
      `App '${params.appId}' has no lifecycle.start, no startCommand, and no docker-compose.yml; cannot launch`
    );
  }
  return new AppLifecycleExecutorError(500, `App '${params.appId}' could not be started with the current lifecycle configuration`);
}

export class RuntimeAppLifecycleExecutor implements AppLifecycleExecutorLike {
  readonly store: RuntimeStateStore | null;

  private readonly runtimeApiUrl: string | null;

  constructor(options: RuntimeAppLifecycleExecutorOptions = {}) {
    this.store = options.store ?? null;
    this.runtimeApiUrl = options.runtimeApiUrl ?? null;
  }

  async startApp(params: AppLifecycleStartParams): Promise<AppLifecycleActionResult> {
    const integrationBrokerUrl = this.runtimeApiUrl
      ? `${this.runtimeApiUrl.replace(/\/+$/, "")}/api/v1/integrations`
      : undefined;
    const integrationRuntime =
      this.store && params.appDir && params.resolvedApp
        ? resolveIntegrationRuntime({
            store: this.store,
            appId: params.appId,
            appDir: params.appDir,
            resolvedApp: params.resolvedApp,
            integrationBrokerUrl
          })
        : null;
    const integrationEnv = integrationRuntime?.env ?? {};
    const spawnImpl = params.spawnImpl;
    const fetchImpl = params.fetchImpl;
    if (
      hasNativeComposeLifecycle(params) &&
      params.httpPort !== undefined &&
      params.mcpPort !== undefined
    ) {
      return await startComposeAppTarget({
        appId: params.appId,
        appDir: params.appDir,
        resolvedApp: params.resolvedApp,
        httpPort: params.httpPort,
        mcpPort: params.mcpPort,
        holabossUserId: params.holabossUserId,
        integrationEnv,
        spawnImpl,
        fetchImpl
      });
    }
    if (hasNativeShellLifecycle(params) && params.resolvedApp.lifecycle.start) {
      if (params.httpPort === undefined || params.mcpPort === undefined) {
        throw new Error("native lifecycle start requires assigned http and mcp ports");
      }
      return await startShellLifecycleAppTarget({
        appId: params.appId,
        appDir: params.appDir,
        resolvedApp: params.resolvedApp,
        httpPort: params.httpPort,
        mcpPort: params.mcpPort,
        holabossUserId: params.holabossUserId,
        skipSetup: params.skipSetup,
        integrationEnv,
        spawnImpl,
        fetchImpl
      });
    }
    if (hasNativeStartCommandLifecycle(params)) {
      if (params.httpPort === undefined || params.mcpPort === undefined) {
        throw new Error("native startCommand start requires assigned http and mcp ports");
      }
      return await startSubprocessAppTarget({
        appId: params.appId,
        appDir: params.appDir,
        resolvedApp: params.resolvedApp,
        httpPort: params.httpPort,
        mcpPort: params.mcpPort,
        holabossUserId: params.holabossUserId,
        skipSetup: params.skipSetup,
        integrationEnv,
        spawnImpl,
        fetchImpl
      });
    }
    throw unsupportedStartError(params);
  }

  async stopApp(params: {
    appId: string;
    appDir?: string;
    resolvedApp?: ResolvedApplicationRuntime;
  }): Promise<AppLifecycleActionResult> {
    if (hasNativeComposeLifecycle(params)) {
      return await stopComposeAppTarget({
        appId: params.appId,
        appDir: params.appDir
      });
    }
    if (hasNativeShellLifecycle(params)) {
      return await stopShellLifecycleAppTarget({
        appId: params.appId,
        appDir: params.appDir,
        resolvedApp: params.resolvedApp
      });
    }
    if (hasNativeStartCommandLifecycle(params)) {
      return await stopSubprocessAppTarget({
        appId: params.appId,
        appDir: params.appDir
      });
    }
    return {
      app_id: params.appId,
      status: "stopped",
      detail: "app stopped via lifecycle manager",
      ports: {}
    };
  }

  async shutdownAll(params: LifecycleShutdownParams = {}): Promise<LifecycleShutdownResult> {
    const targets = params.targets ?? [];
    if (targets.length === 0) {
      return { stopped: [], failed: [] };
    }
    return await shutdownComposeTargets(targets);
  }
}
