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
  assert.match(source, /aria-expanded=\{drawerOpen\}/);
  assert.match(source, /scheduleSummaryLabel/);
  assert.match(source, /ChevronDown/);
  assert.match(source, /Server schedule for this desktop instance\./);
  assert.match(source, /type="number"/);
  assert.match(source, /Every/);
  assert.match(source, /SelectTrigger/);
  assert.match(source, /SelectItem value="minute"/);
  assert.match(source, /SelectItem value="hour"/);
  assert.match(source, /SelectItem value="day"/);
  assert.match(source, /Saving here replaces the current custom cron with this simpler cadence\./);
  assert.match(source, /Save/);
  assert.match(source, /compact = false/);
  assert.match(source, /<ProactiveScheduleEditor[\s\S]*compact/);
  assert.match(source, /className=\{compact \? "mt-2 grid gap-2" : "mt-2 flex flex-wrap items-center gap-2"\}/);
  assert.match(source, /className=\{`h-8 rounded-full px-3 text-\[11px\] font-medium \$\{\s*compact \? "w-full" : ""\s*\}`\}/);
  assert.doesNotMatch(source, /Scheduled/);
  assert.doesNotMatch(source, /Workspace Included/);
});
