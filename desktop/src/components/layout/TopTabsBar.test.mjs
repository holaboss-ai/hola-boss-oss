import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TOP_TABS_BAR_PATH = new URL("./TopTabsBar.tsx", import.meta.url);

test("top tabs bar renders the notification center before the profile menu", async () => {
  const source = await readFile(TOP_TABS_BAR_PATH, "utf8");

  const notificationIndex = source.indexOf("<NotificationCenter");
  const profileMenuIndex = source.indexOf("<DropdownMenu>");

  assert.notEqual(notificationIndex, -1);
  assert.notEqual(profileMenuIndex, -1);
  assert.ok(notificationIndex < profileMenuIndex);
  assert.match(source, /notificationUnreadCount = 0/);
});
