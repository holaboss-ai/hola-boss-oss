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

test("settings dialog about section shows the app version", async () => {
  const source = await readFile(SETTINGS_DIALOG_PATH, "utf8");

  assert.match(source, /const displayAppVersion = appVersion\.trim\(\) \|\| "Unavailable";/);
  assert.match(source, /activeSection === "about" \? \(/);
  assert.match(source, /Holaboss Desktop/);
  assert.match(source, /Version/);
  assert.match(source, /v\{displayAppVersion\}/);
});

test("settings nav lists automations below model providers", async () => {
  const source = await readFile(SETTINGS_DIALOG_PATH, "utf8");

  const providersIndex = source.indexOf('{ id: "providers", label: "Model Providers", icon: Waypoints }');
  const automationsIndex = source.indexOf('{ id: "automations", label: "Automations", icon: Workflow }');

  assert.notEqual(providersIndex, -1);
  assert.notEqual(automationsIndex, -1);
  assert.ok(providersIndex < automationsIndex);
});
