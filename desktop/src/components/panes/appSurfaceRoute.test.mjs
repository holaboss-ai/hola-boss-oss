import test from "node:test";
import assert from "node:assert/strict";

async function loadRouteModule() {
  try {
    return await import("./appSurfaceRoute.ts");
  } catch {
    return null;
  }
}

test("app surface route helper exists", async () => {
  const routeModule = await loadRouteModule();

  assert.equal(
    typeof routeModule?.resolveAppSurfacePath,
    "function",
    "expected app surface routing to be extracted into a reusable helper",
  );
});

test("app surface route helper resolves the home page to the root path", async () => {
  const routeModule = await loadRouteModule();
  assert.equal(
    routeModule?.resolveAppSurfacePath({ view: "home", resourceId: null }),
    "/",
  );
});

test("app surface route helper resolves view-only pages without a resource id", async () => {
  const routeModule = await loadRouteModule();
  assert.equal(
    routeModule?.resolveAppSurfacePath({ view: "preview", resourceId: null }),
    "/preview",
  );
});

test("app surface route helper preserves focused app views when a resource id is present", async () => {
  const routeModule = await loadRouteModule();
  assert.equal(
    routeModule?.resolveAppSurfacePath({ view: "editor", resourceId: "draft-42" }),
    "/editor/draft-42",
  );
  assert.equal(
    routeModule?.resolveAppSurfacePath({ view: "thread", resourceId: "thread-9" }),
    "/thread/thread-9",
  );
});

test("app surface route helper falls back to legacy posts routes when no explicit view is provided", async () => {
  const routeModule = await loadRouteModule();
  assert.equal(
    routeModule?.resolveAppSurfacePath({ view: null, resourceId: "artifact-7" }),
    "/posts/artifact-7",
  );
});
