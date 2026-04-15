import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const MAIN_PATH = new URL("./main.ts", import.meta.url);

test("startEmbeddedRuntime reuses an already-healthy runtime before emitting starting", async () => {
  const source = await readFile(MAIN_PATH, "utf8");

  assert.match(
    source,
    /async function startEmbeddedRuntime\(\) \{[\s\S]*const url = runtimeBaseUrl\(\);[\s\S]*if \(await isRuntimeHealthy\(url\)\) \{\s*return refreshRuntimeStatus\(\);\s*\}[\s\S]*runtimeStatus = withDesktopBrowserStatus\(\{\s*\.\.\.runtimeStatus,\s*status: runtimeRoot && executablePath \? "starting" : "missing",/,
  );
});
