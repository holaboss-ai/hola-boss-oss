import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const sourcePath = path.join(process.cwd(), "src/components/panes/ChatPane.tsx");

test("chat pane preserves message history when auxiliary session history fetches fail", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /await Promise\.allSettled\(\[/);
  assert.match(
    source,
    /if \(historyResult\.status !== "fulfilled"\) \{\s*throw historyResult\.reason;\s*\}/,
  );
  assert.match(
    source,
    /outputEventHistoryResult\.status === "fulfilled"[\s\S]*\{\s*items: \[\],\s*count: 0,\s*last_event_id: 0\s*\}/,
  );
  assert.match(
    source,
    /auxiliaryHistoryWarnings\.push\(\s*optionalHistoryLoadErrorMessage\(\s*"Execution history"/,
  );
  assert.match(
    source,
    /setChatErrorMessage\(auxiliaryHistoryWarnings\.join\(" "\)\);/,
  );
});
