import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const DESKTOP_PACKAGE_PATH = new URL("../package.json", import.meta.url);
const BUILDER_CONFIG_PATH = new URL("../electron-builder.config.cjs", import.meta.url);
const RUN_ELECTRON_BUILDER_PATH = new URL("../scripts/run-electron-builder.mjs", import.meta.url);
const WINDOWS_RELEASE_WORKFLOW_PATH = new URL("../../.github/workflows/release-windows-desktop.yml", import.meta.url);

test("windows packaging scripts prepare the packaged config before building installers", async () => {
  const packageJson = JSON.parse(await readFile(DESKTOP_PACKAGE_PATH, "utf8"));

  assert.match(packageJson.scripts["dist:win"], /prepare:packaged-config/);
  assert.match(packageJson.scripts["dist:win:local"], /prepare:packaged-config/);
});

test("windows packaging config and release workflow support optional signing and NSIS installer publishing", async () => {
  const [builderConfigSource, runElectronBuilderSource, workflowSource] = await Promise.all([
    readFile(BUILDER_CONFIG_PATH, "utf8"),
    readFile(RUN_ELECTRON_BUILDER_PATH, "utf8"),
    readFile(WINDOWS_RELEASE_WORKFLOW_PATH, "utf8"),
  ]);

  assert.match(builderConfigSource, /const windowsSigningConfigured = Boolean\(/);
  assert.match(builderConfigSource, /process\.env\.WIN_CSC_LINK \|\| process\.env\.CSC_LINK/);
  assert.match(builderConfigSource, /signAndEditExecutable: windowsSigningConfigured,/);

  assert.match(runElectronBuilderSource, /const electronBuilderCli = path\.join\(/);
  assert.match(runElectronBuilderSource, /"node_modules",\s*"electron-builder",\s*"cli\.js"/);
  assert.match(runElectronBuilderSource, /spawn\(process\.execPath, \[electronBuilderCli, \.\.\.builderArgs\], \{/);

  assert.match(workflowSource, /name: Release Windows Desktop/);
  assert.match(workflowSource, /runs-on: windows-latest/);
  assert.match(workflowSource, /DESKTOP_RELEASE_ASSET_NAME: Holaboss-windows-x64-setup\.exe/);
  assert.match(workflowSource, /CSC_LINK: \$\{\{ env\.WINDOWS_CERTIFICATE \}\}/);
  assert.match(workflowSource, /npm run dist:win:local/);
  assert.match(workflowSource, /gh release upload \$env:RELEASE_TAG \$env:INSTALLER_PATH --clobber/);
});
