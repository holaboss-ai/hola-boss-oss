import { getWorkspaceId } from "./env"
import type { HolabossTurnContext } from "./types"

function headerValue(headers: unknown, key: string): string {
  if (!headers) {
    return ""
  }
  if (
    typeof headers === "object" &&
    headers !== null &&
    "get" in headers &&
    typeof (headers as { get: unknown }).get === "function"
  ) {
    const value = (headers as { get(key: string): unknown }).get(key)
    return typeof value === "string" ? value.trim() : ""
  }
  if (typeof headers === "object" && headers !== null) {
    const record = headers as Record<string, unknown>
    const direct = record[key]
    if (typeof direct === "string") {
      return direct.trim()
    }
    const lower = record[key.toLowerCase()]
    if (typeof lower === "string") {
      return lower.trim()
    }
  }
  return ""
}

/**
 * Extracts Holaboss turn context from MCP request headers.
 *
 * Returns `null` when the required workspace or session ID is missing,
 * which prevents artifact publishing outside agent turn execution.
 */
export function resolveHolabossTurnContext(
  headers: unknown,
): HolabossTurnContext | null {
  const workspaceId =
    headerValue(headers, "x-holaboss-workspace-id") ||
    getWorkspaceId().trim()
  const sessionId = headerValue(headers, "x-holaboss-session-id")
  const inputId = headerValue(headers, "x-holaboss-input-id")

  if (!workspaceId || !sessionId) {
    return null
  }

  return {
    workspaceId,
    sessionId,
    inputId: inputId || null,
  }
}
