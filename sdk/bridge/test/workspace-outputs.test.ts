import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import {
  createAppOutput,
  publishSessionArtifact,
  updateAppOutput,
} from "../src/workspace-outputs"

const originalEnv = { ...process.env }

const MOCK_OUTPUT = {
  id: "out-1",
  workspace_id: "ws-1",
  output_type: "post",
  title: "Test Post",
  status: "draft",
  module_id: "twitter",
  module_resource_id: "post-123",
  file_path: null,
  html_content: null,
  session_id: null,
  artifact_id: null,
  folder_id: null,
  platform: "twitter",
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    process.env[k] = v
  }
}

function clearEnv() {
  for (const key of [
    "HOLABOSS_APP_GRANT",
    "HOLABOSS_WORKSPACE_ID",
    "HOLABOSS_INTEGRATION_BROKER_URL",
    "WORKSPACE_API_URL",
    "SANDBOX_RUNTIME_API_PORT",
    "SANDBOX_AGENT_BIND_PORT",
    "PORT",
  ]) {
    delete process.env[key]
  }
}

function setupPublishingEnv() {
  setEnv({
    HOLABOSS_WORKSPACE_ID: "ws-1",
    WORKSPACE_API_URL: "http://127.0.0.1:8080/api/v1",
  })
}

describe("createAppOutput", () => {
  beforeEach(() => {
    clearEnv()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    mock.restore()
  })

  test("returns null when publishing is not available", async () => {
    const result = await createAppOutput({
      outputType: "post",
      title: "Test",
      moduleId: "twitter",
    })
    expect(result).toBeNull()
  })

  test("creates output with correct request", async () => {
    setupPublishingEnv()

    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ output: MOCK_OUTPUT }), { status: 200 }),
      ),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const result = await createAppOutput({
      outputType: "post",
      title: "Test Post",
      moduleId: "twitter",
      moduleResourceId: "post-123",
      platform: "twitter",
    })

    expect(result).toEqual(MOCK_OUTPUT)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:8080/api/v1/outputs")
    expect(init.method).toBe("POST")

    const body = JSON.parse(init.body as string)
    expect(body.workspace_id).toBe("ws-1")
    expect(body.output_type).toBe("post")
    expect(body.module_id).toBe("twitter")
  })

  test("auto-updates status when non-draft status requested", async () => {
    setupPublishingEnv()

    const updatedOutput = { ...MOCK_OUTPUT, status: "published" }
    let callCount = 0
    const fetchMock = mock(() => {
      callCount++
      const output = callCount === 1 ? MOCK_OUTPUT : updatedOutput
      return Promise.resolve(
        new Response(JSON.stringify({ output }), { status: 200 }),
      )
    })
    globalThis.fetch = fetchMock as typeof fetch

    const result = await createAppOutput({
      outputType: "post",
      title: "Test Post",
      moduleId: "twitter",
      status: "published",
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result?.status).toBe("published")
  })

  test("throws on non-OK response", async () => {
    setupPublishingEnv()

    const fetchMock = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    )
    globalThis.fetch = fetchMock as typeof fetch

    await expect(
      createAppOutput({
        outputType: "post",
        title: "Test",
        moduleId: "twitter",
      }),
    ).rejects.toThrow("Workspace output create failed (500)")
  })
})

describe("updateAppOutput", () => {
  beforeEach(() => {
    clearEnv()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    mock.restore()
  })

  test("returns null when publishing is not available", async () => {
    const result = await updateAppOutput("out-1", { status: "published" })
    expect(result).toBeNull()
  })

  test("sends PATCH with correct fields", async () => {
    setupPublishingEnv()

    const updated = { ...MOCK_OUTPUT, status: "published" }
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ output: updated }), { status: 200 }),
      ),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const result = await updateAppOutput("out-1", {
      status: "published",
      metadata: { key: "val" },
    })

    expect(result?.status).toBe("published")

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:8080/api/v1/outputs/out-1")
    expect(init.method).toBe("PATCH")

    const body = JSON.parse(init.body as string)
    expect(body.status).toBe("published")
    expect(body.metadata).toEqual({ key: "val" })
    expect(body.title).toBeUndefined()
  })
})

describe("publishSessionArtifact", () => {
  beforeEach(() => {
    clearEnv()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    mock.restore()
  })

  test("publishes a session-bound app artifact with routing metadata", async () => {
    setupPublishingEnv()

    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            artifact: {
              id: "artifact-1",
              output_id: "out-1",
              session_id: "session-1",
              workspace_id: "ws-1",
              input_id: "input-1",
              artifact_type: "draft",
              external_id: "post-123",
              platform: "twitter",
              title: "Test Post",
              metadata: {
                presentation: {
                  kind: "app_resource",
                  view: "posts",
                  path: "/posts/post-123",
                },
              },
              created_at: "2026-01-01T00:00:00Z",
            },
          }),
          { status: 200 },
        ),
      ),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const result = await publishSessionArtifact(
      {
        workspaceId: "ws-1",
        sessionId: "session-1",
        inputId: "input-1",
      },
      {
        artifactType: "draft",
        externalId: "post-123",
        title: "Test Post",
        moduleId: "twitter",
        moduleResourceId: "post-123",
        platform: "twitter",
        metadata: {
          presentation: {
            kind: "app_resource",
            view: "posts",
            path: "/posts/post-123",
          },
        },
      },
    )

    expect(result?.output_id).toBe("out-1")
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:8080/api/v1/agent-sessions/session-1/artifacts")
    expect(init.method).toBe("POST")

    const body = JSON.parse(init.body as string)
    expect(body.workspace_id).toBe("ws-1")
    expect(body.input_id).toBe("input-1")
    expect(body.module_id).toBe("twitter")
    expect(body.module_resource_id).toBe("post-123")
  })
})
