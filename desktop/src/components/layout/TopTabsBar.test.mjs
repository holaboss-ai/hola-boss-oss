import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TOP_TABS_BAR_PATH = new URL("./TopTabsBar.tsx", import.meta.url);

test("top tabs bar keeps the profile menu and gates the workspace switcher off on the control center", async () => {
  const source = await readFile(TOP_TABS_BAR_PATH, "utf8");

  assert.match(source, /const \[workspaceSwitcherOpen, setWorkspaceSwitcherOpen\] = useState\(false\);/);
  assert.match(source, /const \{ selectedWorkspaceId, setSelectedWorkspaceId } =\s*useWorkspaceSelection\(\);/);
  assert.match(source, /if \(!controlCenterActive \|\| !workspaceSwitcherOpen\) \{\s*return;\s*\}\s*closeWorkspaceSwitcher\(\);/);
  assert.match(source, /!controlCenterActive \? \(/);
  assert.match(source, /!controlCenterActive &&\s*workspaceSwitcherOpen/);
  assert.match(source, /<DropdownMenu>/);
  assert.doesNotMatch(source, /<NotificationCenter/);
  assert.doesNotMatch(source, /notificationUnreadCount/);
});

test("top tabs bar exposes a control center action alongside integrated title bar controls", async () => {
  const source = await readFile(TOP_TABS_BAR_PATH, "utf8");

  assert.match(source, /controlCenterActive\?: boolean;/);
  assert.match(source, /onOpenControlCenter\?: \(\) => void;/);
  assert.match(source, /!controlCenterActive \? \(/);
  assert.match(source, /variant="outline"\s*size="sm"/);
  assert.match(source, /onClick=\{\(\) => onOpenControlCenter\?\.\(\)\}/);
  assert.match(source, /Control Center/);
  assert.match(
    source,
    /const isWindowsIntegratedTitleBar =\s*integratedTitleBar && desktopPlatform === "win32";/,
  );
  assert.match(source, /window\.electronAPI\.ui\.getWindowState\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.minimizeWindow\(\)/);
  assert.match(source, /window\.electronAPI\.ui\.closeWindow\(\)/);
  assert.match(source, /aria-label="Minimize window"/);
  assert.match(source, /aria-label="Close window"/);
});
