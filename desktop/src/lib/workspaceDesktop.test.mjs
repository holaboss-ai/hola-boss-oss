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

test("workspace desktop rechecks runtime status while bootstrap is waiting for startup", async () => {
  const source = await readFile(WORKSPACE_DESKTOP_PATH, "utf8");

  assert.match(source, /const BOOTSTRAP_IPC_TIMEOUT_MS = 8_000;/);
  assert.match(
    source,
    /function withBootstrapTimeout<T>\(promise: Promise<T>, label: string\): Promise<T> \{/,
  );
  assert.match(
    source,
    /reject\(new Error\(`Timed out loading \$\{label\}\.`\)\);/,
  );
  assert.match(
    source,
    /const \[runtimeConfigResult, runtimeStatusResult, clientConfigResult\] = await Promise\.allSettled\(\[\s*withBootstrapTimeout\(window\.electronAPI\.runtime\.getConfig\(\), "runtime configuration"\),\s*withBootstrapTimeout\(window\.electronAPI\.runtime\.getStatus\(\), "runtime status"\),\s*withBootstrapTimeout\(window\.electronAPI\.workspace\.getClientConfig\(\), "desktop client configuration"\)\s*\]\);/,
  );
  assert.match(
    source,
    /if \(bootstrapErrors\.length > 0\) \{\s*setWorkspaceErrorMessage\(bootstrapErrors\[0\]\);\s*\}/,
  );
  assert.match(
    source,
    /const unsubscribe = window\.electronAPI\.runtime\.onStateChange\(\(status\) => \{/,
  );
  assert.match(
    source,
    /void window\.electronAPI\.runtime\.getStatus\(\)\.then\(\(status\) => \{/,
  );
  assert.match(
    source,
    /if \(\s*hasHydratedWorkspaceList \|\|\s*isLoadingBootstrap \|\|\s*runtimeStatus\?\.status !== "starting"\s*\) \{\s*return;\s*\}/,
  );
  assert.match(
    source,
    /const refreshStartingRuntimeStatus = \(\) => \{\s*void window\.electronAPI\.runtime[\s\S]*?\.getStatus\(\)[\s\S]*?setRuntimeStatus\(status\);[\s\S]*?\}\s*;\s*\}/,
  );
  assert.match(
    source,
    /const timer = window\.setInterval\(refreshStartingRuntimeStatus, 1000\);/,
  );
  assert.match(source, /window\.clearInterval\(timer\);/);
});

test("workspace creation can copy an existing workspace browser profile or import from a browser", async () => {
  const source = await readFile(WORKSPACE_DESKTOP_PATH, "utf8");

  assert.match(source, /type WorkspaceBrowserBootstrapMode = "fresh" \| "copy_workspace" \| "import_browser";/);
  assert.match(source, /const \[browserImportSource, setBrowserImportSourceState\] =\s*useState<BrowserImportSource>\("chrome"\);/);
  assert.match(source, /if \(browserBootstrapMode === "copy_workspace"\) \{/);
  assert.match(source, /workspace\.copyBrowserWorkspaceProfile\(\{/);
  assert.match(source, /else if \(browserBootstrapMode === "import_browser"\) \{/);
  assert.match(source, /workspace\.importBrowserProfile\(\{/);
  assert.match(source, /profileDir:\s*browserImportSource === "safari"\s*\?\s*undefined\s*:\s*\(browserImportProfileDir\.trim\(\) \|\| undefined\),/);
  assert.match(source, /setWorkspaceCreatePhase\("copying_browser_profile"\);/);
  assert.match(source, /setWorkspaceCreatePhase\("importing_browser_profile"\);/);
});
