import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const APP_SURFACE_PANE_PATH = new URL("./AppSurfacePane.tsx", import.meta.url);

test("app surface pane renders first-party apps in a renderer iframe", async () => {
  const source = await readFile(APP_SURFACE_PANE_PATH, "utf8");

  assert.match(
    source,
    /<iframe\b/,
    "expected AppSurfacePane to render an iframe for first-party app websites",
  );
});

test("app surface pane no longer syncs native bounds for a BrowserView overlay", async () => {
  const source = await readFile(APP_SURFACE_PANE_PATH, "utf8");

  assert.doesNotMatch(
    source,
    /appSurface\.setBounds/,
    "expected AppSurfacePane to stop syncing native BrowserView bounds",
  );
});

test("app surface pane resolves a URL instead of navigating a native app surface view", async () => {
  const source = await readFile(APP_SURFACE_PANE_PATH, "utf8");

  assert.match(
    source,
    /appSurface\.resolveUrl/,
    "expected AppSurfacePane to resolve an app surface URL for iframe rendering",
  );
});

test("app surface pane preserves explicit app routes when present", async () => {
  const source = await readFile(APP_SURFACE_PANE_PATH, "utf8");

  assert.match(
    source,
    /resolveAppSurfacePath\(\{ path, resourceId, view \}\)/,
    "expected AppSurfacePane to pass explicit app paths through to route resolution",
  );
});
