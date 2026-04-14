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
  assert.match(source, /onOpenSpace\?: \(\) => void;/);
  assert.match(source, /isSpaceActive\?: boolean;/);
  assert.match(source, /onOpenAutomations\?: \(\) => void;/);
  assert.match(source, /isAutomationsActive\?: boolean;/);
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
    /const workspaceSwitcherButtonClassName =\s*"h-7 w-full justify-start gap-1\.5 px-2 rounded-lg text-xs";/,
  );
  assert.match(
    source,
    /const windowControlButtonClassName =\s*"window-no-drag flex h-5 w-5 items-center justify-center rounded-\[7px\]/,
  );
  assert.match(source, /className="size-7 shrink-0 rounded-\[9px\] border border-border overflow-hidden"/);
  assert.match(source, /<FolderKanban size=\{13\} className="shrink-0 text-primary" \/>/);
  assert.match(source, /<ChevronDown\s+size=\{12\}/);
  assert.match(source, /size="sm"\s+aria-label="Space"/);
  assert.match(source, /<MessageSquareText size=\{12\} \/>/);
  assert.match(source, /size="sm"\s+aria-label="Automations"/);
  assert.match(source, /<Workflow size=\{12\} \/>/);
  assert.match(source, /size="sm"\s+aria-label="Marketplace"/);
  assert.match(source, /className="h-7 gap-1\.5 px-2 rounded-lg text-xs"/);
  assert.match(source, /<LayoutGrid size=\{12\} \/>/);
  assert.match(source, /render=\{<Button variant="outline" size="icon-sm" className="relative rounded-lg" \/>\}/);
  assert.match(source, /window\.electronAPI\.ui\.getWindowState\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.minimizeWindow\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.closeWindow\(\)/);
  assert.match(source, /aria-label="Minimize window"/);
  assert.match(source, /aria-label="Close window"/);
});
