import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const UPDATE_REMINDER_PATH = new URL("./UpdateReminder.tsx", import.meta.url);

test("update reminder renders as a compact toast with restart, changelog, and dismiss actions", async () => {
  const source = await readFile(UPDATE_REMINDER_PATH, "utf8");

  assert.match(source, /function releaseVersionLabel\(status: AppUpdateStatusPayload\)/);
  assert.match(source, /rounded-\[24px\] border border-border\/60 bg-popover\/95 shadow-2xl/);
  assert.match(source, /Desktop update/);
  assert.match(source, /Restart/);
  assert.match(source, /Changelog/);
  assert.match(source, /Dismiss/);
});

test("update reminder maps unsigned-build signature failures to a short hint", async () => {
  const source = await readFile(UPDATE_REMINDER_PATH, "utf8");

  assert.match(source, /code failed to satisfy specified code requirements/);
  assert.match(source, /This install is unsigned, so macOS blocked the signed update\./);
});

test("update reminder keeps the update hint concise", async () => {
  const source = await readFile(UPDATE_REMINDER_PATH, "utf8");

  assert.match(source, /Downloading quietly in the background\./);
  assert.match(source, /Restart now, or close later and Holaboss will install it on quit\./);
});
