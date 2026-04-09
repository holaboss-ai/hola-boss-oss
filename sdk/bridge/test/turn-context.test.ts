import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { resolveHolabossTurnContext } from "../src/turn-context"

const originalEnv = { ...process.env }

function clearEnv() {
  delete process.env.HOLABOSS_WORKSPACE_ID
}

describe("resolveHolabossTurnContext", () => {
  beforeEach(() => {
    clearEnv()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test("returns null when headers are null", () => {
    expect(resolveHolabossTurnContext(null)).toBeNull()
  })

  test("returns null when headers are empty", () => {
    expect(resolveHolabossTurnContext({})).toBeNull()
  })

  test("returns null when session ID is missing", () => {
    expect(
      resolveHolabossTurnContext({ "x-holaboss-workspace-id": "ws-1" }),
    ).toBeNull()
  })

  test("extracts context from plain object headers", () => {
    const ctx = resolveHolabossTurnContext({
      "x-holaboss-workspace-id": "ws-1",
      "x-holaboss-session-id": "sess-1",
      "x-holaboss-input-id": "inp-1",
    })

    expect(ctx).toEqual({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      inputId: "inp-1",
    })
  })

  test("falls back to env workspace ID when header is missing", () => {
    process.env.HOLABOSS_WORKSPACE_ID = "env-ws"

    const ctx = resolveHolabossTurnContext({
      "x-holaboss-session-id": "sess-1",
    })

    expect(ctx).toEqual({
      workspaceId: "env-ws",
      sessionId: "sess-1",
      inputId: null,
    })
  })

  test("extracts context from Headers-like object", () => {
    const headers = new Headers({
      "X-Holaboss-Workspace-Id": "ws-1",
      "X-Holaboss-Session-Id": "sess-1",
      "X-Holaboss-Input-Id": "inp-1",
    })

    const ctx = resolveHolabossTurnContext(headers)

    expect(ctx).toEqual({
      workspaceId: "ws-1",
      sessionId: "sess-1",
      inputId: "inp-1",
    })
  })

  test("sets inputId to null when input header is absent", () => {
    const ctx = resolveHolabossTurnContext({
      "x-holaboss-workspace-id": "ws-1",
      "x-holaboss-session-id": "sess-1",
    })

    expect(ctx?.inputId).toBeNull()
  })
})
