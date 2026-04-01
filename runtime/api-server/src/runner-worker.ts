import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import path from "node:path";
import { Readable } from "node:stream";

const TERMINAL_EVENT_TYPES = new Set(["run_completed", "run_failed"]);
const DEFAULT_TS_RUNNER_COMMAND_TEMPLATE =
  "cd {runtime_root}/api-server && {runtime_node} dist/ts-runner.mjs --request-base64 {request_base64}";
const HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_RUN_TIMEOUT_SECONDS = 1800;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 180;
const DEFAULT_TASK_PROPOSAL_RUN_TIMEOUT_SECONDS = 7200;

export interface RunnerExecutorLike {
  run(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  stream(payload: Record<string, unknown>): Promise<Readable>;
}

export class RunnerExecutorError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface RunnerExecutionResult {
  events: Record<string, unknown>[];
  skippedLines: string[];
  stderr: string;
  returnCode: number;
  sawTerminal: boolean;
}

export type RunnerEvent = Record<string, unknown>;

function killRunnerProcess(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (child.killed) {
    return;
  }
  if (process.platform !== "win32" && typeof child.pid === "number" && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child signal below.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // ignore
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function encodeRequest(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

function runtimeAppRoot(): string {
  return (process.env.HOLABOSS_RUNTIME_APP_ROOT ?? "/app").trim() || "/app";
}

function runtimeRoot(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_ROOT ?? "").trim();
  return configured || "/runtime";
}

function runtimeBundleRoot(): string {
  return path.resolve(runtimeRoot(), "..");
}

function runtimeNode(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_NODE_BIN ?? "").trim();
  return configured || "node";
}

export function bundledRuntimeNodeBinDir(): string {
  return path.join(runtimeBundleRoot(), "node-runtime", "bin");
}

function pathDelimiter(): string {
  return process.platform === "win32" ? ";" : ":";
}

function prependPathEntries(currentPath: string | undefined, entries: string[]): string {
  const normalizedEntries = entries.map((entry) => entry.trim()).filter(Boolean);
  if (normalizedEntries.length === 0) {
    return currentPath ?? "";
  }

  const delimiter = pathDelimiter();
  const currentEntries = (currentPath ?? "").split(delimiter).map((entry) => entry.trim()).filter(Boolean);
  const deduped = [
    ...normalizedEntries,
    ...currentEntries.filter((entry) => !normalizedEntries.includes(entry))
  ];
  return deduped.join(delimiter);
}

function normalizeSessionKind(payload: Record<string, unknown>): string {
  const value = payload.session_kind;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function secondsFromEnv(
  envName: string,
  defaultValue: number,
  options: { min: number; max: number }
): number {
  const raw = (process.env[envName] ?? String(defaultValue)).trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.max(options.min, Math.min(parsed, options.max));
}

function runnerTimeoutSeconds(payload: Record<string, unknown>): number {
  const baseTimeoutSeconds = secondsFromEnv("SANDBOX_AGENT_RUN_TIMEOUT_S", DEFAULT_RUN_TIMEOUT_SECONDS, {
    min: 1,
    max: 7200
  });
  if (normalizeSessionKind(payload) !== "task_proposal") {
    return baseTimeoutSeconds;
  }
  return secondsFromEnv(
    "SANDBOX_AGENT_TASK_PROPOSAL_RUN_TIMEOUT_S",
    Math.max(baseTimeoutSeconds, DEFAULT_TASK_PROPOSAL_RUN_TIMEOUT_SECONDS),
    { min: 1, max: 7200 }
  );
}

function runnerIdleTimeoutSeconds(payload: Record<string, unknown>): number {
  const baseIdleTimeoutSeconds = secondsFromEnv("SANDBOX_AGENT_RUN_IDLE_TIMEOUT_S", DEFAULT_IDLE_TIMEOUT_SECONDS, {
    min: 1,
    max: 7200
  });
  if (normalizeSessionKind(payload) !== "task_proposal") {
    return baseIdleTimeoutSeconds;
  }
  return secondsFromEnv(
    "SANDBOX_AGENT_TASK_PROPOSAL_RUN_IDLE_TIMEOUT_S",
    runnerTimeoutSeconds(payload),
    { min: 1, max: 7200 }
  );
}

function normalizeRuntimeApiHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0.0.0.0" || trimmed === "::") {
    return "127.0.0.1";
  }
  return trimmed;
}

export function currentRuntimeApiUrl(): string | undefined {
  const configured = (process.env.SANDBOX_RUNTIME_API_URL ?? "").trim();
  if (configured) {
    return configured;
  }

  const portValue = (process.env.SANDBOX_RUNTIME_API_PORT ?? process.env.SANDBOX_AGENT_BIND_PORT ?? "").trim();
  if (!portValue) {
    return undefined;
  }
  const port = Number.parseInt(portValue, 10);
  if (!Number.isFinite(port) || port <= 0) {
    return undefined;
  }

  const host = normalizeRuntimeApiHost(
    process.env.SANDBOX_RUNTIME_API_HOST ?? process.env.SANDBOX_AGENT_BIND_HOST ?? "127.0.0.1"
  );
  return `http://${host}:${port}`;
}

export function buildRunnerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const currentApiUrl = currentRuntimeApiUrl();
  if (currentApiUrl && !(env.SANDBOX_RUNTIME_API_URL ?? "").trim()) {
    env.SANDBOX_RUNTIME_API_URL = currentApiUrl;
  }
  env.PATH = prependPathEntries(env.PATH, [
    bundledRuntimeNodeBinDir(),
    path.join(runtimeAppRoot(), "api-server", "node_modules", ".bin")
  ]);
  return env;
}

