import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("desktop runtime status stays in starting while launch is in flight", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /let runtimeStartupInFlight = false;/);
  assert.match(
    source,
    /function runtimeToolchainBootstrapPending\(\s*runtimeRoot: string \| null,\s*executablePath: string \| null,\s*toolchainRoot: string \| null,\s*\)/,
  );
  assert.match(
    source,
    /managedRuntimeToolchainSyncPromise \|\| runtimeStartupInFlight/,
  );
  assert.match(
    source,
    /function runtimeUnavailableStatus\(\s*hasBundle: boolean,\s*toolchainBootstrapPending = false,\s*\): RuntimeStatus \{/,
  );
  assert.match(
    source,
    /if \(\(runtimeStartupInFlight && hasBundle\) \|\| toolchainBootstrapPending\) \{\s*return "starting";\s*\}/,
  );
  assert.match(
    source,
    /return hasBundle \? "stopped" : "missing";/,
  );
  assert.match(
    source,
    /const toolchainBootstrapPending = runtimeToolchainBootstrapPending\(\s*runtimeRoot,\s*executablePath,\s*toolchainRoot,\s*\);/,
  );
  assert.match(
    source,
    /status: runtimeUnavailableStatus\(hasBundle, toolchainBootstrapPending\),/,
  );
  assert.match(
    source,
    /hasBundle \|\| toolchainBootstrapPending\s*\?\s*runtimeStartupInFlight \|\| toolchainBootstrapPending\s*\?\s*""\s*:\s*runtimeStatus\.lastError/,
  );
  assert.match(
    source,
    /async function startEmbeddedRuntime\(\) \{[\s\S]*runtimeStartupInFlight = true;[\s\S]*finally \{\s*runtimeStartupInFlight = false;\s*\}[\s\S]*\}\s*\);[\s\S]*\}/,
  );
});

test("desktop main window forces a runtime state resend after the renderer finishes loading", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /function emitRuntimeState\(force = false\) \{/);
  assert.match(
    source,
    /if \(!force && nextSignature === lastRuntimeStateSignature\) \{\s*return;\s*\}/,
  );
  assert.match(
    source,
    /win\.webContents\.on\("did-finish-load", \(\) => \{[\s\S]*emitRuntimeState\(true\);[\s\S]*\}\);/,
  );
});
