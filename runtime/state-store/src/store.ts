import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const RUNTIME_DB_PATH_ENV = "HOLABOSS_RUNTIME_DB_PATH";
const WORKSPACE_RUNTIME_DIRNAME = ".holaboss";
const WORKSPACE_IDENTITY_FILENAME = "workspace_id";
const LEGACY_WORKSPACE_METADATA_FILENAME = "workspace.json";

export interface WorkspaceRecord {
  id: string;
  name: string;
  status: string;
  harness: string | null;
  mainSessionId: string | null;
  errorMessage: string | null;
  onboardingStatus: string;
  onboardingSessionId: string | null;
  onboardingCompletedAt: string | null;
  onboardingCompletionSummary: string | null;
  onboardingRequestedAt: string | null;
  onboardingRequestedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAtUtc: string | null;
}

export interface SessionBindingRecord {
  workspaceId: string;
  sessionId: string;
  harness: string;
  harnessSessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInputRecord {
  inputId: string;
  sessionId: string;
  workspaceId: string;
  payload: Record<string, unknown>;
  status: string;
  priority: number;
  availableAt: string;
  attempt: number;
  idempotencyKey: string | null;
  claimedBy: string | null;
  claimedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRuntimeStateRecord {
  workspaceId: string;
  sessionId: string;
  status: string;
  currentInputId: string | null;
  currentWorkerId: string | null;
  leaseUntil: string | null;
  heartbeatAt: string | null;
  lastError: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessageRecord {
  id: string;
  role: string;
  text: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface OutputEventRecord {
  id: number;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SessionArtifactRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  artifactType: string;
  externalId: string;
  platform: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface OutputFolderRecord {
  id: string;
  workspaceId: string;
  name: string;
  position: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OutputRecord {
  id: string;
  workspaceId: string;
  outputType: string;
  title: string;
  status: string;
  moduleId: string | null;
  moduleResourceId: string | null;
  filePath: string | null;
  htmlContent: string | null;
  sessionId: string | null;
  artifactId: string | null;
  folderId: string | null;
  platform: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AppBuildRecord {
  workspaceId: string;
  appId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppPortRecord {
  workspaceId: string;
  appId: string;
  port: number;
  createdAt: string;
  updatedAt: string;
}

export interface CronjobRecord {
  id: string;
  workspaceId: string;
  initiatedBy: string;
  name: string;
  cron: string;
  description: string;
  enabled: boolean;
  delivery: Record<string, unknown>;
  metadata: Record<string, unknown>;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskProposalRecord {
  proposalId: string;
  workspaceId: string;
  taskName: string;
  taskPrompt: string;
  taskGenerationRationale: string;
  sourceEventIds: string[];
  createdAt: string;
  state: string;
}

export interface CreateWorkspaceParams {
  workspaceId?: string;
  name: string;
  harness: string;
  status?: string;
  mainSessionId?: string | null;
  onboardingStatus?: string;
  onboardingSessionId?: string | null;
  errorMessage?: string | null;
}

export interface RuntimeStateStoreOptions {
  dbPath?: string;
  workspaceRoot?: string;
  sandboxRoot?: string;
  sandboxAgentHarness?: string;
}

type WorkspaceUpdateFields = Partial<{
  status: string | null;
  mainSessionId: string | null;
  errorMessage: string | null;
  deletedAtUtc: string | null;
  onboardingStatus: string | null;
  onboardingSessionId: string | null;
  onboardingCompletedAt: string | null;
  onboardingCompletionSummary: string | null;
  onboardingRequestedAt: string | null;
  onboardingRequestedBy: string | null;
}>;

type InputUpdateFields = Partial<{
  sessionId: string;
  workspaceId: string;
  payload: Record<string, unknown>;
  status: string;
  priority: number;
  availableAt: string;
  attempt: number;
  idempotencyKey: string | null;
  claimedBy: string | null;
  claimedUntil: string | null;
}>;

type WorkspaceRow = {
  id: string;
  workspace_path: string;
  name: string;
  status: string;
  harness: string | null;
  main_session_id: string | null;
  error_message: string | null;
  onboarding_status: string;
  onboarding_session_id: string | null;
  onboarding_completed_at: string | null;
  onboarding_completion_summary: string | null;
  onboarding_requested_at: string | null;
  onboarding_requested_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at_utc: string | null;
};

export function utcNowIso(): string {
  return new Date().toISOString();
}

export function sanitizeWorkspaceId(workspaceId: string): string {
  return workspaceId.replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function runtimeDbPath(options: RuntimeStateStoreOptions = {}): string {
  const explicit = (options.dbPath ?? process.env[RUNTIME_DB_PATH_ENV] ?? "").trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const sandboxRoot = options.sandboxRoot ?? path.join(os.tmpdir(), "sandbox");
  return path.join(sandboxRoot, "state", "runtime.db");
}

export class RuntimeStateStore {
  readonly dbPath: string;
  readonly workspaceRoot: string;
  readonly sandboxAgentHarness: string | null;
  #db: Database.Database | null = null;

  constructor(options: RuntimeStateStoreOptions = {}) {
    this.dbPath = runtimeDbPath(options);
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? path.join(os.tmpdir(), "workspace-root"));
    this.sandboxAgentHarness = (options.sandboxAgentHarness ?? process.env.SANDBOX_AGENT_HARNESS ?? "").trim() || null;
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
  }

  workspaceIdentityPath(workspaceId: string): string {
    return path.join(this.workspaceDir(workspaceId), WORKSPACE_RUNTIME_DIRNAME, WORKSPACE_IDENTITY_FILENAME);
  }

  workspaceDir(workspaceId: string): string {
    this.ensureWorkspaceMetadataReady();

    const registered = this.workspacePathFromRegistry(workspaceId);
    if (registered && fs.existsSync(registered) && fs.statSync(registered).isDirectory()) {
      return registered;
    }

    const discovered = this.discoverWorkspacePath(workspaceId);
    if (discovered) {
      this.updateWorkspacePath(workspaceId, discovered);
      return discovered;
    }

    return this.defaultWorkspaceDir(workspaceId);
  }

  listWorkspaces(options: { includeDeleted?: boolean } = {}): WorkspaceRecord[] {
    this.ensureWorkspaceMetadataReady();
    const rows = this.db()
      .prepare<[], WorkspaceRow>(`
        SELECT id, workspace_path, name, status, harness, main_session_id, error_message,
               onboarding_status, onboarding_session_id, onboarding_completed_at,
               onboarding_completion_summary, onboarding_requested_at, onboarding_requested_by,
               created_at, updated_at, deleted_at_utc
        FROM workspaces
        ORDER BY updated_at DESC, created_at DESC, id DESC
      `)
      .all();

    const items = rows.map((row) => this.rowToWorkspace(row));
    if (options.includeDeleted) {
      return items;
    }
    return items.filter((record) => !record.deletedAtUtc);
  }

  getWorkspace(workspaceId: string, options: { includeDeleted?: boolean } = {}): WorkspaceRecord | null {
    this.ensureWorkspaceMetadataReady();
    const row = this.db()
      .prepare<[string], WorkspaceRow>(`
        SELECT id, workspace_path, name, status, harness, main_session_id, error_message,
               onboarding_status, onboarding_session_id, onboarding_completed_at,
               onboarding_completion_summary, onboarding_requested_at, onboarding_requested_by,
               created_at, updated_at, deleted_at_utc
        FROM workspaces
        WHERE id = ?
        LIMIT 1
      `)
      .get(workspaceId);

    const record = row ? this.rowToWorkspace(row) : this.recoverMissingWorkspaceRecord(workspaceId);
    if (!record) {
      return null;
    }
    if (record.deletedAtUtc && !options.includeDeleted) {
      return null;
    }
    return record;
  }

  createWorkspace(params: CreateWorkspaceParams): WorkspaceRecord {
    this.ensureWorkspaceMetadataReady();

    const workspaceId = params.workspaceId ?? randomUUID();
    if (this.getWorkspace(workspaceId, { includeDeleted: true })) {
      throw new Error(`workspace ${workspaceId} already exists`);
    }

    const now = utcNowIso();
    const record: WorkspaceRecord = {
      id: workspaceId,
      name: params.name,
      status: params.status ?? "provisioning",
      harness: params.harness,
      mainSessionId: params.mainSessionId ?? null,
      errorMessage: params.errorMessage ?? null,
      onboardingStatus: params.onboardingStatus ?? "not_required",
      onboardingSessionId: params.onboardingSessionId ?? null,
      onboardingCompletedAt: null,
      onboardingCompletionSummary: null,
      onboardingRequestedAt: null,
      onboardingRequestedBy: null,
      createdAt: now,
      updatedAt: now,
      deletedAtUtc: null
    };

    const workspacePath = this.defaultWorkspaceDir(workspaceId);
    fs.mkdirSync(workspacePath, { recursive: true });
    this.writeWorkspaceIdentityFile(workspacePath, workspaceId);
    this.upsertWorkspaceRow(record, workspacePath);
    return record;
  }

  updateWorkspace(workspaceId: string, fields: WorkspaceUpdateFields): WorkspaceRecord {
    const existing = this.getWorkspace(workspaceId, { includeDeleted: true });
    if (!existing) {
      throw new Error(`workspace ${workspaceId} not found`);
    }
    const entries = Object.entries(fields);
    if (entries.length === 0) {
      return existing;
    }

    const nonNullable = new Set<keyof WorkspaceUpdateFields>(["status", "onboardingStatus"]);
    const next: WorkspaceRecord = { ...existing };
    for (const [key, value] of entries) {
      const typedKey = key as keyof WorkspaceUpdateFields;
      if (value === null && nonNullable.has(typedKey)) {
        continue;
      }
      switch (typedKey) {
        case "status":
          next.status = value as string;
          break;
        case "mainSessionId":
          next.mainSessionId = value as string | null;
          break;
        case "errorMessage":
          next.errorMessage = value as string | null;
          break;
        case "deletedAtUtc":
          next.deletedAtUtc = value as string | null;
          break;
        case "onboardingStatus":
          next.onboardingStatus = value as string;
          break;
        case "onboardingSessionId":
          next.onboardingSessionId = value as string | null;
          break;
        case "onboardingCompletedAt":
          next.onboardingCompletedAt = value as string | null;
          break;
        case "onboardingCompletionSummary":
          next.onboardingCompletionSummary = value as string | null;
          break;
        case "onboardingRequestedAt":
          next.onboardingRequestedAt = value as string | null;
          break;
        case "onboardingRequestedBy":
          next.onboardingRequestedBy = value as string | null;
          break;
        default:
          throw new Error(`unsupported workspace update field: ${typedKey}`);
      }
    }
    next.updatedAt = utcNowIso();
    this.upsertWorkspaceRow(next, this.workspaceDir(workspaceId));
    this.writeWorkspaceIdentityFile(this.workspaceDir(workspaceId), workspaceId);
    return next;
  }

  deleteWorkspace(workspaceId: string): WorkspaceRecord {
    return this.updateWorkspace(workspaceId, {
      status: "deleted",
      deletedAtUtc: utcNowIso(),
      errorMessage: null
    });
  }

  upsertBinding(params: {
    workspaceId: string;
    sessionId: string;
    harness: string;
    harnessSessionId: string;
  }): SessionBindingRecord {
    const now = utcNowIso();
    this.db()
      .prepare(`
        INSERT INTO agent_runtime_sessions (
            workspace_id, session_id, harness, harness_session_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, session_id) DO UPDATE SET
            harness = excluded.harness,
            harness_session_id = excluded.harness_session_id,
            updated_at = excluded.updated_at
      `)
      .run(
        params.workspaceId,
        params.sessionId,
        params.harness,
        params.harnessSessionId,
        now,
        now
      );

    const record = this.getBinding({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId
    });
    if (!record) {
      throw new Error("failed to load session binding");
    }
    return record;
  }

  getBinding(params: { workspaceId: string; sessionId: string }): SessionBindingRecord | null {
    const row = this.db()
      .prepare<[string, string], {
        workspace_id: string;
        session_id: string;
        harness: string;
        harness_session_id: string;
        created_at: string;
        updated_at: string;
      }>(`
        SELECT workspace_id, session_id, harness, harness_session_id, created_at, updated_at
        FROM agent_runtime_sessions
        WHERE workspace_id = ? AND session_id = ?
        LIMIT 1
      `)
      .get(params.workspaceId, params.sessionId);
    if (!row) {
      return null;
    }
    return {
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      harness: row.harness,
      harnessSessionId: row.harness_session_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  enqueueInput(params: {
    workspaceId: string;
    sessionId: string;
    payload: Record<string, unknown>;
    priority?: number;
    idempotencyKey?: string | null;
  }): SessionInputRecord {
    if (params.idempotencyKey) {
      const existing = this.getInputByIdempotencyKey(params.idempotencyKey);
      if (existing) {
        return existing;
      }
    }
    const inputId = randomUUID();
    const now = utcNowIso();
    this.db()
      .prepare(`
        INSERT INTO agent_session_inputs (
            input_id, session_id, workspace_id, payload, status, priority, available_at,
            attempt, idempotency_key, claimed_by, claimed_until, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?)
      `)
      .run(
        inputId,
        params.sessionId,
        params.workspaceId,
        JSON.stringify(params.payload),
        "QUEUED",
        params.priority ?? 0,
        now,
        params.idempotencyKey ?? null,
        now,
        now
      );
    const record = this.getInput(inputId);
    if (!record) {
      throw new Error("failed to load queued input");
    }
    return record;
  }

  getInput(inputId: string): SessionInputRecord | null {
    const row = this.db()
      .prepare<[string], Record<string, unknown>>("SELECT * FROM agent_session_inputs WHERE input_id = ? LIMIT 1")
      .get(inputId);
    return this.rowToInput(row);
  }

  getInputByIdempotencyKey(idempotencyKey: string): SessionInputRecord | null {
    const row = this.db()
      .prepare<[string], Record<string, unknown>>(
        "SELECT * FROM agent_session_inputs WHERE idempotency_key = ? LIMIT 1"
      )
      .get(idempotencyKey);
    return this.rowToInput(row);
  }

  updateInput(inputId: string, fields: InputUpdateFields): SessionInputRecord | null {
    const entries = Object.entries(fields);
    if (entries.length === 0) {
      return this.getInput(inputId);
    }

    const columnMap: Record<keyof InputUpdateFields, string> = {
      sessionId: "session_id",
      workspaceId: "workspace_id",
      payload: "payload",
      status: "status",
      priority: "priority",
      availableAt: "available_at",
      attempt: "attempt",
      idempotencyKey: "idempotency_key",
      claimedBy: "claimed_by",
      claimedUntil: "claimed_until"
    };

    const assignments: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [key, rawValue] of entries) {
      const column = columnMap[key as keyof InputUpdateFields];
      if (!column) {
        throw new Error(`unsupported session input update field: ${key}`);
      }
      assignments.push(`${column} = ?`);
      values.push(key === "payload" ? JSON.stringify(rawValue ?? {}) : (rawValue as string | number | null));
    }
    assignments.push("updated_at = ?");
    values.push(utcNowIso());
    values.push(inputId);

    this.db()
      .prepare(`UPDATE agent_session_inputs SET ${assignments.join(", ")} WHERE input_id = ?`)
      .run(...values);
    return this.getInput(inputId);
  }

  claimInputs(params: { limit: number; claimedBy: string; leaseSeconds: number }): SessionInputRecord[] {
    const now = new Date();
    const nowIso = now.toISOString();
    const claimedUntilIso =
      params.leaseSeconds > 0 ? new Date(now.getTime() + params.leaseSeconds * 1000).toISOString() : nowIso;

    const rows = this.db()
      .prepare<[string, string, number], { input_id: string }>(`
        SELECT input_id
        FROM agent_session_inputs
        WHERE status = 'QUEUED'
          AND datetime(available_at) <= datetime(?)
          AND (claimed_until IS NULL OR datetime(claimed_until) <= datetime(?))
        ORDER BY priority DESC, datetime(created_at) ASC
        LIMIT ?
      `)
      .all(nowIso, nowIso, Math.max(1, params.limit));

    const update = this.db().prepare(`
      UPDATE agent_session_inputs
      SET status = 'CLAIMED',
          claimed_by = ?,
          claimed_until = ?,
          updated_at = ?
      WHERE input_id = ?
    `);

    const records: SessionInputRecord[] = [];
    const transaction = this.db().transaction((inputIds: string[]) => {
      for (const inputId of inputIds) {
        update.run(params.claimedBy, claimedUntilIso, nowIso, inputId);
        const record = this.getInput(inputId);
        if (record) {
          records.push(record);
        }
      }
    });
    transaction(rows.map((row) => row.input_id));
    return records;
  }

  hasAvailableInputsForSession(params: { sessionId: string; workspaceId?: string }): boolean {
    const nowIso = utcNowIso();
    let query = `
      SELECT input_id FROM agent_session_inputs
      WHERE session_id = ?
        AND status = 'QUEUED'
        AND datetime(available_at) <= datetime(?)
    `;
    const values: Array<string> = [params.sessionId, nowIso];
    if (params.workspaceId) {
      query += " AND workspace_id = ?";
      values.push(params.workspaceId);
    }
    query += " LIMIT 1";

    const row = this.db().prepare(query).get(...values);
    return Boolean(row);
  }

  listExpiredClaimedInputs(nowIso = utcNowIso()): SessionInputRecord[] {
    const rows = this.db()
      .prepare<[string], Record<string, unknown>>(`
        SELECT *
        FROM agent_session_inputs
        WHERE status = 'CLAIMED'
          AND claimed_until IS NOT NULL
          AND datetime(claimed_until) <= datetime(?)
        ORDER BY datetime(claimed_until) ASC, datetime(updated_at) ASC
      `)
      .all(nowIso);
    return rows
      .map((row) => this.rowToInput(row))
      .filter((row): row is SessionInputRecord => row !== null);
  }

  ensureRuntimeState(params: {
    workspaceId: string;
    sessionId: string;
    status?: string;
    currentInputId?: string | null;
  }): SessionRuntimeStateRecord {
    const now = utcNowIso();
    this.db()
      .prepare(`
        INSERT INTO session_runtime_state (
            workspace_id, session_id, status, current_input_id, current_worker_id,
            lease_until, heartbeat_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(workspace_id, session_id) DO UPDATE SET
            status = excluded.status,
            current_input_id = excluded.current_input_id,
            updated_at = excluded.updated_at
      `)
      .run(params.workspaceId, params.sessionId, params.status ?? "QUEUED", params.currentInputId ?? null, now, now);
    const row = this.db()
      .prepare<[string, string], Record<string, unknown>>(
        "SELECT * FROM session_runtime_state WHERE workspace_id = ? AND session_id = ? LIMIT 1"
      )
      .get(params.workspaceId, params.sessionId);
    return this.rowToRuntimeState(row);
  }

  updateRuntimeState(params: {
    workspaceId: string;
    sessionId: string;
    status: string;
    currentInputId?: string | null;
    currentWorkerId?: string | null;
    leaseUntil?: string | null;
    heartbeatAt?: string | null;
    lastError?: Record<string, unknown> | string | null;
  }): SessionRuntimeStateRecord {
    const heartbeatAt = params.heartbeatAt ?? utcNowIso();
    const serializedLastError =
      params.lastError == null
        ? null
        : typeof params.lastError === "string"
        ? params.lastError
        : JSON.stringify(params.lastError);

    this.db()
      .prepare(`
        INSERT INTO session_runtime_state (
            workspace_id, session_id, status, current_input_id, current_worker_id,
            lease_until, heartbeat_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, session_id) DO UPDATE SET
            status = excluded.status,
            current_input_id = excluded.current_input_id,
            current_worker_id = excluded.current_worker_id,
            lease_until = excluded.lease_until,
            heartbeat_at = excluded.heartbeat_at,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
      `)
      .run(
        params.workspaceId,
        params.sessionId,
        params.status,
        params.currentInputId ?? null,
        params.currentWorkerId ?? null,
        params.leaseUntil ?? null,
        heartbeatAt,
        serializedLastError,
        heartbeatAt,
        heartbeatAt
      );
    const row = this.db()
      .prepare<[string, string], Record<string, unknown>>(
        "SELECT * FROM session_runtime_state WHERE workspace_id = ? AND session_id = ? LIMIT 1"
      )
      .get(params.workspaceId, params.sessionId);
    return this.rowToRuntimeState(row);
  }

  listRuntimeStates(workspaceId: string): SessionRuntimeStateRecord[] {
    const rows = this.db()
      .prepare<[string], Record<string, unknown>>(`
        SELECT * FROM session_runtime_state
        WHERE workspace_id = ?
        ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
      `)
      .all(workspaceId);
    return rows.map((row) => this.rowToRuntimeState(row));
  }

  getRuntimeState(params: { sessionId: string; workspaceId?: string }): SessionRuntimeStateRecord | null {
    let query = `
      SELECT * FROM session_runtime_state
      WHERE session_id = ?
    `;
    const values: string[] = [params.sessionId];
    if (params.workspaceId) {
      query += " AND workspace_id = ?";
      values.push(params.workspaceId);
    }
    query += " ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT 1";
    const row = this.db().prepare(query).get(...values) as Record<string, unknown> | undefined;
    return row ? this.rowToRuntimeState(row) : null;
  }

  insertSessionMessage(params: {
    workspaceId: string;
    sessionId: string;
    role: string;
    text: string;
    messageId?: string;
    createdAt?: string;
  }): void {
    this.db()
      .prepare(`
        INSERT OR REPLACE INTO session_messages (
            id, workspace_id, session_id, role, text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        params.messageId ?? randomUUID(),
        params.workspaceId,
        params.sessionId,
        params.role,
        params.text,
        params.createdAt ?? utcNowIso()
      );
  }

  listSessionMessages(params: { workspaceId: string; sessionId: string }): SessionMessageRecord[] {
    const rows = this.db()
      .prepare<[string, string], { id: string; role: string; text: string; created_at: string }>(`
        SELECT id, role, text, created_at
        FROM session_messages
        WHERE workspace_id = ? AND session_id = ?
        ORDER BY datetime(created_at) ASC, id ASC
      `)
      .all(params.workspaceId, params.sessionId);
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      createdAt: row.created_at,
      metadata: {}
    }));
  }

  appendOutputEvent(params: {
    workspaceId: string;
    sessionId: string;
    inputId: string;
    sequence: number;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): void {
    this.db()
      .prepare(`
        INSERT INTO session_output_events (
            workspace_id, session_id, input_id, sequence, event_type, payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        params.workspaceId,
        params.sessionId,
        params.inputId,
        params.sequence,
        params.eventType,
        JSON.stringify(params.payload),
        params.createdAt ?? utcNowIso()
      );
  }

  latestOutputEventId(params: { sessionId: string; inputId?: string }): number {
    let query = `
      SELECT MAX(id) AS max_id
      FROM session_output_events
      WHERE session_id = ?
    `;
    const values: string[] = [params.sessionId];
    if (params.inputId) {
      query += " AND input_id = ?";
      values.push(params.inputId);
    }
    const row = this.db().prepare(query).get(...values) as { max_id: number | null } | undefined;
    return row?.max_id ?? 0;
  }

  listOutputEvents(params: {
    sessionId: string;
    inputId?: string;
    includeHistory?: boolean;
    afterEventId?: number;
  }): OutputEventRecord[] {
    let query = `
      SELECT id, workspace_id, session_id, input_id, sequence, event_type, payload, created_at
      FROM session_output_events
      WHERE session_id = ?
        AND id > ?
    `;
    const values: Array<string | number> = [params.sessionId, params.afterEventId ?? 0];
    if (params.inputId) {
      query += " AND input_id = ?";
      values.push(params.inputId);
    }
    if (params.includeHistory === false) {
      query += " AND 1 = 0";
    }
    query += " ORDER BY id ASC";

    const rows = this.db().prepare(query).all(...values) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      workspaceId: String(row.workspace_id),
      sessionId: String(row.session_id),
      inputId: String(row.input_id),
      sequence: Number(row.sequence),
      eventType: String(row.event_type),
      payload: this.parseJsonDict(row.payload),
      createdAt: String(row.created_at)
    }));
  }

  createSessionArtifact(params: {
    sessionId: string;
    workspaceId: string;
    artifactType: string;
    externalId: string;
    platform?: string | null;
    title?: string | null;
    metadata?: Record<string, unknown> | null;
    artifactId?: string;
    createdAt?: string;
  }): SessionArtifactRecord {
    const resolvedId = params.artifactId ?? randomUUID();
    const resolvedCreatedAt = params.createdAt ?? utcNowIso();
    this.db()
      .prepare(`
        INSERT OR REPLACE INTO session_artifacts (
            id, session_id, workspace_id, artifact_type, external_id, platform, title, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        resolvedId,
        params.sessionId,
        params.workspaceId,
        params.artifactType,
        params.externalId,
        params.platform ?? null,
        params.title ?? null,
        JSON.stringify(params.metadata ?? {}),
        resolvedCreatedAt
      );
    const row = this.db()
      .prepare<[string], Record<string, unknown>>("SELECT * FROM session_artifacts WHERE id = ? LIMIT 1")
      .get(resolvedId);
    if (!row) {
      throw new Error("artifact row not found after insert");
    }
    return this.rowToSessionArtifact(row);
  }

  listSessionArtifacts(params: { sessionId: string; workspaceId?: string }): SessionArtifactRecord[] {
    let query = `
      SELECT * FROM session_artifacts
      WHERE session_id = ?
    `;
    const values: string[] = [params.sessionId];
    if (params.workspaceId) {
      query += " AND workspace_id = ?";
      values.push(params.workspaceId);
    }
    query += " ORDER BY datetime(created_at) ASC, id ASC";
    const rows = this.db().prepare(query).all(...values) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToSessionArtifact(row));
  }

  listSessionsWithArtifacts(params: { workspaceId: string; limit?: number; offset?: number }): Array<Record<string, unknown>> {
    const rows = this.db()
      .prepare<[string, number, number], Record<string, unknown>>(`
        SELECT session_id, status, created_at, updated_at
        FROM session_runtime_state
        WHERE workspace_id = ?
        ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
        LIMIT ? OFFSET ?
      `)
      .all(params.workspaceId, params.limit ?? 20, params.offset ?? 0);
    const sessionIds = rows.map((row) => String(row.session_id));
    const artifactsBySession = new Map<string, Array<Record<string, unknown>>>();
    for (const sessionId of sessionIds) {
      artifactsBySession.set(sessionId, []);
    }
    if (sessionIds.length > 0) {
      const artifactRows = this.db()
        .prepare<[string], Record<string, unknown>>(`
          SELECT session_id, artifact_type, external_id, platform, title
          FROM session_artifacts
          WHERE workspace_id = ?
          ORDER BY datetime(created_at) ASC, id ASC
        `)
        .all(params.workspaceId);
      for (const row of artifactRows) {
        const sessionId = String(row.session_id);
        if (!artifactsBySession.has(sessionId)) {
          continue;
        }
        artifactsBySession.get(sessionId)?.push({
          artifact_type: String(row.artifact_type),
          external_id: String(row.external_id),
          platform: row.platform == null ? null : String(row.platform),
          title: row.title == null ? null : String(row.title)
        });
      }
    }
    return rows.map((row) => ({
      session_id: String(row.session_id),
      status: String(row.status),
      created_at: row.created_at == null ? null : String(row.created_at),
      updated_at: row.updated_at == null ? null : String(row.updated_at),
      artifacts: artifactsBySession.get(String(row.session_id)) ?? []
    }));
  }

  createOutputFolder(params: { workspaceId: string; name: string }): OutputFolderRecord {
    const resolvedId = randomUUID();
    const now = utcNowIso();
    const countRow = this.db()
      .prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM output_folders WHERE workspace_id = ?")
      .get(params.workspaceId);
    const position = countRow?.count ?? 0;
    this.db()
      .prepare(`
        INSERT INTO output_folders (
            id, workspace_id, name, position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(resolvedId, params.workspaceId, params.name, position, now, now);
    const row = this.db()
      .prepare<[string], Record<string, unknown>>("SELECT * FROM output_folders WHERE id = ? LIMIT 1")
      .get(resolvedId);
    if (!row) {
      throw new Error("output folder row not found after insert");
    }
    return this.rowToOutputFolder(row);
  }

  listOutputFolders(params: { workspaceId: string }): OutputFolderRecord[] {
    const rows = this.db()
      .prepare<[string], Record<string, unknown>>(`
        SELECT * FROM output_folders
        WHERE workspace_id = ?
        ORDER BY position ASC, datetime(created_at) ASC, id ASC
      `)
      .all(params.workspaceId);
    return rows.map((row) => this.rowToOutputFolder(row));
  }

  updateOutputFolder(params: { folderId: string; name?: string | null; position?: number | null }): OutputFolderRecord | null {
    const existing = this.getOutputFolder(params.folderId);
    if (!existing) {
      return null;
    }
    const updatedAt = utcNowIso();
    this.db()
      .prepare(`
        UPDATE output_folders
        SET name = ?, position = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(params.name ?? existing.name, params.position ?? existing.position, updatedAt, params.folderId);
    return this.getOutputFolder(params.folderId);
  }

  getOutputFolder(folderId: string): OutputFolderRecord | null {
    const row = this.db()
      .prepare<[string], Record<string, unknown>>("SELECT * FROM output_folders WHERE id = ? LIMIT 1")
      .get(folderId);
    return row ? this.rowToOutputFolder(row) : null;
  }

  deleteOutputFolder(folderId: string): boolean {
    this.db().prepare("UPDATE outputs SET folder_id = NULL, updated_at = ? WHERE folder_id = ?").run(utcNowIso(), folderId);
    const result = this.db().prepare("DELETE FROM output_folders WHERE id = ?").run(folderId);
    return result.changes > 0;
  }

  createOutput(params: {
    workspaceId: string;
    outputType: string;
    title?: string;
    moduleId?: string | null;
    moduleResourceId?: string | null;
    filePath?: string | null;
    htmlContent?: string | null;
    sessionId?: string | null;
    artifactId?: string | null;
    folderId?: string | null;
    platform?: string | null;
    metadata?: Record<string, unknown> | null;
    outputId?: string;
  }): OutputRecord {
    const resolvedId = params.outputId ?? randomUUID();
    const now = utcNowIso();
    this.db()
      .prepare(`
        INSERT INTO outputs (
            id, workspace_id, output_type, title, status, module_id, module_resource_id, file_path,
            html_content, session_id, artifact_id, folder_id, platform, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        resolvedId,
        params.workspaceId,
        params.outputType,
        params.title ?? "",
        params.moduleId ?? null,
        params.moduleResourceId ?? null,
        params.filePath ?? null,
        params.htmlContent ?? null,
        params.sessionId ?? null,
        params.artifactId ?? null,
        params.folderId ?? null,
        params.platform ?? null,
        JSON.stringify(params.metadata ?? {}),
        now,
        now
      );
    const row = this.db().prepare<[string], Record<string, unknown>>("SELECT * FROM outputs WHERE id = ? LIMIT 1").get(resolvedId);
    if (!row) {
      throw new Error("output row not found after insert");
    }
    return this.rowToOutput(row);
  }

  listOutputs(params: {
    workspaceId: string;
    outputType?: string | null;
    status?: string | null;
    platform?: string | null;
    folderId?: string | null;
    limit?: number;
    offset?: number;
  }): OutputRecord[] {
    let query = "SELECT * FROM outputs WHERE workspace_id = ?";
    const values: Array<string | number> = [params.workspaceId];
    if (params.outputType) {
      query += " AND output_type = ?";
      values.push(params.outputType);
    }
    if (params.status) {
      query += " AND status = ?";
      values.push(params.status);
    }
    if (params.platform) {
      query += " AND platform = ?";
      values.push(params.platform);
    }
    if (params.folderId) {
      query += " AND folder_id = ?";
      values.push(params.folderId);
    }
    query += " ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?";
    values.push(params.limit ?? 50, params.offset ?? 0);
    const rows = this.db().prepare(query).all(...values) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToOutput(row));
  }

  getOutput(outputId: string): OutputRecord | null {
    const row = this.db().prepare<[string], Record<string, unknown>>("SELECT * FROM outputs WHERE id = ? LIMIT 1").get(outputId);
    return row ? this.rowToOutput(row) : null;
  }

  updateOutput(params: {
    outputId: string;
    title?: string | null;
    status?: string | null;
    moduleResourceId?: string | null;
    filePath?: string | null;
    htmlContent?: string | null;
    metadata?: Record<string, unknown> | null;
    folderId?: string | null;
  }): OutputRecord | null {
    const existing = this.getOutput(params.outputId);
    if (!existing) {
      return null;
    }
    this.db()
      .prepare(`
        UPDATE outputs
        SET title = ?,
            status = ?,
            module_resource_id = ?,
            file_path = ?,
            html_content = ?,
            metadata = ?,
            folder_id = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        params.title ?? existing.title,
        params.status ?? existing.status,
        params.moduleResourceId ?? existing.moduleResourceId,
        params.filePath ?? existing.filePath,
        params.htmlContent ?? existing.htmlContent,
        JSON.stringify(params.metadata ?? existing.metadata),
        params.folderId ?? existing.folderId,
        utcNowIso(),
        params.outputId
      );
    return this.getOutput(params.outputId);
  }

  deleteOutput(outputId: string): boolean {
    const result = this.db().prepare("DELETE FROM outputs WHERE id = ?").run(outputId);
    return result.changes > 0;
  }

  getOutputCounts(params: { workspaceId: string }): Record<string, unknown> {
    const rows = this.db()
      .prepare<[string], Record<string, unknown>>("SELECT status, platform, folder_id FROM outputs WHERE workspace_id = ?")
      .all(params.workspaceId);
    const byStatus: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    const byFolder: Record<string, number> = {};
    for (const row of rows) {
      const status = row.status == null ? "" : String(row.status);
      const platform = row.platform == null ? "" : String(row.platform);
      const folder = row.folder_id == null ? "" : String(row.folder_id);
      if (status) byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (platform) byPlatform[platform] = (byPlatform[platform] ?? 0) + 1;
      if (folder) byFolder[folder] = (byFolder[folder] ?? 0) + 1;
    }
    return {
      total: rows.length,
      by_status: byStatus,
      by_platform: byPlatform,
      by_folder: byFolder
    };
  }

  upsertAppBuild(params: {
    workspaceId: string;
    appId: string;
    status: string;
    error?: string | null;
  }): AppBuildRecord {
    const now = utcNowIso();
    const existing = this.getAppBuild({
      workspaceId: params.workspaceId,
      appId: params.appId
    });
    if (existing) {
      const fields: Record<string, string | null> = {
        status: params.status,
        updated_at: now
      };
      if (params.status === "building") {
        fields.started_at = now;
        fields.error = null;
      } else if (params.status === "completed") {
        fields.completed_at = now;
        fields.error = null;
      } else if (params.status === "failed") {
        fields.completed_at = now;
        fields.error = params.error ?? null;
      }
      const setClause = Object.keys(fields)
        .map((column) => `${column} = ?`)
        .join(", ");
      this.db()
        .prepare(`UPDATE app_builds SET ${setClause} WHERE workspace_id = ? AND app_id = ?`)
        .run(...Object.values(fields), params.workspaceId, params.appId);
    } else {
      this.db()
        .prepare(`
          INSERT INTO app_builds (
              workspace_id, app_id, status, started_at, completed_at, error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          params.workspaceId,
          params.appId,
          params.status,
          params.status === "building" ? now : null,
          null,
          params.error ?? null,
          now,
          now
        );
    }
    const row = this.db()
      .prepare<[string, string], Record<string, unknown>>(
        "SELECT * FROM app_builds WHERE workspace_id = ? AND app_id = ? LIMIT 1"
      )
      .get(params.workspaceId, params.appId);
    if (!row) {
      throw new Error("app build row not found after upsert");
    }
    return this.rowToAppBuild(row);
  }

  getAppBuild(params: { workspaceId: string; appId: string }): AppBuildRecord | null {
    const row = this.db()
      .prepare<[string, string], Record<string, unknown>>(
        "SELECT * FROM app_builds WHERE workspace_id = ? AND app_id = ? LIMIT 1"
      )
      .get(params.workspaceId, params.appId);
    return row ? this.rowToAppBuild(row) : null;
  }

  deleteAppBuild(params: { workspaceId: string; appId: string }): boolean {
    const result = this.db()
      .prepare("DELETE FROM app_builds WHERE workspace_id = ? AND app_id = ?")
      .run(params.workspaceId, params.appId);
    return result.changes > 0;
  }

  // --- App Ports ---

  allocateAppPort(params: { workspaceId: string; appId: string }): AppPortRecord {
    const allocate = this.db().transaction(() => {
      const existing = this.getAppPort({ workspaceId: params.workspaceId, appId: params.appId });
      if (existing) {
        return existing;
      }

      const port = this.findAvailablePort();
      const now = utcNowIso();

      this.db().prepare(`
        INSERT OR IGNORE INTO app_ports (workspace_id, app_id, port, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(params.workspaceId, params.appId, port, now, now);

      return this.getAppPort({ workspaceId: params.workspaceId, appId: params.appId })!;
    });
    return allocate();
  }

  getAppPort(params: { workspaceId: string; appId: string }): AppPortRecord | null {
    const row = this.db()
      .prepare<[string, string], Record<string, unknown>>(
        "SELECT * FROM app_ports WHERE workspace_id = ? AND app_id = ? LIMIT 1"
      )
      .get(params.workspaceId, params.appId);
    return row ? this.rowToAppPort(row) : null;
  }

  listAppPorts(params: { workspaceId: string }): AppPortRecord[] {
    const rows = this.db()
      .prepare<[string], Record<string, unknown>>(
        "SELECT * FROM app_ports WHERE workspace_id = ?"
      )
      .all(params.workspaceId);
    return rows.map((row) => this.rowToAppPort(row));
  }

  listAllAppPorts(): AppPortRecord[] {
    const rows = this.db()
      .prepare<[], Record<string, unknown>>(
        "SELECT * FROM app_ports"
      )
      .all();
    return rows.map((row) => this.rowToAppPort(row));
  }

  deleteAppPort(params: { workspaceId: string; appId: string }): boolean {
    const result = this.db()
      .prepare("DELETE FROM app_ports WHERE workspace_id = ? AND app_id = ?")
      .run(params.workspaceId, params.appId);
    return result.changes > 0;
  }

  private findAvailablePort(): number {
    const BASE_PORT = 38080;
    const MAX_PORT = 38979;

    const allocated = new Set(
      this.db()
        .prepare<[], { port: number }>("SELECT port FROM app_ports")
        .all()
        .map((r) => r.port)
    );

    for (let port = BASE_PORT; port <= MAX_PORT; port++) {
      if (!allocated.has(port)) {
        return port;
      }
    }
    throw new Error(`No available ports in range ${BASE_PORT}-${MAX_PORT}`);
  }

  private rowToAppPort(row: Record<string, unknown>): AppPortRecord {
    return {
      workspaceId: String(row.workspace_id ?? ""),
      appId: String(row.app_id ?? ""),
      port: Number(row.port ?? 0),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    };
  }

  createCronjob(params: {
    workspaceId: string;
    initiatedBy: string;
    cron: string;
    description: string;
    delivery: Record<string, unknown>;
    enabled?: boolean;
    metadata?: Record<string, unknown> | null;
    name?: string;
    jobId?: string;
    nextRunAt?: string | null;
  }): CronjobRecord {
    const resolvedId = params.jobId ?? randomUUID();
    const now = utcNowIso();
    this.db()
      .prepare(`
        INSERT INTO cronjobs (
            id, workspace_id, initiated_by, name, cron, description, enabled, delivery, metadata,
            last_run_at, next_run_at, run_count, last_status, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, NULL, NULL, ?, ?)
      `)
      .run(
        resolvedId,
        params.workspaceId,
        params.initiatedBy,
        params.name ?? "",
        params.cron,
        params.description,
        params.enabled === false ? 0 : 1,
        JSON.stringify(params.delivery),
        JSON.stringify(params.metadata ?? {}),
        params.nextRunAt ?? null,
        now,
        now
      );
    const row = this.db().prepare<[string], Record<string, unknown>>("SELECT * FROM cronjobs WHERE id = ? LIMIT 1").get(resolvedId);
    if (!row) {
      throw new Error("cronjob row not found after insert");
    }
    return this.rowToCronjob(row);
  }

  getCronjob(jobId: string): CronjobRecord | null {
    const row = this.db().prepare<[string], Record<string, unknown>>("SELECT * FROM cronjobs WHERE id = ? LIMIT 1").get(jobId);
    return row ? this.rowToCronjob(row) : null;
  }

  listCronjobs(params: { workspaceId?: string | null; enabledOnly?: boolean }): CronjobRecord[] {
    let query = "SELECT * FROM cronjobs";
    const filters: string[] = [];
    const values: string[] = [];
    if (params.workspaceId) {
      filters.push("workspace_id = ?");
      values.push(params.workspaceId);
    }
    if (params.enabledOnly) {
      filters.push("enabled = 1");
    }
    if (filters.length > 0) {
      query += ` WHERE ${filters.join(" AND ")}`;
    }
    query += " ORDER BY datetime(created_at) ASC, id ASC";
    const rows = this.db().prepare(query).all(...values) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToCronjob(row));
  }

  updateCronjob(params: {
    jobId: string;
    name?: string | null;
    cron?: string | null;
    description?: string | null;
    enabled?: boolean | null;
    delivery?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    lastRunAt?: string | null;
    nextRunAt?: string | null;
    runCount?: number | null;
    lastStatus?: string | null;
    lastError?: string | null;
  }): CronjobRecord | null {
    const existing = this.getCronjob(params.jobId);
    if (!existing) {
      return null;
    }
    this.db()
      .prepare(`
        UPDATE cronjobs
        SET name = ?,
            cron = ?,
            description = ?,
            enabled = ?,
            delivery = ?,
            metadata = ?,
            last_run_at = ?,
            next_run_at = ?,
            run_count = ?,
            last_status = ?,
            last_error = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        params.name ?? existing.name,
        params.cron ?? existing.cron,
        params.description ?? existing.description,
        params.enabled == null ? (existing.enabled ? 1 : 0) : params.enabled ? 1 : 0,
        JSON.stringify(params.delivery ?? existing.delivery),
        JSON.stringify(params.metadata ?? existing.metadata),
        params.lastRunAt === undefined ? existing.lastRunAt : params.lastRunAt,
        params.nextRunAt === undefined ? existing.nextRunAt : params.nextRunAt,
        params.runCount ?? existing.runCount,
        params.lastStatus === undefined ? existing.lastStatus : params.lastStatus,
        params.lastError === undefined ? existing.lastError : params.lastError,
        utcNowIso(),
        params.jobId
      );
    return this.getCronjob(params.jobId);
  }

  deleteCronjob(jobId: string): boolean {
    const result = this.db().prepare("DELETE FROM cronjobs WHERE id = ?").run(jobId);
    return result.changes > 0;
  }

  createTaskProposal(params: {
    proposalId: string;
    workspaceId: string;
    taskName: string;
    taskPrompt: string;
    taskGenerationRationale: string;
    sourceEventIds?: string[];
    createdAt: string;
    state?: string;
  }): TaskProposalRecord {
    this.db()
      .prepare(`
        INSERT INTO task_proposals (
            proposal_id,
            workspace_id,
            task_name,
            task_prompt,
            task_generation_rationale,
            source_event_ids,
            created_at,
            state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        params.proposalId,
        params.workspaceId,
        params.taskName,
        params.taskPrompt,
        params.taskGenerationRationale,
        JSON.stringify(params.sourceEventIds ?? []),
        params.createdAt,
        params.state ?? "not_reviewed"
      );
    const row = this.db()
      .prepare<[string], Record<string, unknown>>("SELECT * FROM task_proposals WHERE proposal_id = ? LIMIT 1")
      .get(params.proposalId);
    if (!row) {
      throw new Error("task proposal row not found after insert");
    }
    return this.rowToTaskProposal(row);
  }

  getTaskProposal(proposalId: string): TaskProposalRecord | null {
    const row = this.db()
      .prepare<[string], Record<string, unknown>>("SELECT * FROM task_proposals WHERE proposal_id = ? LIMIT 1")
      .get(proposalId);
    return row ? this.rowToTaskProposal(row) : null;
  }

  listTaskProposals(params: { workspaceId: string }): TaskProposalRecord[] {
    const rows = this.db()
      .prepare<[string], Record<string, unknown>>(`
        SELECT * FROM task_proposals
        WHERE workspace_id = ?
        ORDER BY datetime(created_at) DESC, proposal_id DESC
      `)
      .all(params.workspaceId);
    return rows.map((row) => this.rowToTaskProposal(row));
  }

  listUnreviewedTaskProposals(params: { workspaceId: string }): TaskProposalRecord[] {
    const rows = this.db()
      .prepare<[string], Record<string, unknown>>(`
        SELECT * FROM task_proposals
        WHERE workspace_id = ? AND state = 'not_reviewed'
        ORDER BY datetime(created_at) DESC, proposal_id DESC
      `)
      .all(params.workspaceId);
    return rows.map((row) => this.rowToTaskProposal(row));
  }

  updateTaskProposalState(params: { proposalId: string; state: string }): TaskProposalRecord | null {
    const result = this.db().prepare("UPDATE task_proposals SET state = ? WHERE proposal_id = ?").run(params.state, params.proposalId);
    if (result.changes <= 0) {
      return null;
    }
    return this.getTaskProposal(params.proposalId);
  }

  private db(): Database.Database {
    if (this.#db) {
      return this.#db;
    }

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const db = new Database(this.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    this.ensureRuntimeDbSchema(db);
    this.#db = db;
    return db;
  }

  private ensureWorkspaceMetadataReady(): void {
    void this.db();
  }

  private ensureRuntimeDbSchema(db: Database.Database): void {
    this.ensureWorkspacesTableSchema(db);
    this.migrateSandboxRunTokensTable(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          workspace_path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          harness TEXT,
          main_session_id TEXT,
          error_message TEXT,
          onboarding_status TEXT NOT NULL,
          onboarding_session_id TEXT,
          onboarding_completed_at TEXT,
          onboarding_completion_summary TEXT,
          onboarding_requested_at TEXT,
          onboarding_requested_by TEXT,
          created_at TEXT,
          updated_at TEXT,
          deleted_at_utc TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_updated
          ON workspaces (updated_at DESC, created_at DESC);

      CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          harness TEXT NOT NULL,
          harness_session_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, session_id),
          UNIQUE (workspace_id, harness, harness_session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_runtime_sessions_workspace_updated
          ON agent_runtime_sessions (workspace_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS agent_session_inputs (
          input_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          available_at TEXT NOT NULL,
          attempt INTEGER NOT NULL DEFAULT 0,
          idempotency_key TEXT,
          claimed_by TEXT,
          claimed_until TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_session_inputs_workspace_created
          ON agent_session_inputs (workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_agent_session_inputs_session_status
          ON agent_session_inputs (session_id, status, available_at);

      CREATE TABLE IF NOT EXISTS session_runtime_state (
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('IDLE', 'BUSY', 'WAITING_USER', 'ERROR', 'QUEUED')),
          current_input_id TEXT,
          current_worker_id TEXT,
          lease_until TEXT,
          heartbeat_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, session_id)
      );

      CREATE INDEX IF NOT EXISTS session_runtime_state_workspace_session_idx
          ON session_runtime_state (workspace_id, session_id);

      CREATE INDEX IF NOT EXISTS session_runtime_state_session_id_idx
          ON session_runtime_state (session_id);

      CREATE TABLE IF NOT EXISTS sandbox_run_tokens (
          token TEXT PRIMARY KEY,
          run_id TEXT NOT NULL UNIQUE,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          input_id TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_messages (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_messages_workspace_session_created
          ON session_messages (workspace_id, session_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS session_output_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          input_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_output_events_session_input_sequence
          ON session_output_events (session_id, input_id, sequence ASC);

      CREATE INDEX IF NOT EXISTS idx_session_output_events_workspace_session_created
          ON session_output_events (workspace_id, session_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS session_artifacts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          artifact_type TEXT NOT NULL,
          external_id TEXT NOT NULL,
          platform TEXT,
          title TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_artifacts_workspace_session_created
          ON session_artifacts (workspace_id, session_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS task_proposals (
          proposal_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          task_name TEXT NOT NULL,
          task_prompt TEXT NOT NULL,
          task_generation_rationale TEXT NOT NULL,
          source_event_ids TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'not_reviewed'
      );

      CREATE INDEX IF NOT EXISTS idx_task_proposals_workspace_created
          ON task_proposals (workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_task_proposals_workspace_state_created
          ON task_proposals (workspace_id, state, created_at DESC);

      CREATE TABLE IF NOT EXISTS output_folders (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_output_folders_workspace_position
          ON output_folders (workspace_id, position ASC, created_at ASC);

      CREATE TABLE IF NOT EXISTS outputs (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          output_type TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          module_id TEXT,
          module_resource_id TEXT,
          file_path TEXT,
          html_content TEXT,
          session_id TEXT,
          artifact_id TEXT,
          folder_id TEXT,
          platform TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_outputs_workspace_created
          ON outputs (workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_outputs_workspace_folder_created
          ON outputs (workspace_id, folder_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS app_builds (
          workspace_id TEXT NOT NULL,
          app_id TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, app_id)
      );

      CREATE INDEX IF NOT EXISTS idx_app_builds_workspace
          ON app_builds (workspace_id);

      CREATE TABLE IF NOT EXISTS app_ports (
          workspace_id TEXT NOT NULL,
          app_id TEXT NOT NULL,
          port INTEGER NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, app_id)
      );

      CREATE INDEX IF NOT EXISTS idx_app_ports_workspace
          ON app_ports (workspace_id);

      CREATE TABLE IF NOT EXISTS cronjobs (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          initiated_by TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          cron TEXT NOT NULL,
          description TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          delivery TEXT NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}',
          last_run_at TEXT,
          next_run_at TEXT,
          run_count INTEGER NOT NULL DEFAULT 0,
          last_status TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cronjobs_workspace_created
          ON cronjobs (workspace_id, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_cronjobs_enabled_next_run
          ON cronjobs (enabled, next_run_at);
    `);
  }

  private migrateSandboxRunTokensTable(db: Database.Database): void {
    const tables = new Set<string>(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (row) => row.name
      )
    );
    if (!tables.has("sandbox_run_tokens")) {
      return;
    }

    const columns = new Set<string>(
      (db.prepare("PRAGMA table_info(sandbox_run_tokens)").all() as Array<{ name: string }>).map((row) => row.name)
    );
    if (!columns.has("holaboss_user_id")) {
      return;
    }

    db.exec(`
      ALTER TABLE sandbox_run_tokens RENAME TO sandbox_run_tokens_legacy_with_user;

      CREATE TABLE sandbox_run_tokens (
          token TEXT PRIMARY KEY,
          run_id TEXT NOT NULL UNIQUE,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          input_id TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      INSERT INTO sandbox_run_tokens (
          token,
          run_id,
          workspace_id,
          session_id,
          input_id,
          scopes,
          expires_at,
          revoked_at,
          created_at,
          updated_at
      )
      SELECT
          token,
          run_id,
          workspace_id,
          session_id,
          input_id,
          scopes,
          expires_at,
          revoked_at,
          created_at,
          updated_at
      FROM sandbox_run_tokens_legacy_with_user;

      DROP TABLE sandbox_run_tokens_legacy_with_user;
    `);
  }

  private ensureWorkspacesTableSchema(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          workspace_path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          harness TEXT,
          main_session_id TEXT,
          error_message TEXT,
          onboarding_status TEXT NOT NULL,
          onboarding_session_id TEXT,
          onboarding_completed_at TEXT,
          onboarding_completion_summary TEXT,
          onboarding_requested_at TEXT,
          onboarding_requested_by TEXT,
          created_at TEXT,
          updated_at TEXT,
          deleted_at_utc TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_updated
          ON workspaces (updated_at DESC, created_at DESC);
    `);

    const tableNames = new Set<string>(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (row) => row.name
      )
    );
    if (tableNames.has("workspaces")) {
      const columns = new Set<string>(
        (db.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>).map((row) => row.name)
      );
      if (!columns.has("workspace_path")) {
        db.exec(`
          ALTER TABLE workspaces RENAME TO workspaces_legacy_no_path;

          CREATE TABLE workspaces (
              id TEXT PRIMARY KEY,
              workspace_path TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              status TEXT NOT NULL,
              harness TEXT,
              main_session_id TEXT,
              error_message TEXT,
              onboarding_status TEXT NOT NULL,
              onboarding_session_id TEXT,
              onboarding_completed_at TEXT,
              onboarding_completion_summary TEXT,
              onboarding_requested_at TEXT,
              onboarding_requested_by TEXT,
              created_at TEXT,
              updated_at TEXT,
              deleted_at_utc TEXT
          );

          INSERT INTO workspaces (
              id,
              workspace_path,
              name,
              status,
              harness,
              main_session_id,
              error_message,
              onboarding_status,
              onboarding_session_id,
              onboarding_completed_at,
              onboarding_completion_summary,
              onboarding_requested_at,
              onboarding_requested_by,
              created_at,
              updated_at,
              deleted_at_utc
          )
          SELECT
              id,
              '' AS workspace_path,
              name,
              status,
              harness,
              main_session_id,
              error_message,
              onboarding_status,
              onboarding_session_id,
              onboarding_completed_at,
              onboarding_completion_summary,
              onboarding_requested_at,
              onboarding_requested_by,
              created_at,
              updated_at,
              deleted_at_utc
          FROM workspaces_legacy_no_path;

          DROP TABLE workspaces_legacy_no_path;
        `);
      }
    }

    this.migrateWorkspacesTable(db);
  }

  private migrateWorkspacesTable(db: Database.Database): void {
    const tableNames = new Set<string>(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (row) => row.name
      )
    );

    if (tableNames.has("workspaces")) {
      const rows = db.prepare<[], WorkspaceRow>("SELECT * FROM workspaces").all();
      for (const row of rows) {
        const workspacePath = row.workspace_path.trim();
        const resolvedPath =
          workspacePath && fs.existsSync(workspacePath) && fs.statSync(workspacePath).isDirectory()
            ? workspacePath
            : this.discoverWorkspacePath(row.id) ?? this.defaultWorkspaceDir(row.id);
        db.prepare("UPDATE workspaces SET workspace_path = ? WHERE id = ?").run(resolvedPath, row.id);
        this.writeWorkspaceIdentityFile(resolvedPath, row.id);
      }
    }

    if (tableNames.has("workspaces_legacy_with_owner")) {
      const rows = db.prepare<[], Omit<WorkspaceRow, "workspace_path">>("SELECT * FROM workspaces_legacy_with_owner").all();
      for (const row of rows) {
        const record = this.workspaceRecordFromRowLike(row);
        this.upsertWorkspaceRow(record, this.discoverWorkspacePath(record.id) ?? this.defaultWorkspaceDir(record.id), db);
      }
      db.exec("DROP TABLE workspaces_legacy_with_owner; DROP INDEX IF EXISTS idx_workspaces_user_updated;");
    }

    if (!fs.existsSync(this.workspaceRoot) || !fs.statSync(this.workspaceRoot).isDirectory()) {
      return;
    }

    for (const childName of fs.readdirSync(this.workspaceRoot)) {
      const childPath = path.join(this.workspaceRoot, childName);
      if (!fs.statSync(childPath).isDirectory()) {
        continue;
      }
      const legacyMetadataPath = path.join(childPath, LEGACY_WORKSPACE_METADATA_FILENAME);
      if (!fs.existsSync(legacyMetadataPath)) {
        continue;
      }

      const payload = JSON.parse(fs.readFileSync(legacyMetadataPath, "utf-8")) as Record<string, unknown>;
      const record = this.workspaceRecordFromLegacyPayload(payload);
      this.upsertWorkspaceRow(record, childPath, db);
      this.writeWorkspaceIdentityFile(childPath, record.id);
      fs.rmSync(legacyMetadataPath, { force: true });
    }
  }

  private rowToWorkspace(row: WorkspaceRow): WorkspaceRecord {
    return this.workspaceRecordFromRowLike(row);
  }

  private workspaceRecordFromRowLike(row: Record<string, unknown>): WorkspaceRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      harness: row.harness == null ? null : String(row.harness),
      mainSessionId: row.main_session_id == null ? null : String(row.main_session_id),
      errorMessage: row.error_message == null ? null : String(row.error_message),
      onboardingStatus: String(row.onboarding_status),
      onboardingSessionId: row.onboarding_session_id == null ? null : String(row.onboarding_session_id),
      onboardingCompletedAt: row.onboarding_completed_at == null ? null : String(row.onboarding_completed_at),
      onboardingCompletionSummary:
        row.onboarding_completion_summary == null ? null : String(row.onboarding_completion_summary),
      onboardingRequestedAt: row.onboarding_requested_at == null ? null : String(row.onboarding_requested_at),
      onboardingRequestedBy: row.onboarding_requested_by == null ? null : String(row.onboarding_requested_by),
      createdAt: row.created_at == null ? null : String(row.created_at),
      updatedAt: row.updated_at == null ? null : String(row.updated_at),
      deletedAtUtc: row.deleted_at_utc == null ? null : String(row.deleted_at_utc)
    };
  }

  private workspaceRecordFromLegacyPayload(data: Record<string, unknown>): WorkspaceRecord {
    return {
      id: String(data.id),
      name: String(data.name),
      status: String(data.status),
      harness: data.harness == null ? null : String(data.harness),
      mainSessionId: data.main_session_id == null ? null : String(data.main_session_id),
      errorMessage: data.error_message == null ? null : String(data.error_message),
      onboardingStatus: String(data.onboarding_status),
      onboardingSessionId: data.onboarding_session_id == null ? null : String(data.onboarding_session_id),
      onboardingCompletedAt: data.onboarding_completed_at == null ? null : String(data.onboarding_completed_at),
      onboardingCompletionSummary:
        data.onboarding_completion_summary == null ? null : String(data.onboarding_completion_summary),
      onboardingRequestedAt: data.onboarding_requested_at == null ? null : String(data.onboarding_requested_at),
      onboardingRequestedBy: data.onboarding_requested_by == null ? null : String(data.onboarding_requested_by),
      createdAt: data.created_at == null ? null : String(data.created_at),
      updatedAt: data.updated_at == null ? null : String(data.updated_at),
      deletedAtUtc: data.deleted_at_utc == null ? null : String(data.deleted_at_utc)
    };
  }

  private workspacePathFromRegistry(workspaceId: string): string | null {
    const row = this.db()
      .prepare<[string], { workspace_path: string | null }>("SELECT workspace_path FROM workspaces WHERE id = ? LIMIT 1")
      .get(workspaceId);
    if (!row || row.workspace_path == null) {
      return null;
    }
    const value = row.workspace_path.trim();
    return value || null;
  }

  private upsertWorkspaceRow(record: WorkspaceRecord, workspacePath: string, db = this.db()): void {
    db.prepare(`
      INSERT INTO workspaces (
          id, workspace_path, name, status, harness, main_session_id, error_message,
          onboarding_status, onboarding_session_id, onboarding_completed_at,
          onboarding_completion_summary, onboarding_requested_at, onboarding_requested_by,
          created_at, updated_at, deleted_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
          workspace_path = excluded.workspace_path,
          name = excluded.name,
          status = excluded.status,
          harness = excluded.harness,
          main_session_id = excluded.main_session_id,
          error_message = excluded.error_message,
          onboarding_status = excluded.onboarding_status,
          onboarding_session_id = excluded.onboarding_session_id,
          onboarding_completed_at = excluded.onboarding_completed_at,
          onboarding_completion_summary = excluded.onboarding_completion_summary,
          onboarding_requested_at = excluded.onboarding_requested_at,
          onboarding_requested_by = excluded.onboarding_requested_by,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at_utc = excluded.deleted_at_utc
    `).run(
      record.id,
      workspacePath,
      record.name,
      record.status,
      record.harness,
      record.mainSessionId,
      record.errorMessage,
      record.onboardingStatus,
      record.onboardingSessionId,
      record.onboardingCompletedAt,
      record.onboardingCompletionSummary,
      record.onboardingRequestedAt,
      record.onboardingRequestedBy,
      record.createdAt,
      record.updatedAt,
      record.deletedAtUtc
    );
  }

  private writeWorkspaceIdentityFile(workspacePath: string, workspaceId: string): void {
    const runtimeDir = path.join(workspacePath, WORKSPACE_RUNTIME_DIRNAME);
    fs.mkdirSync(runtimeDir, { recursive: true });
    const identityPath = path.join(runtimeDir, WORKSPACE_IDENTITY_FILENAME);
    const tempPath = `${identityPath}.tmp`;
    fs.writeFileSync(tempPath, `${workspaceId}\n`, "utf-8");
    fs.renameSync(tempPath, identityPath);
  }

  private discoverWorkspacePath(workspaceId: string): string | null {
    if (!fs.existsSync(this.workspaceRoot) || !fs.statSync(this.workspaceRoot).isDirectory()) {
      return null;
    }

    for (const childName of fs.readdirSync(this.workspaceRoot)) {
      const childPath = path.join(this.workspaceRoot, childName);
      if (!fs.statSync(childPath).isDirectory()) {
        continue;
      }
      const identityPath = path.join(childPath, WORKSPACE_RUNTIME_DIRNAME, WORKSPACE_IDENTITY_FILENAME);
      if (!fs.existsSync(identityPath) || !fs.statSync(identityPath).isFile()) {
        continue;
      }

      try {
        const raw = fs.readFileSync(identityPath, "utf-8").trim();
        if (raw === workspaceId) {
          return childPath;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private updateWorkspacePath(workspaceId: string, workspacePath: string): void {
    this.db().prepare("UPDATE workspaces SET workspace_path = ? WHERE id = ?").run(workspacePath, workspaceId);
  }

  private recoverMissingWorkspaceRecord(workspaceId: string): WorkspaceRecord | null {
    const discovered = this.discoverWorkspacePath(workspaceId);
    if (!discovered) {
      return null;
    }

    const now = utcNowIso();
    const record: WorkspaceRecord = {
      id: workspaceId,
      name: workspaceId,
      status: "active",
      harness: this.sandboxAgentHarness,
      mainSessionId: null,
      errorMessage: null,
      onboardingStatus: "not_required",
      onboardingSessionId: null,
      onboardingCompletedAt: null,
      onboardingCompletionSummary: null,
      onboardingRequestedAt: null,
      onboardingRequestedBy: null,
      createdAt: now,
      updatedAt: now,
      deletedAtUtc: null
    };
    this.upsertWorkspaceRow(record, discovered);
    return record;
  }

  private defaultWorkspaceDir(workspaceId: string): string {
    return path.join(this.workspaceRoot, sanitizeWorkspaceId(workspaceId));
  }

  private rowToInput(row: Record<string, unknown> | undefined): SessionInputRecord | null {
    if (!row) {
      return null;
    }
    return {
      inputId: String(row.input_id),
      sessionId: String(row.session_id),
      workspaceId: String(row.workspace_id),
      payload: this.parseJsonDict(row.payload),
      status: String(row.status),
      priority: Number(row.priority),
      availableAt: String(row.available_at),
      attempt: Number(row.attempt),
      idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
      claimedBy: row.claimed_by == null ? null : String(row.claimed_by),
      claimedUntil: row.claimed_until == null ? null : String(row.claimed_until),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private rowToRuntimeState(row: Record<string, unknown> | undefined): SessionRuntimeStateRecord {
    if (!row) {
      throw new Error("runtime state row not found");
    }
    return {
      workspaceId: String(row.workspace_id),
      sessionId: String(row.session_id),
      status: String(row.status),
      currentInputId: row.current_input_id == null ? null : String(row.current_input_id),
      currentWorkerId: row.current_worker_id == null ? null : String(row.current_worker_id),
      leaseUntil: row.lease_until == null ? null : String(row.lease_until),
      heartbeatAt: row.heartbeat_at == null ? null : String(row.heartbeat_at),
      lastError: this.parseJsonObjectOrMessage(row.last_error),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private parseJsonDict(raw: unknown): Record<string, unknown> {
    if (raw == null) {
      return {};
    }
    if (typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    try {
      const parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { value: parsed as unknown };
    } catch {
      return { message: String(raw) };
    }
  }

  private parseJsonObjectOrMessage(raw: unknown): Record<string, unknown> | null {
    if (raw == null) {
      return null;
    }
    try {
      const parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { message: String(raw) };
    } catch {
      return { message: String(raw) };
    }
  }

  private rowToSessionArtifact(row: Record<string, unknown>): SessionArtifactRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      workspaceId: String(row.workspace_id),
      artifactType: String(row.artifact_type),
      externalId: String(row.external_id),
      platform: row.platform == null ? null : String(row.platform),
      title: row.title == null ? null : String(row.title),
      metadata: this.parseJsonDict(row.metadata),
      createdAt: String(row.created_at)
    };
  }

  private rowToOutputFolder(row: Record<string, unknown>): OutputFolderRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      position: Number(row.position),
      createdAt: row.created_at == null ? null : String(row.created_at),
      updatedAt: row.updated_at == null ? null : String(row.updated_at)
    };
  }

  private rowToOutput(row: Record<string, unknown>): OutputRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      outputType: String(row.output_type),
      title: row.title == null ? "" : String(row.title),
      status: row.status == null ? "draft" : String(row.status),
      moduleId: row.module_id == null ? null : String(row.module_id),
      moduleResourceId: row.module_resource_id == null ? null : String(row.module_resource_id),
      filePath: row.file_path == null ? null : String(row.file_path),
      htmlContent: row.html_content == null ? null : String(row.html_content),
      sessionId: row.session_id == null ? null : String(row.session_id),
      artifactId: row.artifact_id == null ? null : String(row.artifact_id),
      folderId: row.folder_id == null ? null : String(row.folder_id),
      platform: row.platform == null ? null : String(row.platform),
      metadata: this.parseJsonDict(row.metadata),
      createdAt: row.created_at == null ? null : String(row.created_at),
      updatedAt: row.updated_at == null ? null : String(row.updated_at)
    };
  }

  private rowToAppBuild(row: Record<string, unknown>): AppBuildRecord {
    return {
      workspaceId: String(row.workspace_id),
      appId: String(row.app_id),
      status: String(row.status),
      startedAt: row.started_at == null ? null : String(row.started_at),
      completedAt: row.completed_at == null ? null : String(row.completed_at),
      error: row.error == null ? null : String(row.error),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private rowToCronjob(row: Record<string, unknown>): CronjobRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      initiatedBy: String(row.initiated_by),
      name: row.name == null ? "" : String(row.name),
      cron: String(row.cron),
      description: String(row.description),
      enabled: Boolean(Number(row.enabled)),
      delivery: this.parseJsonDict(row.delivery),
      metadata: this.parseJsonDict(row.metadata),
      lastRunAt: row.last_run_at == null ? null : String(row.last_run_at),
      nextRunAt: row.next_run_at == null ? null : String(row.next_run_at),
      runCount: Number(row.run_count ?? 0),
      lastStatus: row.last_status == null ? null : String(row.last_status),
      lastError: row.last_error == null ? null : String(row.last_error),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private rowToTaskProposal(row: Record<string, unknown>): TaskProposalRecord {
    const sourceEventIds = this.parseJsonList(row.source_event_ids).filter((item): item is string => typeof item === "string");
    return {
      proposalId: String(row.proposal_id),
      workspaceId: String(row.workspace_id),
      taskName: String(row.task_name),
      taskPrompt: String(row.task_prompt),
      taskGenerationRationale: String(row.task_generation_rationale),
      sourceEventIds,
      createdAt: String(row.created_at),
      state: String(row.state)
    };
  }

  private parseJsonList(raw: unknown): unknown[] {
    if (raw == null) {
      return [];
    }
    if (Array.isArray(raw)) {
      return raw;
    }
    try {
      const parsed = JSON.parse(String(raw));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
