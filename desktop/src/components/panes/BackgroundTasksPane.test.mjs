import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SOURCE_PATH = new URL("./BackgroundTasksPane.tsx", import.meta.url);

test("background tasks pane polls workspace background tasks and supports inline read-only rendering", async () => {
  const source = await readFile(SOURCE_PATH, "utf8");

  assert.match(source, /const BACKGROUND_TASKS_POLL_INTERVAL_MS = 1000;/);
  assert.match(
    source,
    /onOpenTaskSession\?: \(task: BackgroundTaskRecordPayload\) => void;/,
  );
  assert.match(source, /variant = "full"/);
  assert.match(source, /window\.electronAPI\.workspace\.listBackgroundTasks\(\{\s*workspaceId: activeWorkspaceId,/);
  assert.match(source, /Read-only view for workspace background work\./);
  assert.match(source, /No background tasks yet\./);
  assert.match(source, /window\.addEventListener\("focus", refreshVisibleTasks\);/);
  assert.match(source, /document\.addEventListener\("visibilitychange", refreshVisibleTasks\);/);
  assert.match(source, /if \(variant === "inline"\) \{/);
  assert.match(source, /onClick=\{\(\) => setInlineExpanded\(\(value\) => !value\)\}/);
  assert.doesNotMatch(
    source,
    /Read-only view for workspace background work\. Click a task to inspect its run transcript, then use the main session to cancel, retry, or answer blockers\./,
  );
  assert.match(source, /onClick=\{\(\) => onOpenTaskSession\(task\)\}/);
  assert.match(source, /Inspect run/);
});
