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

test("scheduled rows expose a run-now action for each automation", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const handleRunNow = async \(job: CronjobRecordPayload\) => \{/);
  assert.match(source, /await window\.electronAPI\.workspace\.runCronjobNow\(job\.id\);/);
  assert.match(source, /Run now/);
  assert.match(source, /<Play size=\{14\} \/>/);
});

test("scheduled rows label whether an automation is a notification or task run", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function jobDeliveryChannel\(job: CronjobRecordPayload\): string \{/);
  assert.match(source, /if \(channel === "system_notification"\) \{\s*return "Notification";/);
  assert.match(source, /if \(channel === "session_run"\) \{\s*return "Task run";/);
  assert.match(source, /jobKindClassName\(job\)/);
  assert.match(source, /jobKindLabel\(job\)/);
});

test("new schedule button can route creation into the workspace chat", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /interface AutomationsPaneProps \{\s*onOpenRunSession\?: \(sessionId: string\) => void;\s*onCreateSchedule\?: \(\) => void;\s*\}/);
  assert.match(source, /if \(onCreateSchedule\) \{\s*onCreateSchedule\(\);\s*return;\s*\}/);
  assert.match(source, /onClick=\{handleNewSchedule\}/);
});

test("completed runs open the corresponding sub-session when clicked", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /interface AutomationsPaneProps \{\s*onOpenRunSession\?: \(sessionId: string\) => void;/);
  assert.match(source, /onClick=\{\(\) => onOpenRunSession\?\.\(run\.sessionId\)\}/);
});
