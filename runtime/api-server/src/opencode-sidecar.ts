import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { buildRunnerEnv, resolveOpencodeExecutable } from "./runner-worker.js";

const OPENCODE_STATE_VERSION = 1;
const OPENCODE_READY_POLL_MS = 100;
const OPENCODE_STOP_TIMEOUT_MS = 3000;

type OpencodeStateEntry = {
  pid: number;
  url: string;
  workspace_id: string;
  config_fingerprint: string;
};

type OpencodeSidecarDeps = {
  clearState?: (workspaceRoot: string) => void;
  isReady?: (url: string) => Promise<boolean>;
  killPid?: (pid: number) => void;
  listRunningPids?: (host: string, port: number) => Promise<number[]>;
  pidAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcessLike;
  terminatePid?: (pid: number) => void;
  waitForExit?: (child: ChildProcessLike, timeoutMs: number) => Promise<number | null>;
  writeState?: (workspaceRoot: string, entry: OpencodeStateEntry) => void;
};

type ChildProcessLike = Pick<ChildProcess, "pid" | "unref">;

export interface OpencodeSidecarCliRequest {
  workspace_root: string;
  workspace_id: string;
  host: string;
  port: number;
  readiness_url?: string;
  ready_timeout_s: number;
  config_fingerprint: string;
  allow_reuse_existing: boolean;
}

export interface OpencodeSidecarCliResponse {
  outcome: "reused" | "started";
  pid: number;
  url: string;
}

function stateDir(workspaceRoot: string): string {
  const dir = path.join(path.resolve(workspaceRoot), ".holaboss");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function opencodeStatePath(workspaceRoot: string): string {
  return path.join(stateDir(workspaceRoot), "opencode-sidecar-state.json");
}

function opencodeServerLogPath(workspaceRoot: string): string {
  return path.join(stateDir(workspaceRoot), "opencode-server.log");
}

function normalizeBaseUrl(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }
  if (trimmed.endsWith("/mcp")) {
    return trimmed.slice(0, -4) || null;
  }
  return trimmed;
}

