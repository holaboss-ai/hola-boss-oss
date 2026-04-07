import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const NOTIFICATION_TOAST_STACK_PATH = new URL("./NotificationToastStack.tsx", import.meta.url);

test("notification toast stack shows an explicit view-session action for session-target notifications", async () => {
  const source = await readFile(NOTIFICATION_TOAST_STACK_PATH, "utf8");

  assert.match(source, /className\?: string;/);
  assert.match(source, /style\?: React\.CSSProperties;/);
  assert.match(source, /className=\{cn\(/);
  assert.match(source, /style=\{style\}/);
  assert.match(source, /function notificationTargetSessionId\(/);
  assert.match(source, /const targetSessionId = notificationTargetSessionId\(notification\);/);
  assert.match(source, /const isSessionTarget = Boolean\(targetSessionId\);/);
  assert.match(source, /View session/);
  assert.match(source, /<ArrowUpRight size=\{14\} \/>/);
});
