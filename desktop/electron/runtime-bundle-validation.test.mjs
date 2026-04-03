import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.join(__dirname, "main.ts");
const ensureRuntimeBundlePath = path.join(__dirname, "..", "scripts", "ensure-runtime-bundle.mjs");
const stageRuntimeBundlePath = path.join(__dirname, "..", "scripts", "stage-runtime-bundle.mjs");

test("desktop runtime validation requires the bundled node binary", async () => {
  const source = await readFile(mainPath, "utf8");

  assert.match(source, /path\.join\("node-runtime", "node_modules", "\.bin", "node"\)/);
});

test("desktop runtime staging checks the bundled node binary", async () => {
  const [ensureSource, stageSource] = await Promise.all([
    readFile(ensureRuntimeBundlePath, "utf8"),
    readFile(stageRuntimeBundlePath, "utf8"),
  ]);

  assert.match(ensureSource, /path\.join\(runtimeRoot, "node-runtime", "node_modules", "\.bin", "node"\)/);
  assert.match(stageSource, /path\.join\(stageDir, "node-runtime", "node_modules", "\.bin", "node"\)/);
});
