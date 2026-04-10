import { getAppGrant, resolveBrokerUrl } from "./env"
import type { IntegrationClient, ProxyRequest, ProxyResponse } from "./types"

/**
 * Creates a proxy client for a named provider integration.
 *
 * All API calls are routed through the Holaboss broker proxy
 * rather than calling the provider directly.
 */
export function createIntegrationClient(provider: string): IntegrationClient {
  const brokerUrl = resolveBrokerUrl()

  return {
    async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
      const grant = getAppGrant()
      if (!brokerUrl || !grant) {
        throw new Error(
          `No ${provider} integration configured. Connect via Integrations settings.`,
        )
      }

      const response = await fetch(`${brokerUrl}/broker/proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant,
          provider,
          request: {
            method: request.method,
            endpoint: request.endpoint,
            ...(request.body !== undefined ? { body: request.body } : {}),
            ...(request.headers ? { headers: request.headers } : {}),
          },
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(
          `Bridge proxy error (${response.status}): ${text.slice(0, 500)}`,
        )
      }

      return (await response.json()) as ProxyResponse<T>
    },
  }
}
