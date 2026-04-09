import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const NOTIFICATION_TOAST_STACK_PATH = new URL(
  "./NotificationToastStack.tsx",
  import.meta.url,
);

test("notification toast stack anchors itself to the top right corner", async () => {
  const source = await readFile(NOTIFICATION_TOAST_STACK_PATH, "utf8");

  assert.match(
    source,
    /pointer-events-none fixed right-4 top-4 z-\[90\] flex w-\[min\(340px,calc\(100vw-2rem\)\)\] flex-col gap-3 sm:right-6 sm:top-6/,
  );
  assert.doesNotMatch(source, /fixed bottom-4 left-4/);
});
