import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const OPERATIONS_DRAWER_PATH = new URL(
  "./OperationsDrawer.tsx",
  import.meta.url,
);

test("operations drawer inbox hosts the proactive proposals toggle", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /proactiveTaskProposalsEnabled/);
  assert.match(source, /onProactiveTaskProposalsEnabledChange/);
  assert.match(source, /aria-label="Toggle proactive task proposals"/);
  assert.match(source, /Tooltip/);
  assert.match(source, /TooltipContent/);
  assert.match(source, /TooltipTrigger/);
  assert.match(source, /aria-label="Refresh proposals"/);
  assert.match(source, /Refresh proposals/);
  assert.match(source, /Automatic proposals/);
  assert.match(source, /Enabled/);
  assert.match(source, /Paused/);
  assert.match(source, /Use Refresh or Trigger manually/);
  assert.doesNotMatch(
    source,
    /Review backend-delivered task ideas and either queue them immediately or dismiss them at the source\./,
  );
  assert.match(source, /Automatic proposals are enabled for this inbox\./);
  assert.match(source, /bg-amber-500\/12/);
  assert.match(source, /text-amber-200/);
  assert.doesNotMatch(source, /Refresh<\/span>/);
});

test("operations drawer running panel opens selected sessions", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /including idle and/);
  assert.doesNotMatch(source, /\.filter\(\(state\) => state\.status !== "IDLE"\)/);
  assert.match(source, /onOpenRunningSession/);
  assert.match(source, /activeRunningSessionId/);
  assert.match(source, /onOpenSession=\{onOpenRunningSession\}/);
  assert.match(source, /activeSessionId=\{activeRunningSessionId\}/);
  assert.match(source, /onClick=\{\(\) => onOpenSession\(session\.sessionId\)\}/);
  assert.match(source, /aria-label=\{`Open session \$\{session\.title\}`\}/);
});
