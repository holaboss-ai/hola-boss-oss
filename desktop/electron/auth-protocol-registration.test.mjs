import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const MAIN_PATH = new URL("./main.ts", import.meta.url);

test("desktop auth protocol registration resolves a stable default-app launch target", async () => {
  const source = await readFile(MAIN_PATH, "utf8");

  assert.match(source, /function nearestPackageJsonDirectory\(startDirectory: string\): string \| null/);
  assert.match(source, /existsSync\(path\.join\(currentDirectory, "package\.json"\)\)/);
  assert.match(source, /function defaultAppProtocolClientArgs\(\): string\[]/);
  assert.match(source, /const flagsWithSeparateValue = new Set\(\["--require", "-r"\]\);/);
  assert.match(source, /if \(maybeAuthCallbackUrl\(argument\)\) \{\s*continue;\s*\}/);
  assert.match(
    source,
    /app\.setAsDefaultProtocolClient\(\s*AUTH_CALLBACK_PROTOCOL,\s*process\.execPath,\s*defaultAppProtocolClientArgs\(\),\s*\);/,
  );
  assert.doesNotMatch(source, /path\.resolve\(process\.argv\[1\]!?\)/);
});
