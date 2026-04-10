import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const OPERATIONS_DRAWER_PATH = new URL("./OperationsDrawer.tsx", import.meta.url);

test("operations drawer inbox surfaces lifecycle status and trigger feedback", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /ProactiveLifecyclePanel/);
  assert.match(source, /proposalStatusMessage \?/);
  assert.match(source, /label="Sessions"/);
  assert.match(source, />\s*New Session\s*</);
  assert.match(source, /isLoading=\{isLoadingProactiveStatus\}/);
  assert.doesNotMatch(source, /label="Running"/);
  assert.doesNotMatch(source, /InboxHeaderActions/);
});

test("operations drawer shows proposal source lane and rationale copy", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /function proposalSourceLabel\(source: TaskProposalRecordPayload\["proposal_source"\]\): string/);
  assert.match(source, /proposalSourceLabel\(proposal\.proposal_source\)/);
  assert.match(source, /Why: \{proposal\.task_generation_rationale\}/);
});

test("operations drawer session rows expose pointer cursor affordance", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(
    source,
    /aria-label=\{`Open session \$\{session\.title\}`\}[\s\S]*className=\{`w-full cursor-pointer px-3 py-3 text-left transition-colors/,
  );
});

test("operations drawer can badge the inbox tab for unread proposals", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /unreadProposalCount: number;/);
  assert.match(source, /showIndicator=\{unreadProposalCount > 0\}/);
  assert.match(source, /showIndicator = false,/);
  assert.match(source, /absolute -right-0\.5 -top-0\.5 size-2\.5 rounded-full border-2 border-card bg-destructive/);
});

test("operations drawer derives a completed status from the last turn result when runtime is idle", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /function runningSessionState\(entry:/);
  assert.match(source, /const lastTurnStatus = normalizeTurnResultStatus\(entry\.last_turn_status\);/);
  assert.match(source, /if \(lastTurnStatus === "completed"\) \{\s*return "COMPLETED";\s*\}/);
  assert.match(source, /stateTimestamp: runningSessionStateTimestamp\(state\),/);
  assert.match(source, /stateDetail: runningSessionStateDetail\(stateLabel\),/);
  assert.match(source, /\{session\.stateDetail\}[\s\S]*relativeTime\(session\.stateTimestamp\)/);
});

test("operations drawer refreshes running session state frequently while visible", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /const RUNNING_SESSIONS_POLL_INTERVAL_MS = 1000;/);
  assert.match(source, /window\.addEventListener\("focus", refreshRunningSessions\);/);
  assert.match(source, /document\.addEventListener\(\s*"visibilitychange",\s*refreshVisibleRunningSessions,/);
  assert.match(source, /if \(requestInFlight\) \{\s*return;\s*\}/);
});

test("operations drawer uses centered icon indicators for session status", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /function runningSessionStatusIndicator\(/);
  assert.match(source, /const statusIndicator = runningSessionStatusIndicator\(/);
  assert.match(source, /className="flex items-center gap-3"/);
  assert.match(source, /role="img"/);
  assert.match(source, /title=\{statusIndicator\.label\}/);
  assert.doesNotMatch(source, /<Badge/);
});
