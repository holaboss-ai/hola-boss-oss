import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { runtimeConfigHeaders } from "./runtime-config.js";

const TS_BRIDGE_WORKER_FLAG_ENV = "HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER";
const PROACTIVE_ENABLE_REMOTE_BRIDGE_ENV = "PROACTIVE_ENABLE_REMOTE_BRIDGE";
const PROACTIVE_BRIDGE_BASE_URL_ENV = "PROACTIVE_BRIDGE_BASE_URL";
const PROACTIVE_BRIDGE_POLL_INTERVAL_SECONDS_ENV = "PROACTIVE_BRIDGE_POLL_INTERVAL_SECONDS";
const PROACTIVE_BRIDGE_MAX_ITEMS_ENV = "PROACTIVE_BRIDGE_MAX_ITEMS";

type LoggerLike = {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

type StringMap = Record<string, unknown>;

export interface ProactiveBridgeJob {
  job_id: string;
  job_type: string;
  workspace_id: string;
  sandbox_id?: string | null;
  created_at?: string;
  lease_expires_at?: string | null;
  payload: Record<string, unknown>;
}

export interface ProactiveBridgeJobResult {
  job_id: string;
  status: string;
  workspace_id: string;
  job_type: string;
  completed_at?: string;
  output?: Record<string, unknown>;
  error_code?: string | null;
  error_message?: string | null;
}

function isRecord(value: unknown): value is StringMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function envFlagEnabled(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function envFlagDisabled(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return ["0", "false", "no", "off"].includes(raw);
}

export function bridgeEnabled(): boolean {
  return envFlagEnabled(PROACTIVE_ENABLE_REMOTE_BRIDGE_ENV);
}

export function tsBridgeWorkerEnabled(): boolean {
  if (!bridgeEnabled()) {
    return false;
  }
  if (envFlagDisabled(TS_BRIDGE_WORKER_FLAG_ENV)) {
    return false;
  }
  return true;
}

export function bridgePollIntervalMs(): number {
  const raw = (process.env[PROACTIVE_BRIDGE_POLL_INTERVAL_SECONDS_ENV] ?? "").trim();
  if (!raw) {
    return 5000;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return 5000;
  }
  return Math.min(Math.max(parsed, 0.5), 300.0) * 1000;
}

export function bridgeMaxItems(): number {
  const raw = (process.env[PROACTIVE_BRIDGE_MAX_ITEMS_ENV] ?? "").trim();
  if (!raw) {
    return 10;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 10;
  }
  return Math.min(Math.max(parsed, 1), 100);
}

function isProactiveBridgeJob(value: unknown): value is ProactiveBridgeJob {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.job_id === "string" &&
    typeof value.job_type === "string" &&
    typeof value.workspace_id === "string" &&
    isRecord(value.payload)
  );
}

function isProactiveBridgeJobResult(value: unknown): value is ProactiveBridgeJobResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.job_id === "string" &&
    typeof value.status === "string" &&
    typeof value.workspace_id === "string" &&
    typeof value.job_type === "string"
  );
}

export function proactiveBridgeHeaders(): Record<string, string> {
  const headers = runtimeConfigHeaders({ requireAuth: true, requireUser: false });
  if (!headers["X-API-Key"]) {
    throw new Error("Runtime bridge auth token is not configured");
  }
  return headers;
}

function proactiveBridgeBaseUrl(): string {
  const baseUrl = (process.env[PROACTIVE_BRIDGE_BASE_URL_ENV] ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("PROACTIVE_BRIDGE_BASE_URL is required for remote proactive bridge");
  }
  return baseUrl;
}

function runtimeAppRoot(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_APP_ROOT ?? "").trim();
  return configured || process.cwd();
}

function runtimePythonBin(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_PYTHON ?? "").trim();
  return configured || "python";
}

