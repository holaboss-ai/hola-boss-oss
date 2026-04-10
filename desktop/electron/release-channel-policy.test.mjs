import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");
const stageRuntimeBundlePath = path.join(
  __dirname,
  "..",
  "scripts",
  "stage-runtime-bundle.mjs",
);
const publishRuntimeWorkflowPath = path.join(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "publish-runtime-bundles.yml",
);
const releaseMacosWorkflowPath = path.join(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "release-macos-desktop.yml",
);

test("desktop updater uses electron-updater and exposes install-now state", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /import \{[\s\S]*autoUpdater,[\s\S]*\} from "electron-updater";/);
  assert.match(source, /const APP_UPDATE_SUPPORTED_PLATFORMS = new Set\(\["darwin", "win32"\]\);/);
  assert.match(source, /autoUpdater\.autoDownload = true;/);
  assert.match(source, /autoUpdater\.autoInstallOnAppQuit = true;/);
  assert.match(source, /autoUpdater\.allowPrerelease = false;/);
  assert.match(source, /autoUpdater\.on\("update-available"/);
  assert.match(source, /autoUpdater\.on\("download-progress"/);
  assert.match(source, /autoUpdater\.on\("update-downloaded"/);
  assert.match(source, /await autoUpdater\.checkForUpdates\(\);/);
  assert.match(source, /handleTrustedIpc\("appUpdate:installNow", \["main"\], async \(\) => \{/);
  assert.match(source, /autoUpdater\.quitAndInstall\(true, true\);/);
});

test("runtime staging searches the runtime release channel before any legacy fallback", async () => {
  const source = await readFile(stageRuntimeBundlePath, "utf8");

  assert.match(source, /const runtimeReleaseTagPrefix = "holaboss-runtime-";/);
  assert.match(
    source,
    /https:\/\/api\.github\.com\/repos\/\$\{owner\}\/\$\{repo\}\/releases\?per_page=\$\{githubReleaseListPageSize\}/,
  );
  assert.match(
    source,
    /function isRuntimeChannelRelease\(release\) \{[\s\S]*tag\.startsWith\(runtimeReleaseTagPrefix\)/,
  );
  assert.match(
    source,
    /const runtimeRelease = sortReleasesByPublishedAtDescending\(releases\)\.find\(\(release\) => \{[\s\S]*isRuntimeChannelRelease\(release\) && findRuntimeReleaseAsset\(release\)/,
  );
  assert.match(
    source,
    /falling back to legacy stable runtime asset release/,
  );
});

test("runtime workflow publishes runtime-only releases under a prerelease-only runtime tag namespace", async () => {
  const source = await readFile(publishRuntimeWorkflowPath, "utf8");

  assert.match(source, /release_tag="holaboss-runtime-\$\{release_date\}"/);
  assert.match(source, /release_tag="holaboss-runtime-\$\{GITHUB_REF_NAME\}-\$\{release_date\}"/);
  assert.match(source, /release_pattern='holaboss-runtime-\[0-9\]\*'/);
  assert.match(source, /release_pattern="holaboss-runtime-\$\{GITHUB_REF_NAME\}-\*"/);
  assert.match(source, /prerelease_flag=\(--prerelease\)/);
  assert.match(source, /gh release edit "\$\{RELEASE_TAG\}" \\\n\s+--prerelease \\/);
});

test("desktop release workflow uploads the macOS auto-update artifacts", async () => {
  const source = await readFile(releaseMacosWorkflowPath, "utf8");

  assert.match(source, /--mac dmg zip \\/);
  assert.match(source, /latest-mac\.yml was not generated/);
  assert.match(source, /desktop\/out\/release\/\*\.zip/);
  assert.match(source, /desktop\/out\/release\/\*\.blockmap/);
  assert.match(source, /desktop\/out\/release\/latest-mac\.yml/);
  assert.match(source, /upload_paths=\([\s\S]*"\$\{manifest_path\}"/);
});

test("desktop release workflow uploads the Windows auto-update artifacts", async () => {
  const source = await readFile(
    path.join(__dirname, "..", "..", ".github", "workflows", "release-windows-desktop.yml"),
    "utf8",
  );

  assert.match(source, /WINDOWS_CERTIFICATE: \$\{\{ secrets\.WINDOWS_CERTIFICATE \}\}/);
  assert.match(source, /WINDOWS_CERTIFICATE_PASSWORD: \$\{\{ secrets\.WINDOWS_CERTIFICATE_PASSWORD \}\}/);
  assert.match(
    source,
    /throw "Windows desktop release requires WINDOWS_CERTIFICATE and WINDOWS_CERTIFICATE_PASSWORD so the public installer is code-signed\."/,
  );
  assert.match(source, /generated_installer_path=/);
  assert.match(source, /latest\.yml was not generated/);
  assert.match(source, /desktop\/out\/release\/\*\.yml/);
  assert.match(source, /desktop\/out\/release\/\*\.blockmap/);
  assert.match(source, /\$manifestPath = Join-Path \$PWD "desktop\/out\/release\/latest\.yml"/);
  assert.match(source, /\$uploadPaths \+= \$manifestPath/);
  assert.match(source, /gh release upload \$env:RELEASE_TAG @uploadPaths --clobber/);
});
