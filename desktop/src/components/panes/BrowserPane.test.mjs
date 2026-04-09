import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "BrowserPane.tsx");

test("browser pane no longer exposes a dedicated close action in the chrome controls", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /export function BrowserPane\(\{\s*suspendNativeView = false,\s*layoutSyncKey = "",\s*}: \{\s*suspendNativeView\?: boolean;\s*layoutSyncKey\?: string;\s*}\)/,
  );
  assert.doesNotMatch(source, /label="Close browser pane"/);
});

test("browser pane exposes a single inline browser-space switcher", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const alternateBrowserSpace =\s*visibleBrowserSpace === "user" \? "agent" : "user";/);
  assert.match(source, /const visibleBrowserSpace = browserState\.space \|\| DEFAULT_BROWSER_SPACE;/);
  assert.match(source, /const VisibleBrowserIcon = visibleBrowserSpace === "user" \? Globe : Bot;/);
  assert.match(source, /Switch to \$\{alternateBrowserLabel\} browser/);
  assert.match(source, /window\.electronAPI\.browser\.setActiveWorkspace\(selectedWorkspaceId, space\)/);
  assert.match(source, /activeDownloadCount > 0/);
  assert.doesNotMatch(source, /visibleBrowserCount/);
  assert.doesNotMatch(source, /aria-label="Downloads"/);
});
