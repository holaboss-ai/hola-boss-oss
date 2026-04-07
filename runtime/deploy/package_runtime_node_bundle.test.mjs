import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWindowsRuntimeCmdLauncherSource,
  buildWindowsRuntimeLauncherSource
} from "./package_windows_runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const macosPackagerPath = path.join(__dirname, "package_macos_runtime.sh");
const linuxPackagerPath = path.join(__dirname, "package_linux_runtime.sh");
const windowsPackagerPath = path.join(__dirname, "package_windows_runtime.mjs");

for (const targetPath of [macosPackagerPath, linuxPackagerPath]) {
  test(`${path.basename(targetPath)} bundles a local node runtime and exports it`, async () => {
    const source = await readFile(targetPath, "utf8");

    assert.match(source, /npm install --prefix "\$\{NODE_RUNTIME_DIR\}" "node@\$\{NODE_VERSION\}" "npm@\$\{NPM_VERSION\}"/);
    assert.match(source, /BUNDLED_NODE_BIN="\$\{BUNDLE_ROOT\}\/node-runtime\/node_modules\/\.bin\/node"/);
    assert.match(source, /export PATH="\$\{BUNDLE_ROOT\}\/node-runtime\/node_modules\/\.bin:\$\{BUNDLE_ROOT\}\/node-runtime\/bin:\$\{PATH\}"/);
    assert.match(source, /export HOLABOSS_RUNTIME_NODE_BIN="\$\{BUNDLED_NODE_BIN\}"/);
    assert.match(source, /"bundled_npm_bin":/);
    assert.match(source, /"bundled_npm_version":/);
    assert.equal(/npm install --global --prefix "\$\{NODE_RUNTIME_DIR\}"/.test(source), false);
    assert.equal(/HOLABOSS_INSTALL_[A-Z_]+/.test(source), false);
  });
}

test("package_windows_runtime.mjs writes launchers that use the bundled node runtime", async () => {
  const source = await readFile(windowsPackagerPath, "utf8");
  const launcherSource = buildWindowsRuntimeLauncherSource();
  const cmdLauncherSource = buildWindowsRuntimeCmdLauncherSource();

  assert.match(source, /execFileSync\(npmCommand\(\), \["install", "--prefix", nodeRuntimeDir, `node@\$\{nodeVersion\}`, `npm@\$\{npmVersion\}`\]/);
  assert.match(source, /prunePackagedTree\(nodeRuntimeDir, "windows"\)/);
  assert.match(source, /bundled_npm_bin: Boolean\(bundledNpmBin\)/);
  assert.match(source, /bundled_npm_version: skipNodeDeps \? null : npmVersion/);
  assert.match(launcherSource, /startWindowsRuntime/);
  assert.match(launcherSource, /process\.exit/);
  assert.match(cmdLauncherSource, /node-runtime\\node_modules\\\.bin\\node\.exe/);
  assert.match(cmdLauncherSource, /sandbox-runtime\.mjs/);
});
