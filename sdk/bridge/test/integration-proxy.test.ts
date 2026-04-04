import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { createIntegrationClient } from "../src/integration-proxy"

const originalEnv = { ...process.env }

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    process.env[k] = v
  }
}

function clearEnv() {
  for (const key of [
    "HOLABOSS_APP_GRANT",
    "HOLABOSS_INTEGRATION_BROKER_URL",
    "SANDBOX_RUNTIME_API_PORT",
    "SANDBOX_AGENT_BIND_PORT",
    "PORT",
  ]) {
    delete process.env[key]
  }
}

describe("createIntegrationClient", () => {
  beforeEach(() => {
    clearEnv()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    mock.restore()
  })

  test("throws when no broker URL or grant is configured", async () => {
    const client = createIntegrationClient("twitter")
    await expect(
      client.proxy({ method: "GET", endpoint: "/tweets" }),
    ).rejects.toThrow("No twitter integration configured")
  })

  test("sends correct proxy request to broker", async () => {
    setEnv({
      HOLABOSS_APP_GRANT: "test-grant",
      HOLABOSS_INTEGRATION_BROKER_URL: "http://127.0.0.1:8080/api/v1/integrations",
    })

    const mockResponse = { data: { id: "123" }, status: 200, headers: {} }
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 })),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const client = createIntegrationClient("twitter")
    const result = await client.proxy({
      method: "POST",
      endpoint: "/tweets",
      body: { text: "hello" },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:8080/api/v1/integrations/broker/proxy")
    expect(init.method).toBe("POST")

    const body = JSON.parse(init.body as string)
    expect(body.grant).toBe("test-grant")
    expect(body.provider).toBe("twitter")
    expect(body.request.method).toBe("POST")
    expect(body.request.endpoint).toBe("/tweets")
    expect(body.request.body).toEqual({ text: "hello" })

    expect(result.data).toEqual({ id: "123" })
  })

  test("throws on non-OK response", async () => {
    setEnv({
      HOLABOSS_APP_GRANT: "test-grant",
      HOLABOSS_INTEGRATION_BROKER_URL: "http://127.0.0.1:8080/api/v1/integrations",
    })

    const fetchMock = mock(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const client = createIntegrationClient("twitter")
    await expect(
      client.proxy({ method: "GET", endpoint: "/tweets" }),
    ).rejects.toThrow("Bridge proxy error (401)")
  })

  test("resolves broker URL from PORT fallback", async () => {
    setEnv({
      HOLABOSS_APP_GRANT: "test-grant",
      PORT: "3099",
    })

    const mockResponse = { data: null, status: 200, headers: {} }
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 })),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const client = createIntegrationClient("linkedin")
    await client.proxy({ method: "GET", endpoint: "/posts" })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:3099/api/v1/integrations/broker/proxy")
  })
})
