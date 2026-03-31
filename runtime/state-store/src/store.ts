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

export interface AgentSessionRecord {
  workspaceId: string;
  sessionId: string;
  kind: string;
  title: string | null;
  parentSessionId: string | null;
  sourceProposalId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface SessionBindingRecord {
  workspaceId: string;
  sessionId: string;
  harness: string;
  harnessSessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationConnectionRecord {
  connectionId: string;
  providerId: string;
  ownerUserId: string;
  accountLabel: string;
  accountExternalId: string | null;
  authMode: string;
  grantedScopes: string[];
  status: string;
  secretRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationBindingRecord {
  bindingId: string;
  workspaceId: string;
  targetType: string;
  targetId: string;
  integrationKey: string;
  connectionId: string;
  isDefault: boolean;
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

export interface OAuthAppConfigRecord {
  providerId: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectPort: number;
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
  acceptedSessionId: string | null;
  acceptedInputId: string | null;
  acceptedAt: string | null;
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

type AgentSessionUpdateFields = Partial<{
  kind: string | null;
  title: string | null;
  parentSessionId: string | null;
  sourceProposalId: string | null;
  createdBy: string | null;
  archivedAt: string | null;
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

type TaskProposalUpdateFields = Partial<{
  taskName: string;
  taskPrompt: string;
  taskGenerationRationale: string;
  state: string;
  acceptedSessionId: string | null;
  acceptedInputId: string | null;
  acceptedAt: string | null;
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

  ensureSession(
    params: {
      workspaceId: string;
      sessionId: string;
      kind?: string | null;
      title?: string | null;
      parentSessionId?: string | null;
      sourceProposalId?: string | null;
      createdBy?: string | null;
      archivedAt?: string | null;
    },
    options: { touchExisting?: boolean } = {}
  ): AgentSessionRecord {
    const existing = this.getSession({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId
    });
    const now = utcNowIso();

    if (!existing) {
      this.db()
        .prepare(`
          INSERT INTO agent_sessions (
              workspace_id,
              session_id,
              kind,
              title,
              parent_session_id,
              source_proposal_id,
              created_by,
              created_at,
              updated_at,
              archived_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          params.workspaceId,
          params.sessionId,
          this.normalizedSessionKind(params.kind),
          this.normalizedNullableText(params.title),
          this.normalizedNullableText(params.parentSessionId),
          this.normalizedNullableText(params.sourceProposalId),
          this.normalizedNullableText(params.createdBy),
          now,
          now,
          this.normalizedNullableText(params.archivedAt)
        );
      return this.requireSession({
        workspaceId: params.workspaceId,
        sessionId: params.sessionId
      });
    }

    const updates: AgentSessionUpdateFields = {};
    if (params.kind !== undefined) {
      updates.kind = this.normalizedSessionKind(params.kind);
    }
    if (params.title !== undefined) {
      updates.title = this.normalizedNullableText(params.title);
    }
    if (params.parentSessionId !== undefined) {
      updates.parentSessionId = this.normalizedNullableText(params.parentSessionId);
    }
    if (params.sourceProposalId !== undefined) {
      updates.sourceProposalId = this.normalizedNullableText(params.sourceProposalId);
    }
    if (params.createdBy !== undefined) {
      updates.createdBy = this.normalizedNullableText(params.createdBy);
    }
    if (params.archivedAt !== undefined) {
      updates.archivedAt = this.normalizedNullableText(params.archivedAt);
    }

    if (Object.keys(updates).length > 0) {
      return this.requireUpdatedSession({
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        fields: updates
      });
    }

    if (options.touchExisting === false) {
      return existing;
    }

    this.db()
      .prepare("UPDATE agent_sessions SET updated_at = ? WHERE workspace_id = ? AND session_id = ?")
      .run(now, params.workspaceId, params.sessionId);
    return this.requireSession({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId
    });
  }

  getSession(params: { workspaceId: string; sessionId: string }): AgentSessionRecord | null {
    const row = this.db()
      .prepare<[string, string], Record<string, unknown>>(`
        SELECT *
        FROM agent_sessions
        WHERE workspace_id = ? AND session_id = ?
        LIMIT 1
      `)
      .get(params.workspaceId, params.sessionId);
    return row ? this.rowToAgentSession(row) : null;
  }

  listSessions(params: {
    workspaceId: string;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  }): AgentSessionRecord[] {
    const rows = this.db()
      .prepare<[string, number, number, number], Record<string, unknown>>(`
        SELECT *
        FROM agent_sessions
        WHERE workspace_id = ?
          AND (? = 1 OR archived_at IS NULL)
        ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC, session_id DESC
        LIMIT ? OFFSET ?
      `)
      .all(
        params.workspaceId,
        params.includeArchived ? 1 : 0,
        params.limit ?? 100,
        params.offset ?? 0
      );
    return rows.map((row) => this.rowToAgentSession(row));
  }

  updateTaskProposal(params: { proposalId: string; fields: TaskProposalUpdateFields }): TaskProposalRecord | null {
    const entries = Object.entries(params.fields);
    if (entries.length === 0) {
      return this.getTaskProposal(params.proposalId);
    }

    const columnMap: Record<keyof TaskProposalUpdateFields, string> = {
      taskName: "task_name",
      taskPrompt: "task_prompt",
      taskGenerationRationale: "task_generation_rationale",
      state: "state",
      acceptedSessionId: "accepted_session_id",
      acceptedInputId: "accepted_input_id",
      acceptedAt: "accepted_at"
    };

    const assignments: string[] = [];
    const values: Array<string | null> = [];
    for (const [key, value] of entries) {
      const column = columnMap[key as keyof TaskProposalUpdateFields];
      if (!column) {
        throw new Error(`unsupported task proposal update field: ${key}`);
      }
      assignments.push(`${column} = ?`);
      values.push(value == null ? null : String(value));
    }
    values.push(params.proposalId);

    const result = this.db()
      .prepare(`UPDATE task_proposals SET ${assignments.join(", ")} WHERE proposal_id = ?`)
      .run(...values);
    if (result.changes <= 0) {
      return null;
    }
    return this.getTaskProposal(params.proposalId);
  }

  upsertBinding(params: {
    workspaceId: string;
    sessionId: string;
    harness: string;
    harnessSessionId: string;
  }): SessionBindingRecord {
    this.ensureSession(
      {
        workspaceId: params.workspaceId,
        sessionId: params.sessionId
      },
      { touchExisting: false }
    );
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

  upsertIntegrationConnection(params: {
    connectionId: string;
    providerId: string;
    ownerUserId: string;
    accountLabel: string;
    accountExternalId?: string | null;
    authMode: string;
    grantedScopes: string[];
    status: string;
    secretRef?: string | null;
  }): IntegrationConnectionRecord {
    const now = utcNowIso();
    this.db()
      .prepare(`
        INSERT INTO integration_connections (
            connection_id, provider_id, owner_user_id, account_label, account_external_id,
            auth_mode, granted_scopes, status, secret_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET
            provider_id = excluded.provider_id,
            owner_user_id = excluded.owner_user_id,
            account_label = excluded.account_label,
            account_external_id = excluded.account_external_id,
            auth_mode = excluded.auth_mode,
            granted_scopes = excluded.granted_scopes,
            status = excluded.status,
            secret_ref = excluded.secret_ref,
            updated_at = excluded.updated_at
      `)
      .run(
        params.connectionId,
        params.providerId,
        params.ownerUserId,
        params.accountLabel,
        params.accountExternalId ?? null,
        params.authMode,
        JSON.stringify(params.grantedScopes ?? []),
        params.status,
        params.secretRef ?? null,
        now,
        now
      );
    const record = this.getIntegrationConnection(params.connectionId);
    if (!record) {
      throw new Error("failed to load integration connection");
    }
    return record;
  }

  getIntegrationConnection(connectionId: string): IntegrationConnectionRecord | null {
    const row = this.db()
      .prepare<[string], Record<string, unknown>>(
        "SELECT * FROM integration_connections WHERE connection_id = ? LIMIT 1"
      )
      .get(connectionId);
    return row ? this.rowToIntegrationConnection(row) : null;
  }

  listIntegrationConnections(params: { providerId?: string; ownerUserId?: string } = {}): IntegrationConnectionRecord[] {
    let query = "SELECT * FROM integration_connections";
    const filters: string[] = [];
    const values: string[] = [];
    if (params.providerId) {
      filters.push("provider_id = ?");
      values.push(params.providerId);
    }
    if (params.ownerUserId) {
      filters.push("owner_user_id = ?");
      values.push(params.ownerUserId);
    }
    if (filters.length > 0) {
      query += ` WHERE ${filters.join(" AND ")}`;
    }
    query += " ORDER BY datetime(created_at) ASC, connection_id ASC";
    const rows = this.db().prepare(query).all(...values) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToIntegrationConnection(row));
  }

  upsertIntegrationBinding(params: {
    bindingId: string;
    workspaceId: string;
    targetType: string;
    targetId: string;
    integrationKey: string;
    connectionId: string;
    isDefault: boolean;
  }): IntegrationBindingRecord {
    const connection = this.getIntegrationConnection(params.connectionId);
    if (!connection) {
      throw new Error(`integration connection ${params.connectionId} not found`);
    }

    const now = utcNowIso();
    const existing = this.getIntegrationBindingByTarget({
      workspaceId: params.workspaceId,
      targetType: params.targetType,
      targetId: params.targetId,
      integrationKey: params.integrationKey
    });

    if (existing) {
      this.db()
        .prepare(`
          UPDATE integration_bindings
          SET binding_id = ?,
              connection_id = ?,
              is_default = ?,
              updated_at = ?
          WHERE workspace_id = ? AND target_type = ? AND target_id = ? AND integration_key = ?
        `)
        .run(
          params.bindingId,
          params.connectionId,
          params.isDefault ? 1 : 0,
          now,
          params.workspaceId,
          params.targetType,
          params.targetId,
          params.integrationKey
        );
    } else {
      this.db()
        .prepare(`
          INSERT INTO integration_bindings (
              binding_id, workspace_id, target_type, target_id, integration_key,
              connection_id, is_default, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          params.bindingId,
          params.workspaceId,
          params.targetType,
          params.targetId,
          params.integrationKey,
          params.connectionId,
          params.isDefault ? 1 : 0,
          now,
          now
        );
    }

    const record = this.getIntegrationBindingByTarget({
      workspaceId: params.workspaceId,
      targetType: params.targetType,
      targetId: params.targetId,
      integrationKey: params.integrationKey
    });
    if (!record) {
      throw new Error("failed to load integration binding");
    }
    return record;
  }

  getIntegrationBinding(bindingId: string): IntegrationBindingRecord | null {
    const row = this.db()
      .prepare<[string], Record<string, unknown>>("SELECT * FROM integration_bindings WHERE binding_id = ? LIMIT 1")
      .get(bindingId);
    return row ? this.rowToIntegrationBinding(row) : null;
  }

  getIntegrationBindingByTarget(params: {
    workspaceId: string;
    targetType: string;
    targetId: string;
    integrationKey: string;
  }): IntegrationBindingRecord | null {
    const row = this.db()
      .prepare<[string, string, string, string], Record<string, unknown>>(`
        SELECT * FROM integration_bindings
        WHERE workspace_id = ? AND target_type = ? AND target_id = ? AND integration_key = ?
        LIMIT 1
      `)
      .get(params.workspaceId, params.targetType, params.targetId, params.integrationKey);
    return row ? this.rowToIntegrationBinding(row) : null;
  }

  listIntegrationBindings(params: { workspaceId?: string }): IntegrationBindingRecord[] {
    let query = "SELECT * FROM integration_bindings";
    const values: string[] = [];
    if (params.workspaceId) {
      query += " WHERE workspace_id = ?";
      values.push(params.workspaceId);
    }
    query += " ORDER BY is_default DESC, datetime(created_at) ASC, binding_id ASC";
    const rows = this.db().prepare(query).all(...values) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToIntegrationBinding(row));
  }

  deleteIntegrationConnection(connectionId: string): boolean {
    const result = this.db()
      .prepare("DELETE FROM integration_connections WHERE connection_id = ?")
      .run(connectionId);
    return result.changes > 0;
  }

  deleteIntegrationBinding(bindingId: string): boolean {
    const result = this.db().prepare("DELETE FROM integration_bindings WHERE binding_id = ?").run(bindingId);
    return result.changes > 0;
  }

  upsertOAuthAppConfig(params: {
    providerId: string;
    clientId: string;
    clientSecret: string;
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string[];
    redirectPort?: number;
  }): OAuthAppConfigRecord {
    const now = utcNowIso();
    const redirectPort = params.redirectPort ?? 38765;
    this.db().prepare(`
      INSERT INTO oauth_app_configs (provider_id, client_id, client_secret, authorize_url, token_url, scopes, redirect_port, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider_id) DO UPDATE SET
        client_id = excluded.client_id,
        client_secret = CASE WHEN excluded.client_secret = '' THEN oauth_app_configs.client_secret ELSE excluded.client_secret END,
        authorize_url = excluded.authorize_url,
        token_url = excluded.token_url,
        scopes = excluded.scopes,
        redirect_port = excluded.redirect_port,
        updated_at = excluded.updated_at
    `).run(
      params.providerId, params.clientId, params.clientSecret,
      params.authorizeUrl, params.tokenUrl, JSON.stringify(params.scopes),
      redirectPort, now, now
    );
    const record = this.getOAuthAppConfig(params.providerId);
    if (!record) {
      throw new Error("failed to load OAuth app config");
    }
    return record;
  }

  getOAuthAppConfig(providerId: string): OAuthAppConfigRecord | null {
    const row = this.db().prepare("SELECT * FROM oauth_app_configs WHERE provider_id = ?").get(providerId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      providerId: row.provider_id as string,
      clientId: row.client_id as string,
      clientSecret: row.client_secret as string,
      authorizeUrl: row.authorize_url as string,
      tokenUrl: row.token_url as string,
      scopes: JSON.parse(row.scopes as string ?? "[]") as string[],
      redirectPort: row.redirect_port as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  listOAuthAppConfigs(): OAuthAppConfigRecord[] {
    const rows = this.db().prepare("SELECT * FROM oauth_app_configs ORDER BY provider_id").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      providerId: row.provider_id as string,
      clientId: row.client_id as string,
      clientSecret: row.client_secret as string,
      authorizeUrl: row.authorize_url as string,
      tokenUrl: row.token_url as string,
      scopes: JSON.parse(row.scopes as string ?? "[]") as string[],
      redirectPort: row.redirect_port as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  deleteOAuthAppConfig(providerId: string): boolean {
    const result = this.db().prepare("DELETE FROM oauth_app_configs WHERE provider_id = ?").run(providerId);
    return result.changes > 0;
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

  claimInputs(params: { limit: number; claimedBy: string; leaseSeconds: number; distinctSessions?: boolean }): SessionInputRecord[] {
    const now = new Date();
    const nowIso = now.toISOString();
    const claimedUntilIso =
      params.leaseSeconds > 0 ? new Date(now.getTime() + params.leaseSeconds * 1000).toISOString() : nowIso;

    const rows = this.db()
      .prepare<[string, string], { input_id: string; session_id: string }>(`
        SELECT input_id, session_id
        FROM agent_session_inputs
        WHERE status = 'QUEUED'
          AND datetime(available_at) <= datetime(?)
          AND (claimed_until IS NULL OR datetime(claimed_until) <= datetime(?))
        ORDER BY priority DESC, datetime(created_at) ASC
      `)
      .all(nowIso, nowIso);

    const selectedInputIds: string[] = [];
    const seenSessionIds = new Set<string>();
    for (const row of rows) {
      if (params.distinctSessions && seenSessionIds.has(row.session_id)) {
        continue;
      }
      selectedInputIds.push(row.input_id);
      if (params.distinctSessions) {
        seenSessionIds.add(row.session_id);
      }
      if (selectedInputIds.length >= Math.max(1, params.limit)) {
        break;
      }
    }

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
    transaction(selectedInputIds);
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
    this.ensureSession(
      {
        workspaceId: params.workspaceId,
        sessionId: params.sessionId
      },
      { touchExisting: false }
    );
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
    this.ensureSession(
      {
        workspaceId: params.workspaceId,
        sessionId: params.sessionId
      },
      { touchExisting: false }
    );
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
            state,
            accepted_session_id,
            accepted_input_id,
            accepted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
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
    return this.updateTaskProposal({
      proposalId: params.proposalId,
      fields: {
        state: params.state
      }
    });
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
    this.ensureTaskProposalsTableSchema(db);
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

      CREATE TABLE IF NOT EXISTS agent_sessions (
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'workspace_session',
          title TEXT,
          parent_session_id TEXT,
          source_proposal_id TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          PRIMARY KEY (workspace_id, session_id),
          UNIQUE (workspace_id, source_proposal_id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_workspace_updated
          ON agent_sessions (workspace_id, updated_at DESC, created_at DESC);

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

      CREATE TABLE IF NOT EXISTS integration_connections (
          connection_id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          account_label TEXT NOT NULL,
          account_external_id TEXT,
          auth_mode TEXT NOT NULL,
          granted_scopes TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL,
          secret_ref TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_integration_connections_provider_owner_updated
          ON integration_connections (provider_id, owner_user_id, updated_at DESC, created_at DESC);

      CREATE TABLE IF NOT EXISTS integration_bindings (
          binding_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          integration_key TEXT NOT NULL,
          connection_id TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (workspace_id, target_type, target_id, integration_key),
          FOREIGN KEY (connection_id) REFERENCES integration_connections(connection_id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_integration_bindings_workspace_updated
          ON integration_bindings (workspace_id, is_default DESC, updated_at DESC, created_at DESC);

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
          state TEXT NOT NULL DEFAULT 'not_reviewed',
          accepted_session_id TEXT,
          accepted_input_id TEXT,
          accepted_at TEXT
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

      CREATE TABLE IF NOT EXISTS oauth_app_configs (
          provider_id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          client_secret TEXT NOT NULL,
          authorize_url TEXT NOT NULL,
          token_url TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          redirect_port INTEGER NOT NULL DEFAULT 38765,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );
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

  private ensureTaskProposalsTableSchema(db: Database.Database): void {
    const tableNames = new Set<string>(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (row) => row.name
      )
    );
    if (!tableNames.has("task_proposals")) {
      return;
    }

    const columns = new Set<string>(
      (db.prepare("PRAGMA table_info(task_proposals)").all() as Array<{ name: string }>).map((row) => row.name)
    );

    if (!columns.has("accepted_session_id")) {
      db.exec("ALTER TABLE task_proposals ADD COLUMN accepted_session_id TEXT;");
    }
    if (!columns.has("accepted_input_id")) {
      db.exec("ALTER TABLE task_proposals ADD COLUMN accepted_input_id TEXT;");
    }
    if (!columns.has("accepted_at")) {
      db.exec("ALTER TABLE task_proposals ADD COLUMN accepted_at TEXT;");
    }
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

  private rowToIntegrationConnection(row: Record<string, unknown>): IntegrationConnectionRecord {
    return {
      connectionId: String(row.connection_id),
      providerId: String(row.provider_id),
      ownerUserId: String(row.owner_user_id),
      accountLabel: String(row.account_label),
      accountExternalId: row.account_external_id == null ? null : String(row.account_external_id),
      authMode: String(row.auth_mode),
      grantedScopes: this.parseJsonList(row.granted_scopes).filter((item): item is string => typeof item === "string"),
      status: String(row.status),
      secretRef: row.secret_ref == null ? null : String(row.secret_ref),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private rowToIntegrationBinding(row: Record<string, unknown>): IntegrationBindingRecord {
    return {
      bindingId: String(row.binding_id),
      workspaceId: String(row.workspace_id),
      targetType: String(row.target_type),
      targetId: String(row.target_id),
      integrationKey: String(row.integration_key),
      connectionId: String(row.connection_id),
      isDefault: Boolean(Number(row.is_default)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private rowToAgentSession(row: Record<string, unknown>): AgentSessionRecord {
    return {
      workspaceId: String(row.workspace_id),
      sessionId: String(row.session_id),
      kind: String(row.kind),
      title: row.title == null ? null : String(row.title),
      parentSessionId: row.parent_session_id == null ? null : String(row.parent_session_id),
      sourceProposalId: row.source_proposal_id == null ? null : String(row.source_proposal_id),
      createdBy: row.created_by == null ? null : String(row.created_by),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      archivedAt: row.archived_at == null ? null : String(row.archived_at)
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
      state: String(row.state),
      acceptedSessionId: row.accepted_session_id == null ? null : String(row.accepted_session_id),
      acceptedInputId: row.accepted_input_id == null ? null : String(row.accepted_input_id),
      acceptedAt: row.accepted_at == null ? null : String(row.accepted_at)
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

  private normalizedNullableText(value: string | null | undefined): string | null {
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
  }

  private normalizedSessionKind(value: string | null | undefined): string {
    return this.normalizedNullableText(value) ?? "workspace_session";
  }

  private requireSession(params: { workspaceId: string; sessionId: string }): AgentSessionRecord {
    const record = this.getSession(params);
    if (!record) {
      throw new Error("agent session row not found");
    }
    return record;
  }

  private requireUpdatedSession(params: {
    workspaceId: string;
    sessionId: string;
    fields: AgentSessionUpdateFields;
  }): AgentSessionRecord {
    const existing = this.requireSession({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId
    });
    const next: AgentSessionRecord = {
      ...existing,
      kind: params.fields.kind == null ? existing.kind : this.normalizedSessionKind(params.fields.kind),
      title: params.fields.title === undefined ? existing.title : this.normalizedNullableText(params.fields.title),
      parentSessionId:
        params.fields.parentSessionId === undefined
          ? existing.parentSessionId
          : this.normalizedNullableText(params.fields.parentSessionId),
      sourceProposalId:
        params.fields.sourceProposalId === undefined
          ? existing.sourceProposalId
          : this.normalizedNullableText(params.fields.sourceProposalId),
      createdBy:
        params.fields.createdBy === undefined ? existing.createdBy : this.normalizedNullableText(params.fields.createdBy),
      archivedAt:
        params.fields.archivedAt === undefined ? existing.archivedAt : this.normalizedNullableText(params.fields.archivedAt),
      updatedAt: utcNowIso()
    };

    this.db()
      .prepare(`
        UPDATE agent_sessions
        SET kind = ?,
            title = ?,
            parent_session_id = ?,
            source_proposal_id = ?,
            created_by = ?,
            updated_at = ?,
            archived_at = ?
        WHERE workspace_id = ? AND session_id = ?
      `)
      .run(
        next.kind,
        next.title,
        next.parentSessionId,
        next.sourceProposalId,
        next.createdBy,
        next.updatedAt,
        next.archivedAt,
        params.workspaceId,
        params.sessionId
      );

    return this.requireSession({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId
    });
  }
}