function runnerCommand(payload: Record<string, unknown>): string {
  const template = process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE ?? DEFAULT_TS_RUNNER_COMMAND_TEMPLATE;
  const replacements: Record<string, string> = {
    request_base64: shellQuote(encodeRequest(payload)),
    runtime_app_root: shellQuote(runtimeAppRoot()),
    runtime_root: shellQuote(runtimeRoot()),
    runtime_node: shellQuote(runtimeNode())
  };
  try {
    const rendered = template.replace(
      /\{(request_base64|runtime_app_root|runtime_root|runtime_node)\}/g,
      (match, key) => {
        const replacement = replacements[key];
        if (replacement === undefined) {
          throw new Error(`missing placeholder: ${key}`);
        }
        return replacement;
      }
    );
    if (/\{[^{}]+\}/.test(rendered)) {
      throw new Error("unresolved template placeholders");
    }
    return rendered;
  } catch (error) {
    throw new RunnerExecutorError(
      500,
      `invalid SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunnerEvent(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.session_id === "string" &&
    typeof value.input_id === "string" &&
    typeof value.sequence === "number" &&
    typeof value.event_type === "string" &&
    isRecord(value.payload)
  );
}

function eventSequence(event: Record<string, unknown>): number {
  return typeof event.sequence === "number" ? event.sequence : 0;
}

export function buildRunFailedEvent(params: {
  sessionId: string;
  inputId: string;
  sequence: number;
  message: string;
  errorType?: string;
}): RunnerEvent {
  return {
    session_id: params.sessionId,
    input_id: params.inputId,
    sequence: params.sequence,
    event_type: "run_failed",
    payload: {
      type: params.errorType ?? "RuntimeError",
      message: params.message
    }
  };
}

function sseEvent(event: RunnerEvent): string {
  const eventType = typeof event.event_type === "string" ? event.event_type : "message";
  const inputId = typeof event.input_id === "string" ? event.input_id : "unknown";
  const sequence = eventSequence(event);
  return [`event: ${eventType}`, `id: ${inputId}:${sequence}`, `data: ${JSON.stringify(event)}`].join("\n") + "\n\n";
}

function requiredString(payload: Record<string, unknown>, fieldName: string): string {
  const value = payload[fieldName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RunnerExecutorError(400, `${fieldName} is required`);
  }
  return value;
}

function validateRunnerPayload(payload: Record<string, unknown>): void {
  requiredString(payload, "workspace_id");
  requiredString(payload, "session_id");
  requiredString(payload, "input_id");
  requiredString(payload, "instruction");
  if (payload.context !== undefined && !isRecord(payload.context)) {
    throw new RunnerExecutorError(400, "context must be an object");
  }
}

export function synthesizeFailure(params: {
  payload: Record<string, unknown>;
  events: RunnerEvent[];
  skippedLines: string[];
  stderr: string;
  returnCode: number;
  sawTerminal: boolean;
  stream: boolean;
}): RunnerEvent[] {
  if (params.sawTerminal) {
    return params.events;
  }

  const sequence = Math.max(0, ...params.events.map(eventSequence)) + 1;
  const details = params.skippedLines.length > 0 ? params.skippedLines.slice(0, 3).join("; ") : "";
  const suffix = details ? ` (skipped output: ${details})` : "";
  const message =
    params.returnCode !== 0
      ? params.stderr || `runner command failed with exit_code=${params.returnCode}`
      : `runner ${params.stream ? "stream " : ""}ended before terminal event${suffix}`;
  const errorType = params.returnCode !== 0 ? "RunnerCommandError" : "RuntimeError";
  return params.events.concat(
    buildRunFailedEvent({
      sessionId: requiredString(params.payload, "session_id"),
      inputId: requiredString(params.payload, "input_id"),
      sequence,
      message,
      errorType
    })
  );
}

export async function executeRunnerRequest(
  payload: Record<string, unknown>,
  options: {
    onEvent?: (event: RunnerEvent) => void | Promise<void>;
    onHeartbeat?: () => void | Promise<void>;
  } = {}
): Promise<RunnerExecutionResult> {
  validateRunnerPayload(payload);
  const command = runnerCommand(payload);
  const env = buildRunnerEnv();
  const workspaceId = typeof payload.workspace_id === "string" ? payload.workspace_id.trim() : "";
  if (workspaceId) {
    env.HOLABOSS_WORKSPACE_ID = workspaceId;
  }
  const child = spawn("/bin/bash", ["-lc", command], {
    stdio: ["ignore", "pipe", "pipe"],
    env,
    detached: process.platform !== "win32"
  });
  const closePromise = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 0));
  });

  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdout || !stderr) {
    throw new Error("sandbox runner subprocess streams were not initialized");
  }

  const timeoutMs = runnerTimeoutSeconds(payload) * 1000;
  const idleTimeoutMs = runnerIdleTimeoutSeconds(payload) * 1000;
  let timedOut = false;
  let idleTimedOut = false;
  let sawTerminal = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    killRunnerProcess(child, "SIGKILL");
  }, timeoutMs);
  let idleTimeout: NodeJS.Timeout | null = null;
  const resetIdleTimeout = () => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }
    idleTimeout = setTimeout(() => {
      if (sawTerminal) {
        return;
      }
      idleTimedOut = true;
      killRunnerProcess(child, "SIGKILL");
    }, idleTimeoutMs);
  };
  resetIdleTimeout();
  const heartbeat = setInterval(() => {
    void options.onHeartbeat?.();
  }, HEARTBEAT_INTERVAL_MS);

  const stderrPromise = (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of stderr) {
      resetIdleTimeout();
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8").trim();
  })();

  const events: RunnerEvent[] = [];
  const skippedLines: string[] = [];
  let stdoutBuffer = "";

  try {
    for await (const chunk of stdout) {
      stdoutBuffer += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
      while (true) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!isRunnerEvent(parsed)) {
            if (skippedLines.length < 20) {
              skippedLines.push(line);
            }
            continue;
          }
          resetIdleTimeout();
          events.push(parsed);
          if (options.onEvent) {
            await options.onEvent(parsed);
          }
          if (TERMINAL_EVENT_TYPES.has(parsed.event_type as string)) {
            sawTerminal = true;
            killRunnerProcess(child, "SIGTERM");
          }
        } catch {
          if (skippedLines.length < 20) {
            skippedLines.push(line);
          }
        }
      }
    }
    if (stdoutBuffer.trim().length > 0 && skippedLines.length < 20) {
      skippedLines.push(stdoutBuffer.trim());
    }
  } finally {
    clearTimeout(timeout);
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }
    clearInterval(heartbeat);
  }

  const returnCode = await closePromise;
  const stderrText = timedOut
    ? "runner command timed out"
    : idleTimedOut
      ? `runner command became idle for ${Math.round(idleTimeoutMs / 1000)}s without a terminal event`
      : await stderrPromise;

  return {
    events,
    skippedLines,
    stderr: stderrText,
    returnCode: timedOut || idleTimedOut ? 124 : returnCode,
    sawTerminal
  };
}

export class NativeRunnerExecutor implements RunnerExecutorLike {
  async run(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const execution = await executeRunnerRequest(payload);
    const events = synthesizeFailure({
      payload,
      events: execution.events,
      skippedLines: execution.skippedLines,
      stderr: execution.stderr,
      returnCode: execution.returnCode,
      sawTerminal: execution.sawTerminal,
      stream: false
    });
    return {
      session_id: requiredString(payload, "session_id"),
      input_id: requiredString(payload, "input_id"),
      events
    };
  }

  async stream(payload: Record<string, unknown>): Promise<Readable> {
    validateRunnerPayload(payload);
    const command = runnerCommand(payload);
    const child = spawn("/bin/bash", ["-lc", command], {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildRunnerEnv(),
      detached: process.platform !== "win32"
    });
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      throw new Error("sandbox runner subprocess streams were not initialized");
    }

    const stream = new Readable({
      read() {}
    });
    const stderrChunks: Buffer[] = [];
    let stdoutBuffer = "";
    let skippedLines: string[] = [];
    let sawTerminal = false;
    let lastSequence = 0;
    let heartbeat: NodeJS.Timeout | null = null;

    const resetHeartbeat = () => {
      if (heartbeat) {
        clearTimeout(heartbeat);
      }
      heartbeat = setTimeout(() => {
        stream.push(": ping\n\n");
        resetHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    };

    resetHeartbeat();
    stream.push(": connected\n\n");

    stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    stdout.on("data", (chunk) => {
      stdoutBuffer += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
      while (true) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!isRunnerEvent(parsed)) {
            if (skippedLines.length < 20) {
              skippedLines.push(line);
            }
            continue;
          }
          lastSequence = Math.max(lastSequence, eventSequence(parsed));
          if (TERMINAL_EVENT_TYPES.has(parsed.event_type as string)) {
            sawTerminal = true;
          }
          stream.push(sseEvent(parsed));
          resetHeartbeat();
          if (sawTerminal) {
            if (heartbeat) {
              clearTimeout(heartbeat);
            }
            killRunnerProcess(child, "SIGTERM");
          }
        } catch {
          if (skippedLines.length < 20) {
            skippedLines.push(line);
          }
        }
      }
    });

    const finalize = (returnCode: number) => {
      if (heartbeat) {
        clearTimeout(heartbeat);
      }
      if (stdoutBuffer.trim().length > 0 && skippedLines.length < 20) {
        skippedLines.push(stdoutBuffer.trim());
      }
      if (!sawTerminal) {
        const stderrText = Buffer.concat(stderrChunks).toString("utf-8").trim();
        const details = skippedLines.length > 0 ? skippedLines.slice(0, 3).join("; ") : "";
        const suffix = details ? ` (skipped output: ${details})` : "";
        const message =
          returnCode !== 0
            ? stderrText || `runner command failed with exit_code=${returnCode}`
            : `runner stream ended before terminal event${suffix}`;
        const event = buildRunFailedEvent({
          sessionId: requiredString(payload, "session_id"),
          inputId: requiredString(payload, "input_id"),
          sequence: lastSequence + 1,
          message,
          errorType: returnCode !== 0 ? "RunnerCommandError" : "RuntimeError"
        });
        stream.push(sseEvent(event));
      }
      stream.push(null);
    };

    child.once("error", (error) => {
      if (heartbeat) {
        clearTimeout(heartbeat);
      }
      stream.destroy(error);
    });
    child.once("close", (code) => finalize(code ?? 0));

    stream.once("close", () => {
      if (heartbeat) {
        clearTimeout(heartbeat);
      }
      if (!child.killed) {
        killRunnerProcess(child, "SIGTERM");
      }
    });

    return stream;
  }
}
