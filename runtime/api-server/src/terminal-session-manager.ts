import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import type {
  RuntimeStateStore,
  TerminalSessionEventRecord,
  TerminalSessionOwner,
  TerminalSessionRecord,
  TerminalSessionStatus,
} from "@holaboss/runtime-state-store";
import { utcNowIso } from "@holaboss/runtime-state-store";
import * as pty from "node-pty";

import { buildRunnerEnv } from "./runner-worker.js";
import { shellCommandInvocation } from "./runtime-shell.js";

interface LoggerLike {
  info?(payload: unknown, message?: string): void;
  warn?(payload: unknown, message?: string): void;
  error?(payload: unknown, message?: string): void;
}

interface LiveTerminalSession {
  terminalId: string;
  ptyProcess: TerminalSessionPtyProcess;
  finalized: boolean;
  requestedClose: boolean;
  lastKnownStatus: TerminalSessionStatus;
}

type TerminalSessionPtyProcess = Pick<pty.IPty, "onData" | "onExit" | "write" | "resize" | "kill">;

export interface TerminalSessionManagerCreateParams {
  workspaceId: string;
  sessionId?: string | null;
  inputId?: string | null;
  title?: string | null;
  owner?: TerminalSessionOwner;
  cwd?: string | null;
  command: string;
  cols?: number;
  rows?: number;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TerminalSessionManagerLike {
  start(): Promise<void>;
  close(): Promise<void>;
  createSession(params: TerminalSessionManagerCreateParams): Promise<TerminalSessionRecord>;
  getSession(params: { terminalId: string; workspaceId?: string }): TerminalSessionRecord | null;
  listSessions(params?: { workspaceId?: string; sessionId?: string; statuses?: TerminalSessionStatus[] }): TerminalSessionRecord[];
  listEvents(params: { terminalId: string; afterSequence?: number; limit?: number }): TerminalSessionEventRecord[];
  sendInput(params: { terminalId: string; data: string }): Promise<TerminalSessionRecord>;
  resize(params: { terminalId: string; cols: number; rows: number }): Promise<TerminalSessionRecord>;
  signal(params: { terminalId: string; signal?: NodeJS.Signals | string | null }): Promise<TerminalSessionRecord>;
  closeSession(params: { terminalId: string }): Promise<TerminalSessionRecord>;
  subscribe(terminalId: string, listener: (event: TerminalSessionEventRecord) => void): () => void;
}

export interface TerminalSessionManagerOptions {
  store: RuntimeStateStore;
  logger?: LoggerLike;
  maxActiveSessions?: number;
  maxActiveSessionsPerWorkspace?: number;
  spawnImpl?: (
    file: string,
    args: string[],
    options: pty.IPtyForkOptions,
  ) => TerminalSessionPtyProcess;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;
const DEFAULT_MAX_ACTIVE_SESSIONS = 64;
const DEFAULT_MAX_ACTIVE_SESSIONS_PER_WORKSPACE = 8;

function normalizedPositiveInteger(value: number | undefined, defaultValue: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, Math.trunc(value ?? defaultValue)));
}

function eventChannel(terminalId: string): string {
  return `terminal:${terminalId}`;
}

function normalizedSignal(signal: NodeJS.Signals | string | null | undefined): NodeJS.Signals | string {
  const value = typeof signal === "string" && signal.trim() ? signal.trim() : "SIGTERM";
  return value;
}

function sanitizedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function resolveWorkspaceScopedCwd(workspaceDir: string, cwd: string | null | undefined): string {
  const raw = (cwd ?? ".").trim();
  const resolved = raw
    ? path.resolve(path.isAbsolute(raw) ? raw : path.join(workspaceDir, raw))
    : workspaceDir;
  const relative = path.relative(workspaceDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TerminalSessionManagerError(
      400,
      "terminal_session_invalid_cwd",
      `terminal cwd escapes workspace root: ${resolved}`
    );
  }
  if (!fs.existsSync(resolved)) {
    throw new TerminalSessionManagerError(404, "terminal_session_cwd_missing", `terminal cwd does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new TerminalSessionManagerError(
      400,
      "terminal_session_cwd_not_directory",
      `terminal cwd is not a directory: ${resolved}`
    );
  }
  return resolved;
}

function requireTerminalSession(
  store: RuntimeStateStore,
  params: { terminalId: string; workspaceId?: string }
): TerminalSessionRecord {
  const record = store.getTerminalSession(params);
  if (!record) {
    throw new TerminalSessionManagerError(404, "terminal_session_not_found", "terminal session not found");
  }
  return record;
}

export class TerminalSessionManagerError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "TerminalSessionManagerError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class TerminalSessionManager implements TerminalSessionManagerLike {
  private readonly liveSessions = new Map<string, LiveTerminalSession>();
  private readonly emitter = new EventEmitter();
  private started = false;

  constructor(private readonly options: TerminalSessionManagerOptions) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    const staleSessions = this.options.store.listTerminalSessions({
      statuses: ["starting", "running"],
    });
    for (const session of staleSessions) {
      const event = this.options.store.appendTerminalSessionEvent({
        terminalId: session.terminalId,
        eventType: "exit",
        payload: {
          reason: "runtime_restarted",
          message: "terminal session was interrupted when the runtime restarted",
          exit_code: session.exitCode,
        },
        status: "interrupted",
        exitCode: session.exitCode,
        endedAt: utcNowIso(),
      });
      this.emit(event);
    }
  }

  async close(): Promise<void> {
    for (const live of [...this.liveSessions.values()]) {
      if (live.finalized) {
        continue;
      }
      live.requestedClose = true;
      this.finalizeLiveSession(live, {
        eventType: "exit",
        status: "interrupted",
        payload: {
          reason: "runtime_shutdown",
          message: "terminal session was interrupted when the runtime shut down",
          exit_code: null,
        },
        exitCode: null,
      });
      try {
        live.ptyProcess.kill();
      } catch {
        // ignore
      }
    }
    this.liveSessions.clear();
    this.started = false;
  }

  getSession(params: { terminalId: string; workspaceId?: string }): TerminalSessionRecord | null {
    return this.options.store.getTerminalSession(params);
  }

  listSessions(params: { workspaceId?: string; sessionId?: string; statuses?: TerminalSessionStatus[] } = {}): TerminalSessionRecord[] {
    return this.options.store.listTerminalSessions(params);
  }

  listEvents(params: { terminalId: string; afterSequence?: number; limit?: number }): TerminalSessionEventRecord[] {
    requireTerminalSession(this.options.store, { terminalId: params.terminalId });
    return this.options.store.listTerminalSessionEvents(params);
  }

  subscribe(terminalId: string, listener: (event: TerminalSessionEventRecord) => void): () => void {
    this.emitter.on(eventChannel(terminalId), listener);
    return () => {
      this.emitter.off(eventChannel(terminalId), listener);
    };
  }

  async createSession(params: TerminalSessionManagerCreateParams): Promise<TerminalSessionRecord> {
    const workspaceDir = this.options.store.workspaceDir(params.workspaceId);
    if (!fs.existsSync(workspaceDir) || !fs.statSync(workspaceDir).isDirectory()) {
      throw new TerminalSessionManagerError(
        404,
        "terminal_session_workspace_missing",
        `workspace directory does not exist: ${workspaceDir}`
      );
    }
    this.enforceActiveSessionLimits(params.workspaceId);
    const cwd = resolveWorkspaceScopedCwd(workspaceDir, params.cwd);
    const cols = normalizedPositiveInteger(params.cols, DEFAULT_COLS, 20, 400);
    const rows = normalizedPositiveInteger(params.rows, DEFAULT_ROWS, 5, 200);
    const invocation = shellCommandInvocation(params.command);
    const env = sanitizedEnv(buildRunnerEnv());
    env.HOLABOSS_WORKSPACE_ID = params.workspaceId;
    env.TERM = env.TERM || "xterm-256color";

    const record = this.options.store.createTerminalSession({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId ?? null,
      inputId: params.inputId ?? null,
      title: params.title ?? "",
      backend: "node_pty",
      owner: params.owner ?? "agent",
      status: "starting",
      cwd,
      shell: invocation.command,
      command: params.command,
      createdBy: params.createdBy ?? null,
      metadata: params.metadata ?? {},
    });

    let ptyProcess: TerminalSessionPtyProcess;
    try {
      ptyProcess = (this.options.spawnImpl ?? pty.spawn)(invocation.command, invocation.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });
    } catch (error) {
      const event = this.options.store.appendTerminalSessionEvent({
        terminalId: record.terminalId,
        eventType: "error",
        payload: { message: error instanceof Error ? error.message : String(error) },
        status: "failed",
        exitCode: null,
        endedAt: utcNowIso(),
      });
      this.emit(event);
      throw new TerminalSessionManagerError(
        500,
        "terminal_session_spawn_failed",
        error instanceof Error ? error.message : "failed to spawn terminal session"
      );
    }

    const live: LiveTerminalSession = {
      terminalId: record.terminalId,
      ptyProcess,
      finalized: false,
      requestedClose: false,
      lastKnownStatus: "running",
    };
    this.liveSessions.set(record.terminalId, live);

    ptyProcess.onData((data) => {
      if (live.finalized) {
        return;
      }
      const event = this.options.store.appendTerminalSessionEvent({
        terminalId: record.terminalId,
        eventType: "output",
        payload: { data },
      });
      this.emit(event);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      const status: TerminalSessionStatus = live.requestedClose ? "closed" : exitCode === 0 ? "exited" : "failed";
      this.finalizeLiveSession(live, {
        eventType: "exit",
        status,
        payload: {
          exit_code: exitCode,
          signal,
          requested_close: live.requestedClose,
        },
        exitCode,
      });
    });

    const startedEvent = this.options.store.appendTerminalSessionEvent({
      terminalId: record.terminalId,
      eventType: "started",
      payload: {
        cols,
        rows,
        cwd,
        shell: invocation.command,
        command: params.command,
      },
      status: "running",
    });
    this.emit(startedEvent);

    return requireTerminalSession(this.options.store, { terminalId: record.terminalId });
  }

  async sendInput(params: { terminalId: string; data: string }): Promise<TerminalSessionRecord> {
    const live = this.requireLiveSession(params.terminalId);
    try {
      live.ptyProcess.write(params.data);
    } catch (error) {
      throw new TerminalSessionManagerError(
        500,
        "terminal_session_input_failed",
        error instanceof Error ? error.message : "failed to write to terminal session"
      );
    }
    const event = this.options.store.appendTerminalSessionEvent({
      terminalId: params.terminalId,
      eventType: "input",
      payload: { data: params.data },
    });
    this.emit(event);
    return requireTerminalSession(this.options.store, { terminalId: params.terminalId });
  }

  async resize(params: { terminalId: string; cols: number; rows: number }): Promise<TerminalSessionRecord> {
    const live = this.requireLiveSession(params.terminalId);
    const cols = normalizedPositiveInteger(params.cols, DEFAULT_COLS, 20, 400);
    const rows = normalizedPositiveInteger(params.rows, DEFAULT_ROWS, 5, 200);
    try {
      live.ptyProcess.resize(cols, rows);
    } catch (error) {
      throw new TerminalSessionManagerError(
        500,
        "terminal_session_resize_failed",
        error instanceof Error ? error.message : "failed to resize terminal session"
      );
    }
    const event = this.options.store.appendTerminalSessionEvent({
      terminalId: params.terminalId,
      eventType: "resize",
      payload: { cols, rows },
    });
    this.emit(event);
    return requireTerminalSession(this.options.store, { terminalId: params.terminalId });
  }

  async signal(params: { terminalId: string; signal?: NodeJS.Signals | string | null }): Promise<TerminalSessionRecord> {
    const live = this.requireLiveSession(params.terminalId);
    const signal = normalizedSignal(params.signal);
    try {
      live.ptyProcess.kill(signal);
    } catch (error) {
      throw new TerminalSessionManagerError(
        500,
        "terminal_session_signal_failed",
        error instanceof Error ? error.message : "failed to signal terminal session"
      );
    }
    const event = this.options.store.appendTerminalSessionEvent({
      terminalId: params.terminalId,
      eventType: "signal",
      payload: { signal },
    });
    this.emit(event);
    return requireTerminalSession(this.options.store, { terminalId: params.terminalId });
  }

  async closeSession(params: { terminalId: string }): Promise<TerminalSessionRecord> {
    const live = this.requireLiveSession(params.terminalId);
    live.requestedClose = true;
    try {
      live.ptyProcess.kill();
    } catch (error) {
      throw new TerminalSessionManagerError(
        500,
        "terminal_session_close_failed",
        error instanceof Error ? error.message : "failed to close terminal session"
      );
    }
    const event = this.options.store.appendTerminalSessionEvent({
      terminalId: params.terminalId,
      eventType: "signal",
      payload: { signal: "SIGTERM", requested_close: true },
    });
    this.emit(event);
    return requireTerminalSession(this.options.store, { terminalId: params.terminalId });
  }

  private requireLiveSession(terminalId: string): LiveTerminalSession {
    const session = this.liveSessions.get(terminalId);
    if (!session || session.finalized) {
      throw new TerminalSessionManagerError(
        409,
        "terminal_session_not_running",
        "terminal session is not running"
      );
    }
    return session;
  }

  private enforceActiveSessionLimits(workspaceId: string): void {
    const activeStatuses: TerminalSessionStatus[] = ["starting", "running"];
    const activeGlobal = this.options.store.listTerminalSessions({ statuses: activeStatuses });
    const activeWorkspace = this.options.store.listTerminalSessions({ workspaceId, statuses: activeStatuses });
    const globalLimit = this.options.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS;
    const workspaceLimit = this.options.maxActiveSessionsPerWorkspace ?? DEFAULT_MAX_ACTIVE_SESSIONS_PER_WORKSPACE;
    if (activeGlobal.length >= globalLimit) {
      throw new TerminalSessionManagerError(
        409,
        "terminal_session_limit_reached",
        `too many active terminal sessions (${globalLimit} max)`
      );
    }
    if (activeWorkspace.length >= workspaceLimit) {
      throw new TerminalSessionManagerError(
        409,
        "terminal_session_workspace_limit_reached",
        `too many active terminal sessions for workspace ${workspaceId} (${workspaceLimit} max)`
      );
    }
  }

  private finalizeLiveSession(
    live: LiveTerminalSession,
    params: {
      eventType: string;
      status: TerminalSessionStatus;
      payload: Record<string, unknown>;
      exitCode: number | null;
    }
  ): void {
    if (live.finalized) {
      return;
    }
    live.finalized = true;
    this.liveSessions.delete(live.terminalId);
    const event = this.options.store.appendTerminalSessionEvent({
      terminalId: live.terminalId,
      eventType: params.eventType,
      payload: params.payload,
      status: params.status,
      exitCode: params.exitCode,
      endedAt: utcNowIso(),
    });
    this.emit(event);
  }

  private emit(event: TerminalSessionEventRecord): void {
    this.emitter.emit(eventChannel(event.terminalId), event);
  }
}
