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
  const rightControlsIndex = source.indexOf(
    "flex min-w-0 items-center justify-self-end gap-1.5",
  );
  const workspaceSwitcherIndex = source.indexOf(
    "ref={workspaceSwitcherRef}",
    rightControlsIndex,
  );
  const runtimeStatusIndex = source.indexOf(
    "<RuntimeStatusIndicator status={runtimeStatus} />",
    rightControlsIndex,
  );

  assert.match(source, /desktopPlatform\?: string \| null;/);
  assert.match(
    source,
    /const isWindowsIntegratedTitleBar =\s*integratedTitleBar && desktopPlatform === "win32";/,
  );
  assert.match(
    source,
    /h-\[32px\] px-2 pt-0\.5 sm:px-3/,
  );
  assert.match(
    source,
    /lg:grid-cols-\[minmax\(0,1fr\)_auto\]/,
  );
  assert.match(
    source,
    /const workspaceSwitcherContainerClassName = `\$\{integratedTitleBar \? "window-no-drag " : ""\}relative w-\[190px\] shrink-0`;/,
  );
  assert.match(
    source,
    /const workspaceSwitcherButtonClassName =\s*"h-6 w-full justify-start gap-1 rounded-md px-1\.5 text-\[11px\]";/,
  );
  assert.match(source, /variant=\{workspaceSwitcherOpen \? "secondary" : "bordered"\}\s*size="xs"/);
  assert.ok(rightControlsIndex >= 0);
  assert.ok(workspaceSwitcherIndex > rightControlsIndex);
  assert.ok(runtimeStatusIndex > workspaceSwitcherIndex);
  assert.match(
    source,
    /const windowControlButtonClassName =\s*"window-no-drag flex h-5 w-5 items-center justify-center rounded-\[7px\]/,
  );
  assert.match(source, /<FolderKanban className="size-3 shrink-0 text-primary" \/>/);
  assert.match(source, /<ChevronDown[\s\S]*className=\{`ml-auto size-3 shrink-0 text-muted-foreground transition-transform/);
  assert.doesNotMatch(source, /onOpenSpace\?: \(\) => void;/);
  assert.doesNotMatch(source, /isSpaceActive\?: boolean;/);
  assert.doesNotMatch(source, /aria-label="Space"/);
  assert.doesNotMatch(source, /MessageSquareText/);
  assert.doesNotMatch(source, /aria-label="Automations"/);
  assert.doesNotMatch(source, /onOpenAutomations\?: \(\) => void;/);
  assert.doesNotMatch(source, /isAutomationsActive\?: boolean;/);
  assert.doesNotMatch(source, /Workflow/);
  assert.doesNotMatch(source, /aria-label="Marketplace"/);
  assert.doesNotMatch(source, /onOpenMarketplace\?: \(\) => void;/);
  assert.doesNotMatch(source, /isMarketplaceActive\?: boolean;/);
  assert.doesNotMatch(source, /LayoutGrid/);
  assert.match(
    source,
    /render=\{\s*<Button\s+variant="bordered"\s+size="icon-xs"\s+aria-label="Open account menu"/,
  );
  assert.doesNotMatch(source, /absolute -right-0\.5 -top-0\.5 size-2 rounded-full ring-2 ring-background/);
  assert.match(source, /window\.electronAPI\.ui\.getWindowState\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.minimizeWindow\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.closeWindow\(\)/);
  assert.match(source, /aria-label="Minimize window"/);
  assert.match(source, /aria-label="Close window"/);
});
