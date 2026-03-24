import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

const TERMINAL_EVENT_TYPES = new Set(["run_completed", "run_failed"]);
const DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE =
  "cd {runtime_app_root} && {runtime_python} -m sandbox_agent_runtime.runner --request-base64 {request_base64}";
const HEARTBEAT_INTERVAL_MS = 5000;

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function encodeRequest(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

function runtimeAppRoot(): string {
  return (process.env.HOLABOSS_RUNTIME_APP_ROOT ?? "/app").trim() || "/app";
}

function runtimePython(): string {
  return (process.env.HOLABOSS_RUNTIME_PYTHON ?? "/opt/venv/bin/python").trim() || "/opt/venv/bin/python";
}

function runnerTimeoutSeconds(): number {
  const raw = (process.env.SANDBOX_AGENT_RUN_TIMEOUT_S ?? "1800").trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 1800;
  }
  return Math.max(1, Math.min(parsed, 7200));
}

function runnerCommand(payload: Record<string, unknown>): string {
  const template = process.env.SANDBOX_AGENT_RUNNER_COMMAND_TEMPLATE ?? DEFAULT_AGENT_RUNNER_COMMAND_TEMPLATE;
  const replacements: Record<string, string> = {
    request_base64: shellQuote(encodeRequest(payload)),
    runtime_app_root: shellQuote(runtimeAppRoot()),
    runtime_python: shellQuote(runtimePython())
  };
  try {
    const rendered = template.replace(/\{(request_base64|runtime_app_root|runtime_python)\}/g, (match, key) => {
      const replacement = replacements[key];
      if (replacement === undefined) {
        throw new Error(`missing placeholder: ${key}`);
      }
      return replacement;
    });
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
  } = {}
): Promise<RunnerExecutionResult> {
  validateRunnerPayload(payload);
  const command = runnerCommand(payload);
  const child = spawn("/bin/bash", ["-lc", command], {
    stdio: ["ignore", "pipe", "pipe"]
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

  const timeoutMs = runnerTimeoutSeconds() * 1000;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  const stderrPromise = (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of stderr) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8").trim();
  })();

  const events: RunnerEvent[] = [];
  const skippedLines: string[] = [];
  let sawTerminal = false;
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
          events.push(parsed);
          if (options.onEvent) {
            await options.onEvent(parsed);
          }
          if (TERMINAL_EVENT_TYPES.has(parsed.event_type as string)) {
            sawTerminal = true;
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
  }

  const returnCode = await closePromise;
  const stderrText = timedOut ? "runner command timed out" : await stderrPromise;

  return {
    events,
    skippedLines,
    stderr: stderrText,
    returnCode: timedOut ? 124 : returnCode,
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
      stdio: ["ignore", "pipe", "pipe"]
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
            child.kill("SIGTERM");
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
        child.kill("SIGTERM");
      }
    });

    return stream;
  }
}
