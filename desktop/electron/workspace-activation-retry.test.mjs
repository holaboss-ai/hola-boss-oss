import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const MAIN_PATH = new URL("./main.ts", import.meta.url);

test("workspace activation opts runtime ensure-running into transient retry handling", async () => {
  const source = await readFile(MAIN_PATH, "utf8");

  assert.match(source, /retryTransientErrors\?: boolean;/);
  assert.match(source, /const attempts = method === "GET" \|\| retryTransientErrors \? 3 : 1;/);
  assert.match(
    source,
    /await requestRuntimeJson<Record<string, unknown>>\(\{\s*method: "POST",\s*path: "\/api\/v1\/apps\/ensure-running",[\s\S]*retryTransientErrors: true,/,
  );
});
