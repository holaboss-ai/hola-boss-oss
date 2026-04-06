import { describe, test, expect } from "bun:test"
import { buildAppResourcePresentation } from "../src/presentation"

describe("buildAppResourcePresentation", () => {
  test("returns app_resource kind with view and path", () => {
    const result = buildAppResourcePresentation({
      view: "detail",
      path: "/posts/123",
    })
    expect(result).toEqual({
      kind: "app_resource",
      view: "detail",
      path: "/posts/123",
    })
  })

  test("normalizes path to start with /", () => {
    const result = buildAppResourcePresentation({
      view: "list",
      path: "posts",
    })
    expect(result.path).toBe("/posts")
  })

  test("does not double-prefix paths already starting with /", () => {
    const result = buildAppResourcePresentation({
      view: "editor",
      path: "/drafts/456",
    })
    expect(result.path).toBe("/drafts/456")
  })
})
