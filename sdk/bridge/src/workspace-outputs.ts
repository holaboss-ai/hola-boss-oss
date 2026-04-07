import {
  canPublishAppOutputs,
  getWorkspaceId,
  resolveWorkspaceApiUrl,
} from "./env"
import type {
  CreateAppOutputRequest,
  HolabossTurnContext,
  PublishSessionArtifactRequest,
  SessionArtifactPayload,
  UpdateAppOutputRequest,
  WorkspaceOutputPayload,
} from "./types"

interface WorkspaceOutputResponsePayload {
  output: WorkspaceOutputPayload
}

interface SessionArtifactResponsePayload {
  artifact: SessionArtifactPayload
}

/**
 * Creates a workspace output record if the app is running inside
 * a Holaboss workspace.
 *
 * Returns `null` when output publishing is not available (e.g. during
 * local development without a workspace context).
 */
export async function createAppOutput(
  request: CreateAppOutputRequest,
): Promise<WorkspaceOutputPayload | null> {
  if (!canPublishAppOutputs()) {
    return null
  }

  const workspaceId = getWorkspaceId()
  const response = await fetch(`${resolveWorkspaceApiUrl()}/outputs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-holaboss-workspace-id": workspaceId,
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      output_type: request.outputType,
      title: request.title,
      module_id: request.moduleId,
      module_resource_id: request.moduleResourceId ?? null,
      platform: request.platform ?? null,
      metadata: request.metadata ?? {},
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Workspace output create failed (${response.status}): ${text.slice(0, 500)}`,
    )
  }

  const created = (
    (await response.json()) as WorkspaceOutputResponsePayload
  ).output

  if (
    request.status &&
    request.status.trim() &&
    request.status.trim().toLowerCase() !== "draft"
  ) {
    return updateAppOutput(created.id, {
      title: request.title,
      status: request.status,
      moduleResourceId: request.moduleResourceId ?? null,
      metadata: request.metadata ?? {},
    })
  }

  return created
}

/**
 * Updates an existing workspace output record.
 *
 * Returns `null` when output publishing is not available.
 */
export async function updateAppOutput(
  outputId: string,
  request: UpdateAppOutputRequest,
): Promise<WorkspaceOutputPayload | null> {
  if (!canPublishAppOutputs()) {
    return null
  }

  const workspaceId = getWorkspaceId()
  const response = await fetch(
    `${resolveWorkspaceApiUrl()}/outputs/${encodeURIComponent(outputId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-holaboss-workspace-id": workspaceId,
      },
      body: JSON.stringify({
        ...(request.title !== undefined ? { title: request.title } : {}),
        ...(request.status !== undefined ? { status: request.status } : {}),
        ...(request.moduleResourceId !== undefined
          ? { module_resource_id: request.moduleResourceId }
          : {}),
        ...(request.metadata !== undefined
          ? { metadata: request.metadata }
          : {}),
      }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Workspace output update failed (${response.status}): ${text.slice(0, 500)}`,
    )
  }

  return ((await response.json()) as WorkspaceOutputResponsePayload).output
}

/**
 * Publishes an app-origin artifact scoped to the active assistant turn.
 *
 * Returns `null` when output publishing is not available.
 */
export async function publishSessionArtifact(
  context: HolabossTurnContext,
  request: PublishSessionArtifactRequest,
): Promise<SessionArtifactPayload | null> {
  if (!canPublishAppOutputs()) {
    return null
  }

  const response = await fetch(
    `${resolveWorkspaceApiUrl()}/agent-sessions/${encodeURIComponent(context.sessionId)}/artifacts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-holaboss-workspace-id": context.workspaceId,
      },
      body: JSON.stringify({
        workspace_id: context.workspaceId,
        input_id: request.inputId ?? context.inputId ?? null,
        artifact_type: request.artifactType,
        external_id: request.externalId,
        title: request.title,
        platform: request.platform ?? null,
        module_id: request.moduleId,
        module_resource_id: request.moduleResourceId ?? null,
        metadata: request.metadata ?? {},
        artifact_id: request.artifactId ?? null,
        change_type: request.changeType ?? null,
      }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Session artifact publish failed (${response.status}): ${text.slice(0, 500)}`,
    )
  }

  return ((await response.json()) as SessionArtifactResponsePayload).artifact
}
