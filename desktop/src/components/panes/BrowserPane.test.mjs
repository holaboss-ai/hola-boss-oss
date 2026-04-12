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

test("browser pane preserves explicit URL schemes and supports localhost-style input", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.equal(
    source.includes('const EXPLICIT_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\\d+\\-.]*:/;'),
    true,
  );
  assert.equal(
    source.includes("if (EXPLICIT_SCHEME_PATTERN.test(trimmed)) {\n    return trimmed;\n  }"),
    true,
  );
  assert.equal(
    source.includes('const LOCALHOST_PATTERN = /^localhost(?::\\d+)?(?:[/?#]|$)/i;'),
    true,
  );
  assert.equal(
    source.includes('const IPV4_HOST_PATTERN = /^(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d+)?(?:[/?#]|$)/;'),
    true,
  );
  assert.equal(
    source.includes('const IPV6_HOST_PATTERN = /^\\[[0-9a-fA-F:]+\\](?::\\d+)?(?:[/?#]|$)/;'),
    true,
  );
  assert.equal(source.includes("return `http://${trimmed}`;"), true);
});

test("browser pane selects the full address when the navigation field is clicked", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const selectAddressInput = \(\) => \{\s*addressInputRef\.current\?\.focus\(\);\s*addressInputRef\.current\?\.select\(\);\s*\};/);
  assert.match(
    source,
    /ref=\{addressFieldRef\}[\s\S]*onClick=\{\(event\) => \{[\s\S]*event\.target instanceof HTMLElement[\s\S]*event\.target\.closest\("button"\)[\s\S]*selectAddressInput\(\);[\s\S]*\}\}/,
  );
  assert.match(source, /onFocus=\{\(event\) => \{\s*event\.currentTarget\.select\(\);/);
  assert.match(source, /onClick=\{\(event\) => event\.currentTarget\.select\(\)\}/);
});

test("browser pane keeps loading state in the address bar and turns refresh into stop", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const isActiveTabBusy = activeTab\.loading \|\| !activeTab\.initialized;/);
  assert.match(source, /aria-label=\{activeTab\.loading \? "Stop loading" : "Refresh"\}/);
  assert.match(source, /title=\{activeTab\.loading \? "Stop loading" : "Refresh"\}/);
  assert.match(
    source,
    /activeTab\.loading\s*\?\s*window\.electronAPI\.browser\.stopLoading\(\)\s*:\s*window\.electronAPI\.browser\.reload\(\)/,
  );
  assert.match(
    source,
    /\{activeTab\.loading \? \(\s*<X size=\{13\} \/>\s*\) : \(\s*<RefreshCcw size=\{13\} \/>\s*\)\}/,
  );
  assert.match(
    source,
    /\{isActiveTabBusy \? \(\s*<Loader2[\s\S]*className="shrink-0 animate-spin text-primary\/85"[\s\S]*\/>\s*\) : \(\s*<Globe size=\{12\} className="shrink-0 text-primary\/85" \/>\s*\)\}/,
  );
  assert.doesNotMatch(source, /tab\.loading \? \(\s*<Loader2 size=\{11\} className="shrink-0 animate-spin" \/>\s*\) : null/);
  assert.doesNotMatch(source, /activeTab\.initialized && activeTab\.loading/);
});
