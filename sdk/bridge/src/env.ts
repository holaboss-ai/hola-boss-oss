const APP_GRANT = () => process.env.HOLABOSS_APP_GRANT ?? ""
const WORKSPACE_ID = () => process.env.HOLABOSS_WORKSPACE_ID ?? ""

export function getAppGrant(): string {
  return APP_GRANT()
}

export function getWorkspaceId(): string {
  return WORKSPACE_ID()
}

export function resolveBrokerUrl(): string {
  const explicit = process.env.HOLABOSS_INTEGRATION_BROKER_URL ?? ""
  if (explicit) {
    const runtimePort =
      process.env.SANDBOX_RUNTIME_API_PORT ??
      process.env.SANDBOX_AGENT_BIND_PORT ??
      ""
    if (runtimePort) {
      try {
        const url = new URL(explicit)
        if (url.port !== runtimePort) {
          url.port = runtimePort
          return url.toString().replace(/\/$/, "")
        }
      } catch {
        // ignore malformed explicit URL
      }
    }
    return explicit
  }

  const port =
    process.env.SANDBOX_RUNTIME_API_PORT ??
    process.env.SANDBOX_AGENT_BIND_PORT ??
    process.env.PORT ??
    ""
  if (port) {
    return `http://127.0.0.1:${port}/api/v1/integrations`
  }
  return ""
}

export function resolveWorkspaceApiUrl(): string {
  const explicit = process.env.WORKSPACE_API_URL ?? ""
  if (explicit) {
    return explicit.replace(/\/$/, "")
  }
  const brokerUrl = resolveBrokerUrl()
  if (!brokerUrl) {
    return ""
  }
  return brokerUrl.replace(/\/integrations$/, "")
}

export function canPublishAppOutputs(): boolean {
  return Boolean(resolveWorkspaceApiUrl() && getWorkspaceId().trim())
}
