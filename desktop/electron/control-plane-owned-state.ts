import Database from "better-sqlite3"

export type WorkspaceLocation = "local" | "cloud"

export interface WorkspaceRegistryRecord {
  id: string
  location: WorkspaceLocation
  name: string
  status: string
  harness: string | null
  error_message: string | null
  onboarding_status: string
  onboarding_session_id: string | null
  onboarding_completed_at: string | null
  onboarding_completion_summary: string | null
  onboarding_requested_at: string | null
  onboarding_requested_by: string | null
  created_at: string | null
  updated_at: string | null
  deleted_at_utc: string | null
  workspace_path?: string | null
  folder_state?: "healthy" | "missing" | null
}

export interface WorkspaceRegistryListResponse {
  items: WorkspaceRegistryRecord[]
  total: number
  limit: number
  offset: number
}

export interface LocalWorkspaceRegistry {
  getWorkspaceRecord(workspaceId: string): WorkspaceRegistryRecord | null
  listCachedWorkspaces(): WorkspaceRegistryListResponse
}

export interface LocalWorkspaceRegistryOptions {
  runtimeDatabasePath: () => string
  location: WorkspaceLocation
}

function mapWorkspaceRegistryRow(
  row: Record<string, unknown>,
  {
    location,
    hasWorkspacePath,
  }: {
    location: WorkspaceLocation
    hasWorkspacePath: boolean
  },
): WorkspaceRegistryRecord {
  return {
    id: String(row.id ?? ""),
    location,
    name: String(row.name ?? ""),
    status: String(row.status ?? "unknown"),
    harness: row.harness == null ? null : String(row.harness),
    error_message: row.error_message == null ? null : String(row.error_message),
    onboarding_status: String(row.onboarding_status ?? "complete"),
    onboarding_session_id:
      row.onboarding_session_id == null
        ? null
        : String(row.onboarding_session_id),
    onboarding_completed_at:
      row.onboarding_completed_at == null
        ? null
        : String(row.onboarding_completed_at),
    onboarding_completion_summary:
      row.onboarding_completion_summary == null
        ? null
        : String(row.onboarding_completion_summary),
    onboarding_requested_at:
      row.onboarding_requested_at == null
        ? null
        : String(row.onboarding_requested_at),
    onboarding_requested_by:
      row.onboarding_requested_by == null
        ? null
        : String(row.onboarding_requested_by),
    created_at: row.created_at == null ? null : String(row.created_at),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
    deleted_at_utc:
      row.deleted_at_utc == null ? null : String(row.deleted_at_utc),
    workspace_path:
      hasWorkspacePath && row.workspace_path != null
        ? String(row.workspace_path)
        : null,
  }
}

export function createLocalWorkspaceRegistry(
  options: LocalWorkspaceRegistryOptions,
): LocalWorkspaceRegistry {
  function getWorkspaceRecord(
    workspaceId: string,
  ): WorkspaceRegistryRecord | null {
    const database = new Database(options.runtimeDatabasePath(), {
      readonly: true,
    })
    try {
      const row = database
        .prepare(
          `
          SELECT
            id,
            name,
            status,
            harness,
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
          FROM workspaces
          WHERE id = @id
        `,
        )
        .get({ id: workspaceId }) as Record<string, unknown> | undefined
      if (!row) {
        return null
      }
      return mapWorkspaceRegistryRow(row, {
        location: options.location,
        hasWorkspacePath: false,
      })
    } finally {
      database.close()
    }
  }

  function listCachedWorkspaces(): WorkspaceRegistryListResponse {
    const empty: WorkspaceRegistryListResponse = {
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    }
    let database: Database.Database | null = null
    try {
      database = new Database(options.runtimeDatabasePath(), { readonly: true })
      const tableExists = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspaces' LIMIT 1",
        )
        .get()
      if (!tableExists) {
        return empty
      }
      const columns = new Set<string>(
        (
          database.prepare("PRAGMA table_info(workspaces)").all() as Array<{
            name: string
          }>
        ).map((row) => row.name),
      )
      const hasWorkspacePath = columns.has("workspace_path")
      const select = hasWorkspacePath
        ? `SELECT id, name, status, harness, error_message,
                  onboarding_status, onboarding_session_id,
                  onboarding_completed_at, onboarding_completion_summary,
                  onboarding_requested_at, onboarding_requested_by,
                  created_at, updated_at, deleted_at_utc, workspace_path
           FROM workspaces
           WHERE deleted_at_utc IS NULL
           ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
           LIMIT 100`
        : `SELECT id, name, status, harness, error_message,
                  onboarding_status, onboarding_session_id,
                  onboarding_completed_at, onboarding_completion_summary,
                  onboarding_requested_at, onboarding_requested_by,
                  created_at, updated_at, deleted_at_utc
           FROM workspaces
           WHERE deleted_at_utc IS NULL
           ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
           LIMIT 100`
      const rows = database.prepare(select).all() as Array<
        Record<string, unknown>
      >
      const items = rows.map((row) =>
        mapWorkspaceRegistryRow(row, {
          location: options.location,
          hasWorkspacePath,
        }),
      )
      return { items, total: items.length, limit: 100, offset: 0 }
    } catch {
      return empty
    } finally {
      try {
        database?.close()
      } catch {
        // ignore
      }
    }
  }

  return {
    getWorkspaceRecord,
    listCachedWorkspaces,
  }
}

