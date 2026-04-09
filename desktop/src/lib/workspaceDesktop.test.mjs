import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKSPACE_DESKTOP_PATH = new URL("./workspaceDesktop.tsx", import.meta.url);

test("deleting the selected workspace clears selection before the local delete runs", async () => {
  const source = await readFile(WORKSPACE_DESKTOP_PATH, "utf8");

  assert.match(source, /if \(selectedWorkspaceId === trimmedWorkspaceId\) \{/);
  assert.match(
    source,
    /const fallbackWorkspaceId =\s*workspaces\.find\(\(workspace\) => workspace\.id !== trimmedWorkspaceId\)\?\.id \?\?\s*"";/,
  );
  assert.match(source, /setSelectedWorkspaceId\(fallbackWorkspaceId\);/);
  assert.match(source, /setWorkspaceLifecycleWorkspaceId\(""\);/);
  assert.match(source, /setWorkspaceAppsReadyState\(false\);/);
  assert.match(source, /setWorkspaceBlockingReasonState\(""\);/);
  assert.match(source, /await window\.electronAPI\.workspace\.deleteWorkspace\(trimmedWorkspaceId\);/);
});
