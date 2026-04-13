import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TOP_TABS_BAR_PATH = new URL("./TopTabsBar.tsx", import.meta.url);

test("top tabs bar removes the notification center and keeps the profile menu", async () => {
  const source = await readFile(TOP_TABS_BAR_PATH, "utf8");

  const profileMenuIndex = source.indexOf("<DropdownMenu>");

  assert.notEqual(profileMenuIndex, -1);
  assert.doesNotMatch(source, /<NotificationCenter/);
  assert.doesNotMatch(source, /notificationUnreadCount/);
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
    /h-\[42px\] px-2 pt-0\.5 sm:px-3/,
  );
  assert.match(
    source,
    /grid-cols-\[32px_minmax\(0,1fr\)_auto\][\s\S]*lg:grid-cols-\[42px_minmax\(220px,400px\)_minmax\(0,1fr\)_auto\]/,
  );
  assert.match(
    source,
    /const workspaceSwitcherContainerClassName = `\$\{integratedTitleBar \? "window-no-drag " : ""\}relative min-w-55 max-w-full`;/,
  );
  assert.match(
    source,
    /const workspaceSwitcherButtonClassName =\s*"h-8 w-full justify-start gap-2 px-2\.5 rounded-lg text-\[13px\]";/,
  );
  assert.match(
    source,
    /const windowControlButtonClassName =\s*"window-no-drag flex h-6 w-6 items-center justify-center rounded-\[8px\]/,
  );
  assert.match(source, /className="size-8 shrink-0 rounded-\[10px\] border border-border overflow-hidden"/);
  assert.match(source, /<FolderKanban size=\{14\} className="shrink-0 text-primary" \/>/);
  assert.match(source, /<ChevronDown\s+size=\{13\}/);
  assert.match(source, /size="default"\s+aria-label="Marketplace"/);
  assert.match(source, /className="gap-2 rounded-lg text-\[13px\]"/);
  assert.match(source, /<LayoutGrid size=\{13\} \/>/);
  assert.match(source, /render=\{<Button variant="outline" size="icon" className="relative rounded-lg" \/>\}/);
  assert.match(source, /window\.electronAPI\.ui\.getWindowState\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.minimizeWindow\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.closeWindow\(\)/);
  assert.match(source, /aria-label="Minimize window"/);
  assert.match(source, /aria-label="Close window"/);
});