function baseUrlFor(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function readinessUrlFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/mcp`;
}

function portFromUrl(url: string | null | undefined): number | null {
  const normalized = normalizeBaseUrl(url);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    const port = Number.parseInt(parsed.port, 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function decodeCliRequest(encoded: string): OpencodeSidecarCliRequest {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error("request_base64 is required");
  }
  const raw = Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request payload must be an object");
  }
  return parsed as OpencodeSidecarCliRequest;
}

function readOpencodeSidecarState(workspaceRoot: string): Partial<OpencodeStateEntry> {
  const statePath = opencodeStatePath(workspaceRoot);
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    const payload = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {};
    }
    if (Number(payload.version ?? 0) !== OPENCODE_STATE_VERSION) {
      return {};
    }
    const sidecar = payload.sidecar;
    if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) {
      return {};
    }
    return sidecar as Partial<OpencodeStateEntry>;
  } catch {
    return {};
  }
}

export function readOpencodeSidecarBaseUrl(workspaceRoot: string): string | null {
  const persisted = readOpencodeSidecarState(workspaceRoot);
  return normalizeBaseUrl(typeof persisted.url === "string" ? persisted.url : null);
}

function writeOpencodeSidecarState(workspaceRoot: string, entry: OpencodeStateEntry): void {
  fs.writeFileSync(
    opencodeStatePath(workspaceRoot),
    JSON.stringify(
      {
        version: OPENCODE_STATE_VERSION,
        sidecar: entry
      },
      null,
      2
    ),
    "utf8"
  );
}

function clearOpencodeSidecarState(workspaceRoot: string): void {
  fs.rmSync(opencodeStatePath(workspaceRoot), { force: true });
}

function opencodePidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminatePid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }
}

function killPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
}

async function opencodeSidecarIsReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(2000)
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function listOpencodeSidecarPids(host: string, port: number): Promise<number[]> {
  const processMarker = `opencode serve --hostname ${host} --port ${port}`;
  return await new Promise<number[]>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const psProcess = spawn("ps", ["-eo", "pid=,args="], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    psProcess.stdout?.setEncoding("utf8");
    psProcess.stderr?.setEncoding("utf8");
    psProcess.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    psProcess.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    psProcess.on("error", (error) => {
      reject(new Error(`failed to inspect running OpenCode sidecar processes: ${error}`));
    });
    psProcess.on("close", () => {
      if (stderr.trim()) {
        reject(new Error(`failed to inspect running OpenCode sidecar processes: ${stderr.trim()}`));
        return;
      }
      const pids: number[] = [];
      for (const line of stdout.split("\n")) {
        const row = line.trim();
        if (!row) {
          continue;
        }
        const parts = row.split(/\s+/, 2);
        if (parts.length !== 2) {
          continue;
        }
        const [pidToken, args] = parts;
        if (!args.includes(processMarker)) {
          continue;
        }
        const pid = Number.parseInt(pidToken, 10);
        if (Number.isFinite(pid)) {
          pids.push(pid);
        }
      }
      resolve(pids);
    });
  });
}

async function waitForOpencodeReady(
  url: string,
  timeoutSeconds: number,
  deps: Pick<OpencodeSidecarDeps, "isReady" | "sleep">
): Promise<void> {
  const isReady = deps.isReady ?? opencodeSidecarIsReady;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (await isReady(url)) {
      return;
    }
    await sleep(OPENCODE_READY_POLL_MS);
  }
  throw new Error(`OpenCode sidecar readiness timed out for ${url}`);
}

async function canListenOnPort(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port =
        address && typeof address === "object" && typeof address.port === "number" && Number.isFinite(address.port)
          ? address.port
          : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port || port <= 0) {
          reject(new Error("failed to allocate an OpenCode sidecar port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

function defaultSpawnProcess(command: string, args: string[], options: SpawnOptions): ChildProcessLike {
  return spawn(command, args, options);
}

async function defaultWaitForExit(child: ChildProcessLike, timeoutMs: number): Promise<number | null> {
  const processWithEvents = child as ChildProcess;
  if (typeof processWithEvents.once !== "function") {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    return null;
  }
  return await new Promise<number | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(null);
    }, timeoutMs);
    processWithEvents.once("exit", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (typeof code === "number") {
        resolve(code);
        return;
      }
      if (signal === "SIGTERM") {
        resolve(-15);
        return;
      }
      resolve(null);
    });
  });
}

export async function restartOpencodeSidecar(
  request: OpencodeSidecarCliRequest,
  deps: OpencodeSidecarDeps = {}
): Promise<OpencodeSidecarCliResponse> {
  const workspaceRoot = path.resolve(request.workspace_root);
  const persistedState = readOpencodeSidecarState(workspaceRoot);
  const persistedFingerprint = String(persistedState.config_fingerprint ?? "").trim();
  const persistedPid = Number(persistedState.pid ?? 0);
  const persistedBaseUrl = readOpencodeSidecarBaseUrl(workspaceRoot);
  const requestedBaseUrl =
    normalizeBaseUrl(request.readiness_url) ??
    (request.port > 0 ? baseUrlFor(request.host, request.port) : null);
  const fingerprintMatches = Boolean(request.config_fingerprint) && persistedFingerprint === request.config_fingerprint;
  const isReady = deps.isReady ?? opencodeSidecarIsReady;
  const reusableBaseUrl = persistedBaseUrl ?? requestedBaseUrl;

  if (reusableBaseUrl && (await isReady(readinessUrlFor(reusableBaseUrl)))) {
    if (request.allow_reuse_existing || fingerprintMatches) {
      return {
        outcome: "reused",
        pid: persistedPid,
        url: reusableBaseUrl
      };
    }
  }

  const clearState = deps.clearState ?? clearOpencodeSidecarState;
  if (persistedPid && !(deps.pidAlive ?? opencodePidAlive)(persistedPid)) {
    clearState(workspaceRoot);
  }

  const listRunning = deps.listRunningPids ?? listOpencodeSidecarPids;
  let targetPort = request.port > 0 ? request.port : (portFromUrl(persistedBaseUrl) ?? 0);
  if (
    request.port <= 0 &&
    targetPort > 0 &&
    !(await canListenOnPort(request.host, targetPort)) &&
    (await listRunning(request.host, targetPort)).length === 0
  ) {
    targetPort = 0;
  }
  if (targetPort <= 0) {
    targetPort = await findAvailablePort(request.host);
  }
  const targetBaseUrl = baseUrlFor(request.host, targetPort);
  const targetReadinessUrl = readinessUrlFor(targetBaseUrl);

  const runningPids = await listRunning(request.host, targetPort);
  for (const pid of Array.from(new Set(runningPids)).sort((left, right) => left - right)) {
    (deps.terminatePid ?? terminatePid)(pid);
  }

  if (runningPids.length > 0) {
    const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + OPENCODE_STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if ((await listRunning(request.host, targetPort)).length === 0) {
        break;
      }
      await sleep(OPENCODE_READY_POLL_MS);
    }
    const remaining = await listRunning(request.host, targetPort);
    for (const pid of Array.from(new Set(remaining)).sort((left, right) => left - right)) {
      (deps.killPid ?? killPid)(pid);
    }
    if (remaining.length > 0) {
      await sleep(OPENCODE_READY_POLL_MS);
      if ((await listRunning(request.host, targetPort)).length > 0) {
        throw new Error("failed to stop existing OpenCode sidecar before restart");
      }
    }
  }

  const serverLogPath = opencodeServerLogPath(workspaceRoot);
  const logFd = fs.openSync(serverLogPath, "a");
  let child: ChildProcessLike;
  try {
    child = (deps.spawnProcess ?? defaultSpawnProcess)(
      resolveOpencodeExecutable(),
      [
        "serve",
        "--print-logs",
        "--log-level",
        "DEBUG",
        "--hostname",
        request.host,
        "--port",
        String(targetPort)
      ],
      {
        cwd: workspaceRoot,
        env: buildRunnerEnv(),
        stdio: ["ignore", logFd, logFd],
        detached: true
      }
    );
  } catch (error) {
    fs.closeSync(logFd);
    throw new Error(`failed to restart OpenCode sidecar: ${error instanceof Error ? error.message : String(error)}`);
  }
  fs.closeSync(logFd);

  const exitCode = await (deps.waitForExit ?? defaultWaitForExit)(child, 200);
  if (exitCode !== null && exitCode !== -15) {
    clearState(workspaceRoot);
    throw new Error(`OpenCode sidecar exited during startup with code ${exitCode}`);
  }

  await waitForOpencodeReady(targetReadinessUrl, request.ready_timeout_s, deps);
  (deps.writeState ?? writeOpencodeSidecarState)(workspaceRoot, {
    pid: child.pid ?? 0,
    url: targetBaseUrl,
    workspace_id: request.workspace_id,
    config_fingerprint: request.config_fingerprint
  });
  child.unref();
  return {
    outcome: "started",
    pid: child.pid ?? 0,
    url: targetBaseUrl
  };
}

export async function runOpencodeSidecarCli(
  argv: string[],
  options: {
    io?: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
    restartSidecar?: (request: OpencodeSidecarCliRequest) => Promise<OpencodeSidecarCliResponse>;
  } = {}
): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const requestBase64 = argv[0] === "--request-base64" ? argv[1] ?? "" : argv[0] ?? "";
  if (!requestBase64) {
    io.stderr.write("request_base64 is required\n");
    return 2;
  }
  try {
    const request = decodeCliRequest(requestBase64);
    const result = await (options.restartSidecar ?? restartOpencodeSidecar)(request);
    io.stdout.write(JSON.stringify(result));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runOpencodeSidecarCli(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
