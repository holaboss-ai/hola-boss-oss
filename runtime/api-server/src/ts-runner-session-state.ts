import fs from "node:fs";
import path from "node:path";

const WORKSPACE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SESSION_STATE_DIR_NAME = ".holaboss";
const SESSION_STATE_FILE_NAME = "harness-session-state.json";
const SESSION_STATE_VERSION = 1;
const SESSION_STATE_MAIN_SESSION_KEY = "main_session_id";

type LoggerLike = Pick<typeof console, "warn">;

function defaultLogger(): LoggerLike {
  return console;
}

function resolveSandboxRoot(): string {
  const raw = (process.env.HB_SANDBOX_ROOT ?? "").trim();
  if (!raw) {
    return "/holaboss";
  }
  const normalized = raw.replace(/\/+$/, "");
  return normalized || "/holaboss";
}

export function sanitizeWorkspaceId(workspaceId: string): string {
  const value = workspaceId.trim();
  if (!value) {
    throw new Error("workspace_id is required");
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new Error("workspace_id must not contain path separators");
  }
  if (!WORKSPACE_SEGMENT_PATTERN.test(value)) {
    throw new Error("workspace_id contains invalid characters");
  }
  return value;
}

export function workspaceDirForId(workspaceId: string): string {
  return path.join(resolveSandboxRoot(), "workspace", sanitizeWorkspaceId(workspaceId));
}

export function workspaceSessionStatePath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), SESSION_STATE_DIR_NAME, SESSION_STATE_FILE_NAME);
}

export function readWorkspaceSessionState(
  workspaceDir: string,
  options: { logger?: LoggerLike } = {}
): Record<string, unknown> | null {
  const logger = options.logger ?? defaultLogger();
  const statePath = workspaceSessionStatePath(workspaceDir);
  let raw: string;
  try {
    raw = fs.readFileSync(statePath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(`Ignoring invalid workspace session state path=${statePath}`);
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    logger.warn(`Ignoring non-object workspace session state path=${statePath}`);
    return null;
  }
  return parsed as Record<string, unknown>;
}

export function readWorkspaceMainSessionId(params: {
  workspaceDir: string;
  harness: string;
  logger?: LoggerLike;
}): string | null {
  const logger = params.logger ?? defaultLogger();
  const state = readWorkspaceSessionState(params.workspaceDir, { logger });
  if (!state) {
    return null;
  }

  const stateHarness = String(state.harness ?? "").trim().toLowerCase();
  const requestedHarness = params.harness.trim().toLowerCase();
  if (stateHarness && stateHarness !== requestedHarness) {
    logger.warn(
      `Workspace session state harness mismatch workspace=${params.workspaceDir} state_harness=${stateHarness} requested_harness=${requestedHarness}`
    );
    return null;
  }

  const value = state[SESSION_STATE_MAIN_SESSION_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function persistWorkspaceMainSessionId(params: {
  workspaceDir: string;
  harness: string;
  sessionId: string;
  logger?: LoggerLike;
}): void {
  const logger = params.logger ?? defaultLogger();
  const resolvedHarness = params.harness.trim().toLowerCase();
  const resolvedSessionId = params.sessionId.trim();
  if (!resolvedHarness || !resolvedSessionId) {
    return;
  }

  const existingState = readWorkspaceSessionState(params.workspaceDir, { logger });
  if (existingState) {
    const existingHarness = String(existingState.harness ?? "").trim().toLowerCase();
    if (existingHarness && existingHarness !== resolvedHarness) {
      logger.warn(
        `Refusing to overwrite workspace session state harness workspace=${params.workspaceDir} state_harness=${existingHarness} requested_harness=${resolvedHarness}`
      );
      return;
    }
  }

  const statePath = workspaceSessionStatePath(params.workspaceDir);
  const payload = {
    version: SESSION_STATE_VERSION,
    harness: resolvedHarness,
    [SESSION_STATE_MAIN_SESSION_KEY]: resolvedSessionId
  };
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tempPath = `${statePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload), "utf8");
    fs.renameSync(tempPath, statePath);
  } catch (error) {
    logger.warn(
      `Failed to persist workspace session state path=${statePath} error=${error instanceof Error ? error.message : String(error)}`
    );
  }
}
