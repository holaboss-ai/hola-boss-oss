import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appShellPath = path.join(__dirname, "AppShell.tsx");

test("app shell surfaces hydrated runtime startup errors for selected workspaces", async () => {
  const source = await readFile(appShellPath, "utf8");

  assert.match(source, /const hydratedRuntimeErrorMessage =/);
  assert.match(source, /runtimeStatus\?\.status === "error"/);
  assert.match(source, /!workspaceAppsReady/);
  assert.match(source, /\) : hydratedRuntimeErrorMessage \? \(/);
  assert.match(source, /<WorkspaceStartupErrorPane message=\{hydratedRuntimeErrorMessage\} \/>/);
});
