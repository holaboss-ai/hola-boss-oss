import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MAIN_PATH = new URL("./main.ts", import.meta.url);

test("main notification IPC path reuses cached results during transient runtime failures", async () => {
  const source = await readFile(MAIN_PATH, "utf8");

  assert.match(source, /const runtimeNotificationListCache = new Map</);
  assert.match(source, /function runtimeNotificationListCacheKey\(/);
  assert.match(source, /function emptyRuntimeNotificationListResponse\(\): RuntimeNotificationListResponsePayload/);
  assert.match(source, /runtimeNotificationListCache\.set\(cacheKey,\s*response\);/);
  assert.match(
    source,
    /if \(isTransientRuntimeError\(error\)\) \{\s*return \(\s*runtimeNotificationListCache\.get\(cacheKey\) \?\?\s*emptyRuntimeNotificationListResponse\(\)\s*\);/s,
  );
  assert.match(source, /runtimeNotificationListCache\.clear\(\);/);
});
