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

  assert.match(source, /Idle and cronjob sessions/);
  assert.doesNotMatch(source, /\.filter\(\(state\) => state\.status !== "IDLE"\)/);
  assert.match(source, /mainSessionId/);
  assert.match(source, /state\.session_id === normalizedMainSessionId/);
  assert.match(source, /sessionKind !== "main"/);
  assert.match(source, /onOpenRunningSession/);
  assert.match(source, /activeRunningSessionId/);
  assert.match(source, /onOpenSession=\{onOpenRunningSession\}/);
  assert.match(source, /activeSessionId=\{activeRunningSessionId\}/);
  assert.match(source, /onClick=\{\(\) => onOpenSession\(session\.sessionId\)\}/);
  assert.match(source, /aria-label=\{`Open session \$\{session\.title\}`\}/);
});

test("operations drawer inbox includes a prominent signed-out call to action", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /isSignedIn/);
  assert.match(source, /Sign in to review task proposals/);
  assert.match(
    source,
    /Sign in to connect this desktop to your Holaboss account and review[\s\S]*Inbox proposals\./,
  );
  assert.match(source, /onRequestSignIn/);
  assert.match(source, /Sign in/);
});

test("operations drawer running and outputs panels use the same compact shadcn language", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /function DrawerTabButton/);
  assert.match(source, /variant="ghost"/);
  assert.match(source, /size="sm"/);
  assert.doesNotMatch(source, /border px-3 text-sm transition/);
  assert.doesNotMatch(source, /Active and failed runtime sessions for the current workspace/);
  assert.doesNotMatch(source, /Latest operator-side events from the desktop surface/);
  assert.doesNotMatch(source, /No output events yet\. Accept or dismiss a proposal to start building this activity trail\./);
  assert.doesNotMatch(source, /overflow-x-auto pb-1/);
  assert.doesNotMatch(source, /onClick=\{\(\) => onSelectOutput\(entry\.id\)\}/);
  assert.doesNotMatch(source, /text-\[10px\]/);
  assert.doesNotMatch(source, /text-\[11px\]/);
  assert.doesNotMatch(source, /text-\[13px\]/);
  assert.doesNotMatch(source, /text-\[16px\]/);
  assert.doesNotMatch(source, /tracking-\[0\.16em\]/);
  assert.doesNotMatch(source, /tracking-\[0\.12em\]/);
});