export async function executeBridgeJobWithPython(job: ProactiveBridgeJob): Promise<ProactiveBridgeJobResult> {
  const cwd = runtimeAppRoot();
  const pythonBin = runtimePythonBin();
  const jobBase64 = Buffer.from(JSON.stringify(job), "utf8").toString("base64");
  return await new Promise<ProactiveBridgeJobResult>((resolve, reject) => {
    const child = spawn(
      pythonBin,
      ["-m", "sandbox_agent_runtime.bridge_executor", "--job-base64", jobBase64],
      {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if ((code ?? 0) !== 0) {
        const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(new Error(`python bridge executor exited with code ${code ?? 0}${suffix}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (!isProactiveBridgeJobResult(parsed)) {
          throw new Error("bridge executor returned invalid JSON");
        }
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export interface BridgeWorkerLike {
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeRemoteBridgeWorkerOptions {
  logger?: LoggerLike;
  executeJob?: (job: ProactiveBridgeJob) => Promise<ProactiveBridgeJobResult>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxItems?: number;
}

export class RuntimeRemoteBridgeWorker implements BridgeWorkerLike {
  readonly #logger: LoggerLike | undefined;
  readonly #executeJob: (job: ProactiveBridgeJob) => Promise<ProactiveBridgeJobResult>;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  readonly #pollIntervalMs: number;
  readonly #maxItems: number;
  readonly #headers: Record<string, string>;
  #stopped = false;
  #task: Promise<void> | null = null;
  #wakeResolver: (() => void) | null = null;

  constructor(options: RuntimeRemoteBridgeWorkerOptions = {}) {
    this.#logger = options.logger;
    this.#executeJob = options.executeJob ?? executeBridgeJobWithPython;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#baseUrl = options.baseUrl ?? proactiveBridgeBaseUrl();
    this.#pollIntervalMs = options.pollIntervalMs ?? bridgePollIntervalMs();
    this.#maxItems = options.maxItems ?? bridgeMaxItems();
    this.#headers = proactiveBridgeHeaders();
  }

  async start(): Promise<void> {
    if (this.#task) {
      return;
    }
    this.#stopped = false;
    this.#task = this.#runLoop();
  }

  async close(): Promise<void> {
    this.#stopped = true;
    const resolve = this.#wakeResolver;
    this.#wakeResolver = null;
    resolve?.();
    const task = this.#task;
    this.#task = null;
    await task;
  }

  async pollOnce(): Promise<number> {
    const jobs = await this.#receiveJobs();
    for (const job of jobs) {
      try {
        const result = await this.#executeJob(job);
        await this.#reportResult(result);
      } catch (error) {
        this.#logger?.error?.("Remote proactive bridge job failed", {
          event: "runtime.proactive_bridge.job",
          outcome: "error",
          job_id: job.job_id,
          job_type: job.job_type,
          workspace_id: job.workspace_id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return jobs.length;
  }

  async #receiveJobs(): Promise<ProactiveBridgeJob[]> {
    const response = await this.#fetch(`${this.#baseUrl}/api/v1/proactive/bridge/jobs?limit=${this.#maxItems}`, {
      method: "GET",
      headers: this.#headers
    });
    if (!response.ok) {
      throw new Error(`Proactive bridge request failed: ${await response.text()}`);
    }
    const payload = await response.json();
    const jobs = isRecord(payload) && Array.isArray(payload.jobs) ? payload.jobs : [];
    return jobs.filter(isProactiveBridgeJob);
  }

  async #reportResult(result: ProactiveBridgeJobResult): Promise<void> {
    const response = await this.#fetch(`${this.#baseUrl}/api/v1/proactive/bridge/results`, {
      method: "POST",
      headers: {
        ...this.#headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(result)
    });
    if (!response.ok) {
      throw new Error(`Proactive bridge request failed: ${await response.text()}`);
    }
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopped) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.#logger?.error?.("Remote proactive bridge poll failed", {
          event: "runtime.proactive_bridge.poll",
          outcome: "error",
          error: error instanceof Error ? error.message : String(error)
        });
      }
      if (this.#stopped) {
        return;
      }
      await Promise.race([
        sleep(this.#pollIntervalMs),
        new Promise<void>((resolve) => {
          this.#wakeResolver = resolve;
        })
      ]);
      this.#wakeResolver = null;
    }
  }
}
