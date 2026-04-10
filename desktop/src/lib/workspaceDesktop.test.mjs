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

test("workspace desktop error normalization unwraps Electron IPC errors before mapping", async () => {
  const source = await readFile(WORKSPACE_DESKTOP_PATH, "utf8");

  assert.match(
    source,
    /const ipcMatch = message\.match\(\s*\/\^Error invoking remote method '\[\^'\]\+': Error: \(\.\+\)\$\/s,/,
  );
  assert.match(
    source,
    /const unwrappedMessage = ipcMatch \? ipcMatch\[1\]\.trim\(\) : message\.trim\(\);/,
  );
  assert.match(source, /const normalized = unwrappedMessage\.toLowerCase\(\);/);
  assert.match(
    source,
    /if \(rawNormalized\.includes\("error invoking remote method"\) && !ipcMatch\) \{/,
  );
  assert.match(source, /return unwrappedMessage;/);
});