export type RuntimeUserProfileNameSource = "manual" | "agent" | "authFallback"

export interface RuntimeUserProfileRecord {
  profileId: string
  name: string | null
  nameSource: RuntimeUserProfileNameSource | null
  createdAt: string | null
  updatedAt: string | null
}

export interface RuntimeUserProfileUpdate {
  profileId?: string | null
  name?: string | null
  nameSource?: RuntimeUserProfileNameSource | null
}

export interface LocalRuntimeUserProfileStore {
  getProfile(): Promise<RuntimeUserProfileRecord>
  setProfile(payload: RuntimeUserProfileUpdate): Promise<RuntimeUserProfileRecord>
  applyAuthFallback(
    name: string,
    profileId?: string,
  ): Promise<RuntimeUserProfileRecord>
}

export interface LocalRuntimeUserProfileStoreOptions {
  requestJson: <T>(pathname: string, init?: RequestInit) => Promise<T>
}

function runtimeUserProfileNameSourceFromApi(
  value: unknown,
): RuntimeUserProfileNameSource | null {
  if (value === "manual" || value === "agent") {
    return value
  }
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (!normalized) {
    return null
  }
  if (normalized === "manual" || normalized === "agent") {
    return normalized
  }
  if (normalized === "auth_fallback") {
    return "authFallback"
  }
  return null
}

function runtimeUserProfileNameSourceToApi(
  value: RuntimeUserProfileNameSource | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (value === "authFallback") {
    return "auth_fallback"
  }
  return value
}

function runtimeUserProfilePayloadFromApi(
  value: unknown,
): RuntimeUserProfileRecord {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    profileId:
      typeof record.profile_id === "string" && record.profile_id.trim()
        ? record.profile_id
        : "default",
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name
        : null,
    nameSource: runtimeUserProfileNameSourceFromApi(record.name_source),
    createdAt:
      typeof record.created_at === "string" && record.created_at.trim()
        ? record.created_at
        : null,
    updatedAt:
      typeof record.updated_at === "string" && record.updated_at.trim()
        ? record.updated_at
        : null,
  }
}

export function createLocalRuntimeUserProfileStore(
  options: LocalRuntimeUserProfileStoreOptions,
): LocalRuntimeUserProfileStore {
  return {
    async getProfile(): Promise<RuntimeUserProfileRecord> {
      const payload = await options.requestJson<unknown>("/api/v1/runtime/profile", {
        method: "GET",
      })
      return runtimeUserProfilePayloadFromApi(payload)
    },

    async setProfile(
      payload: RuntimeUserProfileUpdate,
    ): Promise<RuntimeUserProfileRecord> {
      const body: Record<string, unknown> = {}
      if (typeof payload.profileId === "string" && payload.profileId.trim()) {
        body.profile_id = payload.profileId.trim()
      }
      if (payload.name !== undefined) {
        body.name = payload.name
      }
      if (payload.nameSource !== undefined) {
        body.name_source = runtimeUserProfileNameSourceToApi(payload.nameSource)
      }
      const response = await options.requestJson<unknown>("/api/v1/runtime/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
      return runtimeUserProfilePayloadFromApi(response)
    },

    async applyAuthFallback(
      name: string,
      profileId = "default",
    ): Promise<RuntimeUserProfileRecord> {
      const response = await options.requestJson<unknown>(
        "/api/v1/runtime/profile/auth-fallback",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            profile_id: profileId,
            name,
          }),
        },
      )
      return runtimeUserProfilePayloadFromApi(response)
    },
  }
}
