import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "AutomationsPane.tsx");

test("automations pane keeps scheduled tasks and completed runs as distinct data sets", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const \[cronjobs, setCronjobs\] = useState<CronjobRecordPayload\[]>\(\[\]\);/);
  assert.match(source, /const \[completedRuns, setCompletedRuns\] = useState<CompletedAutomationRun\[]>\(/);
  assert.match(source, /window\.electronAPI\.workspace\.listCronjobs\(selectedWorkspaceId\)/);
  assert.match(source, /window\.electronAPI\.workspace\.listAgentSessions\(selectedWorkspaceId\)/);
  assert.match(source, /window\.electronAPI\.workspace\.listRuntimeStates\(selectedWorkspaceId\)/);
  assert.match(source, /session\.kind\.trim\(\)\.toLowerCase\(\) === "cronjob"/);
});

test("scheduled tab toggle updates cronjob enabled state", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /await window\.electronAPI\.workspace\.updateCronjob\(job\.id, \{\s*enabled: !job\.enabled,\s*\}\);/);
  assert.match(source, /aria-label=\{job\.enabled \? "Disable schedule" : "Enable schedule"\}/);
});

test("completed runs open the corresponding sub-session when clicked", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /interface AutomationsPaneProps \{\s*onOpenRunSession\?: \(sessionId: string\) => void;/);
  assert.match(source, /onClick=\{\(\) => onOpenRunSession\?\.\(run\.sessionId\)\}/);
});
