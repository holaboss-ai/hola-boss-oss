import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SETTINGS_DIALOG_PATH = new URL("./SettingsDialog.tsx", import.meta.url);

test("settings dialog includes an automations section with a workspace selector", async () => {
  const source = await readFile(SETTINGS_DIALOG_PATH, "utf8");

  assert.match(source, /appVersion: string;/);
  assert.match(source, /import \{ AutomationsPane \} from "@\/components\/panes\/AutomationsPane";/);
  assert.match(source, /import \{ useWorkspaceDesktop \} from "@\/lib\/workspaceDesktop";/);
  assert.match(source, /import \{\s*Select,\s*SelectContent,\s*SelectItem,\s*SelectTrigger,\s*SelectValue,\s*\} from "@\/components\/ui\/select";/);
  assert.match(source, /import \{ Switch \} from "@\/components\/ui\/switch";/);
  assert.match(source, /\{ id: "automations", label: "Automations", icon: Workflow \}/);
  assert.match(source, /case "automations":\s*return "Automations";/);
  assert.match(source, /const \{ workspaces, selectedWorkspace \} = useWorkspaceDesktop\(\);/);
  assert.match(source, /const \[automationsWorkspaceId, setAutomationsWorkspaceId\] = useState\(""\);/);
  assert.match(source, /activeSection === "automations" \? \(/);
  assert.match(source, /toolbarLeading=\{/);
  assert.match(source, /<Select\s+value=\{automationsWorkspaceId \|\| undefined\}/);
  assert.match(source, /onValueChange=\{\(value\) =>\s*setAutomationsWorkspaceId\(value \?\? ""\)\s*\}/);
  assert.match(source, /<SelectTrigger className="min-w-\[220px\] rounded-full border-border\/40 bg-background\/80 px-3\.5 text-sm shadow-none sm:w-\[280px\]">/);
  assert.match(source, /<SelectValue placeholder="Select workspace">/);
  assert.match(source, /\{\(value: string \| null\) =>/);
  assert.match(source, /workspaces\.find\(\(workspace\) => workspace\.id === value\)\?\.name/);
  assert.match(source, /<AutomationsPane[\s\S]*workspaceId=\{automationsWorkspaceId \|\| null\}[\s\S]*showHeader=\{false\}[\s\S]*toolbarLeading=\{/);
  assert.match(source, /onEditSchedule=\{\(job\) => \{/);
  assert.match(source, /onEditAutomationSchedule\(automationsWorkspaceId, job\);/);
});

test("settings dialog settings section shows the app controls above appearance", async () => {
  const source = await readFile(SETTINGS_DIALOG_PATH, "utf8");

  assert.match(source, /const displayAppVersion = appVersion\.trim\(\) \|\| "Unavailable";/);
  assert.match(source, /function aboutAppUpdateState\(status: AppUpdateStatusPayload \| null\): \{/);
  assert.match(source, /const \[appUpdateStatus, setAppUpdateStatus\] =\s*useState<AppUpdateStatusPayload \| null>\(null\);/);
  assert.match(source, /const \[appUpdateChannelPending, setAppUpdateChannelPending\] = useState\(false\);/);
  assert.match(source, /const appUpdateState = aboutAppUpdateState\(appUpdateStatus\);/);
  assert.match(source, /window\.electronAPI\.appUpdate\.getStatus\(\)/);
  assert.match(source, /window\.electronAPI\.appUpdate\.onStateChange\(\(status\) => \{/);
  assert.match(source, /async function handleSetBetaChannel\(checked: boolean\)/);
  assert.match(source, /window\.electronAPI\.appUpdate\.setChannel\(\s*checked \? "beta" : "latest",?\s*\)/);
  assert.match(source, /activeSection === "about" \? \(/);

  const settingsSectionIndex = source.indexOf('activeSection === "settings" ? (');
  const appLabelIndex = source.indexOf("Holaboss Desktop");
  const desktopUpdatesIndex = source.indexOf("Desktop updates");
  const betaUpdatesIndex = source.indexOf("Beta updates");
  const appearanceIndex = source.indexOf("Appearance");
  const aboutSectionIndex = source.indexOf('activeSection === "about" ? (');

  assert.notEqual(settingsSectionIndex, -1);
  assert.notEqual(appLabelIndex, -1);
  assert.notEqual(desktopUpdatesIndex, -1);
  assert.notEqual(betaUpdatesIndex, -1);
  assert.notEqual(appearanceIndex, -1);
  assert.notEqual(aboutSectionIndex, -1);
  assert.ok(settingsSectionIndex < appLabelIndex);
  assert.ok(appLabelIndex < desktopUpdatesIndex);
  assert.ok(desktopUpdatesIndex < betaUpdatesIndex);
  assert.ok(betaUpdatesIndex < appearanceIndex);
  assert.ok(appearanceIndex < aboutSectionIndex);
  assert.match(source, /v\{displayAppVersion\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /appUpdateState\.progressPercent !== null/);
  assert.match(source, /width: `\$\{appUpdateState\.progressPercent\}%`/);
  assert.match(source, /Opt into beta desktop releases before they reach the stable channel\./);
  assert.match(source, /<Switch[\s\S]*checked=\{betaChannelEnabled\}/);
  assert.match(source, /aria-label="Enable beta updates"/);
});

test("settings nav lists automations below model providers", async () => {
  const source = await readFile(SETTINGS_DIALOG_PATH, "utf8");

  const providersIndex = source.indexOf('{ id: "providers", label: "Model Providers", icon: Waypoints }');
  const automationsIndex = source.indexOf('{ id: "automations", label: "Automations", icon: Workflow }');

  assert.notEqual(providersIndex, -1);
  assert.notEqual(automationsIndex, -1);
  assert.ok(providersIndex < automationsIndex);
});
