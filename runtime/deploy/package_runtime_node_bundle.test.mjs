import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const macosPackagerPath = path.join(__dirname, "package_macos_runtime.sh");
const linuxPackagerPath = path.join(__dirname, "package_linux_runtime.sh");

for (const targetPath of [macosPackagerPath, linuxPackagerPath]) {
  test(`${path.basename(targetPath)} bundles a local node runtime and exports it`, async () => {
    const source = await readFile(targetPath, "utf8");

    assert.match(source, /npm install --prefix "\$\{NODE_RUNTIME_DIR\}" "node@\$\{NODE_VERSION\}"/);
    assert.match(source, /BUNDLED_NODE_BIN="\$\{BUNDLE_ROOT\}\/node-runtime\/node_modules\/\.bin\/node"/);
    assert.match(source, /export PATH="\$\{BUNDLE_ROOT\}\/node-runtime\/node_modules\/\.bin:\$\{BUNDLE_ROOT\}\/node-runtime\/bin:\$\{PATH\}"/);
    assert.match(source, /export HOLABOSS_RUNTIME_NODE_BIN="\$\{BUNDLED_NODE_BIN\}"/);
    assert.equal(/npm install --global --prefix "\$\{NODE_RUNTIME_DIR\}"/.test(source), false);
    assert.equal(/HOLABOSS_INSTALL_[A-Z_]+/.test(source), false);
  });
}
