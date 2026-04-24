import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SOURCE_PATH = new URL("./ChatPane.tsx", import.meta.url);

test("chat pane renders background tasks inline and removes the separate quick action", async () => {
  const source = await readFile(SOURCE_PATH, "utf8");

  assert.doesNotMatch(source, /onOpenBackgroundTasks\?: \(\) => void;/);
  assert.doesNotMatch(source, /<ChatHeader[\s\S]*onOpenBackgroundTasks=/);
  assert.doesNotMatch(source, /aria-label="Show background tasks"/);
  assert.doesNotMatch(source, /onClick=\{\(\) => onOpenBackgroundTasks\(\)\}/);
  assert.match(
    source,
    /<BackgroundTasksPane[\s\S]*workspaceId=\{selectedWorkspaceId\}[\s\S]*variant="inline"/,
  );
  assert.match(
    source,
    /<BackgroundTasksPane[\s\S]*onOpenTaskSession=\{handleOpenBackgroundTaskSession\}/,
  );
  assert.match(source, /readOnly: true,/);
  assert.match(source, /Read-only subagent run\./);
  assert.match(source, /Return to main session/);
  assert.doesNotMatch(source, /aria-label="Select agent session"/);
});
