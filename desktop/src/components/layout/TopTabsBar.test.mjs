import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TOP_TABS_BAR_PATH = new URL("./TopTabsBar.tsx", import.meta.url);

test("top tabs bar renders the notification center before the profile menu", async () => {
  const source = await readFile(TOP_TABS_BAR_PATH, "utf8");

  const notificationIndex = source.indexOf("<NotificationCenter");
  const profileMenuIndex = source.indexOf("<DropdownMenu>");

  assert.notEqual(notificationIndex, -1);
  assert.notEqual(profileMenuIndex, -1);
  assert.ok(notificationIndex < profileMenuIndex);
  assert.match(source, /notificationUnreadCount = 0/);
});

test("top tabs bar renders custom compact window controls for Windows title bar integration", async () => {
  const source = await readFile(TOP_TABS_BAR_PATH, "utf8");

  assert.match(source, /desktopPlatform\?: string \| null;/);
  assert.match(
    source,
    /const isWindowsIntegratedTitleBar =\s*integratedTitleBar && desktopPlatform === "win32";/,
  );
  assert.match(
    source,
    /px-2 pt-1\.5 sm:px-3/,
  );
  assert.match(
    source,
    /grid-cols-\[44px_minmax\(0,1fr\)_auto\][\s\S]*lg:grid-cols-\[60px_minmax\(276px,476px\)_minmax\(0,1fr\)_auto\]/,
  );
  assert.match(
    source,
    /const workspaceSwitcherContainerClassName = `\$\{integratedTitleBar \? "window-no-drag " : ""\}relative min-w-55 max-w-full`;/,
  );
  assert.match(
    source,
    /const workspaceSwitcherButtonClassName =\s*"w-full justify-start gap-2\.5 px-3";/,
  );
  assert.match(source, /window\.electronAPI\.ui\.getWindowState\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.minimizeWindow\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.closeWindow\(\)/);
  assert.match(source, /aria-label="Minimize window"/);
  assert.match(source, /aria-label="Close window"/);
});
