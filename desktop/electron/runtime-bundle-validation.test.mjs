import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.join(__dirname, "main.ts");
const ensureRuntimeBundlePath = path.join(__dirname, "..", "scripts", "ensure-runtime-bundle.mjs");
const stageRuntimeBundlePath = path.join(__dirname, "..", "scripts", "stage-runtime-bundle.mjs");
const runtimeBundlePath = path.join(__dirname, "..", "scripts", "runtime-bundle.mjs");

test("desktop runtime validation requires the bundled node binary", async () => {
  const source = await readFile(mainPath, "utf8");

  assert.match(source, /"node-runtime",\s*"bin",\s*"node\.exe"/);
  assert.match(source, /path\.join\("python-runtime", "bin", "python"\)/);
});

test("desktop runtime staging checks the bundled runtime requirement groups", async () => {
  const [ensureSource, stageSource, runtimeBundleSource] = await Promise.all([
    readFile(ensureRuntimeBundlePath, "utf8"),
    readFile(stageRuntimeBundlePath, "utf8"),
    readFile(runtimeBundlePath, "utf8"),
  ]);

  assert.match(ensureSource, /runtimeBundleRequiredPathGroups\(runtimePlatform\)/);
  assert.match(ensureSource, /"stage_python_runtime\.mjs"/);
  assert.match(stageSource, /runtimeBundleRequiredPathGroups\(runtimePlatform\)/);
  assert.match(runtimeBundleSource, /export function runtimeBundlePythonRelativePaths/);
  assert.match(runtimeBundleSource, /path\.join\("python-runtime", "bin", "python"\)/);
});
