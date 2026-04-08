import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CARD_PATH = new URL("./ProactiveStatusCard.tsx", import.meta.url);

test("proactive status card keeps controls inside the compact lifecycle card", async () => {
  const source = await readFile(CARD_PATH, "utf8");

  assert.doesNotMatch(source, /Suggestions/);
  assert.doesNotMatch(source, /delivery_state/);
  assert.doesNotMatch(source, /linear-gradient/);
  assert.doesNotMatch(source, /theme-subtle-surface/);
  assert.doesNotMatch(source, /theme-shell/);
  assert.match(source, /rounded-\[20px\] border border-border\/40 bg-card/);
  assert.match(source, /lifecycle_state/);
  assert.match(source, /Claimed/);
  assert.match(source, /Run proactive analysis/);
  assert.match(source, /Enabled/);
  assert.match(source, /Disabled/);
  assert.match(source, /Schedule/);
  assert.match(source, /Server cron for this desktop instance\./);
  assert.match(source, /Save/);
  assert.doesNotMatch(source, /Scheduled/);
  assert.doesNotMatch(source, /Workspace Included/);
});
