import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const NOTIFICATION_CENTER_PATH = new URL("./NotificationCenter.tsx", import.meta.url);

test("notification center exposes a dismiss-all action only when active notifications remain", async () => {
  const source = await readFile(NOTIFICATION_CENTER_PATH, "utf8");

  assert.match(source, /onClearAll\?: \(\) => void;/);
  assert.match(source, /const canDismissAll = notifications\.some\(/);
  assert.match(source, /canDismissAll && onClearAll/);
  assert.match(source, />\s*Dismiss all\s*</);
});

test("notification center routes notification activation through a shared action callback and shows priority", async () => {
  const source = await readFile(NOTIFICATION_CENTER_PATH, "utf8");

  assert.match(source, /onActivateNotification: \(notificationId: string\) => void;/);
  assert.match(source, /onClick=\{\(\) => onActivateNotification\(notification\.id\)\}/);
  assert.match(source, /priorityBadgeClassName\(notification\.priority\)/);
  assert.match(source, /priorityLabel\(notification\.priority\)/);
});

test("notification center keeps dismissed items visible but muted", async () => {
  const source = await readFile(NOTIFICATION_CENTER_PATH, "utf8");

  assert.match(source, /const isDismissed = notification\.state === "dismissed";/);
  assert.match(source, /isDismissed\s*\?\s*"border-border\/40 bg-muted\/20 opacity-75"/);
  assert.match(source, />\s*Dismissed\s*</);
  assert.match(source, /!\s*isDismissed \? \(/);
});
