import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");
const builderConfigPath = path.join(__dirname, "..", "electron-builder.config.cjs");
const packagedConfigPath = path.join(__dirname, "..", "scripts", "write-packaged-config.mjs");

test("desktop packager embeds runtime code but not bundled node/python toolchains", async () => {
  const builderConfigSource = await readFile(builderConfigPath, "utf8");

  assert.match(builderConfigSource, /from: runtimeBundlePath,/);
  assert.match(builderConfigSource, /"bin\/\*\*\/\*"/);
  assert.match(builderConfigSource, /"runtime\/\*\*\/\*"/);
  assert.doesNotMatch(builderConfigSource, /"node-runtime\/\*\*\/\*"/);
  assert.doesNotMatch(builderConfigSource, /"python-runtime\/\*\*\/\*"/);
});

test("packaged config records the runtime toolchain manifest for the current staged bundle", async () => {
  const source = await readFile(packagedConfigPath, "utf8");

  assert.match(source, /const runtimePackageMetadataPath = path\.join\(/);
  assert.match(source, /const toolchainManifest = await loadRuntimeToolchainManifest\(\);/);
  assert.match(source, /toolchainManifest,/);
  assert.match(source, /toolchain_id/);
});

test("packaged config script stays valid plain JavaScript", () => {
  execFileSync(process.execPath, ["--check", packagedConfigPath], {
    stdio: "pipe",
  });
});

test("runtime startup installs and resolves a managed toolchain outside the embedded runtime root", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /const TOOLCHAIN_RELEASE_ASSET_NAMES = \{/);
  assert.match(source, /function currentToolchainReleaseAssetUrl\(\)/);
  assert.match(source, /function managedRuntimeToolchainsRoot\(\)/);
  assert.match(source, /async function ensureManagedRuntimeToolchainInstalled\(\)/);
  assert.match(source, /HOLABOSS_RUNTIME_TOOLCHAIN_ROOT: toolchainRoot,/);
  assert.match(source, /await ensureManagedRuntimeToolchainInstalled\(\);/);
});
