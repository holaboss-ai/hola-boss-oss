import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const NOTIFICATION_CENTER_PATH = new URL("./NotificationCenter.tsx", import.meta.url);

test("notification center exposes a clear-all action when notifications are present", async () => {
  const source = await readFile(NOTIFICATION_CENTER_PATH, "utf8");

  assert.match(source, /onClearAll\?: \(\) => void;/);
  assert.match(source, /notifications\.length > 0 && onClearAll/);
  assert.match(source, />\s*Clear all\s*</);
});

test("notification center routes notification activation through a shared action callback and shows priority", async () => {
  const source = await readFile(NOTIFICATION_CENTER_PATH, "utf8");

  assert.match(source, /onActivateNotification: \(notificationId: string\) => void;/);
  assert.match(source, /onClick=\{\(\) => onActivateNotification\(notification\.id\)\}/);
  assert.match(source, /priorityBadgeClassName\(notification\.priority\)/);
  assert.match(source, /priorityLabel\(notification\.priority\)/);
});
