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
const ciWorkflowPath = path.join(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "ci.yml",
);
const docsWorkflowPath = path.join(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "deploy-docs.yml",
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

test("runtime staging prefers an explicit release tag, then stable releases, then prerelease fallback", async () => {
  const source = await readFile(stageRuntimeBundlePath, "utf8");

  assert.match(source, /const sourceRepo = process\.env\.HOLABOSS_RUNTIME_SOURCE_REPO\?\.trim\(\) \|\| "holaboss-ai\/holaOS";/);
  assert.match(source, /const requestedReleaseTag = process\.env\.HOLABOSS_RUNTIME_RELEASE_TAG\?\.trim\(\) \|\| "";/);
  assert.match(
    source,
    /const requestedRelease = sortedReleases\.find\(\(release\) => \{[\s\S]*isRequestedRelease\(release\) && findRuntimeReleaseAsset\(release\)[\s\S]*\}\) \?\? null;/,
  );
  assert.match(
    source,
    /const stableRelease = sortedReleases\.find\(\(release\) => \{[\s\S]*isStableRelease\(release\) && findRuntimeReleaseAsset\(release\)[\s\S]*\}\) \?\? null;/,
  );
  assert.match(
    source,
    /const prereleaseRelease = sortedReleases\.find\(\(release\) => \{[\s\S]*isPrerelease\(release\) && findRuntimeReleaseAsset\(release\)[\s\S]*\}\) \?\? null;/,
  );
  assert.match(source, /const release = requestedRelease \?\? stableRelease \?\? prereleaseRelease;/);
  assert.match(
    source,
    /requested runtime release \$\{requestedReleaseTag\} is unavailable; falling back to the latest eligible release asset/,
  );
  assert.match(
    source,
    /no stable release runtime asset was found; falling back to prerelease \$\{normalizedReleaseTag\(prereleaseRelease\)\}/,
  );
});

test("manual CI workflow creates combined desktop releases with bundled runtime assets", async () => {
  const source = await readFile(ciWorkflowPath, "utf8");

  assert.match(source, /^name: CI$/m);
  assert.match(source, /workflow_dispatch:\n\s+inputs:\n\s+ref:/);
  assert.match(source, /release_tag:\n\s+description: GitHub release tag to create or update/);
  assert.match(source, /release_title:\n\s+description: Optional GitHub release title/);
  assert.match(source, /prerelease:\n\s+description: Mark the GitHub release as a prerelease/);
  assert.match(source, /release_tag must match holaboss-desktop-YYYY\.MDD\.R/);
  assert.match(source, /release_version="\$\{release_tag#holaboss-desktop-\}"/);
  assert.match(source, /release_title="Holaboss \$\{release_version\}"/);
  assert.match(source, /RUNTIME_ASSET_NAME: holaboss-runtime-linux\.tar\.gz/);
  assert.match(source, /RUNTIME_ASSET_NAME: holaboss-runtime-macos\.tar\.gz/);
  assert.match(source, /RUNTIME_ASSET_NAME: holaboss-runtime-windows\.tar\.gz/);
  assert.match(source, /TOOLCHAIN_ASSET_NAME: holaboss-toolchain-linux\.tar\.gz/);
  assert.match(source, /TOOLCHAIN_ASSET_NAME: holaboss-toolchain-macos\.tar\.gz/);
  assert.match(source, /TOOLCHAIN_ASSET_NAME: holaboss-toolchain-windows\.tar\.gz/);
  assert.match(source, /tar -C out\/runtime-linux -czf "out\/\$\{TOOLCHAIN_ASSET_NAME\}" package-metadata\.json node-runtime python-runtime/);
  assert.match(source, /tar -C out\/runtime-macos -czf "out\/\$\{TOOLCHAIN_ASSET_NAME\}" package-metadata\.json node-runtime python-runtime/);
  assert.match(source, /gh release upload "\$\{RELEASE_TAG\}" "out\/\$\{RUNTIME_ASSET_NAME\}" --clobber/);
  assert.match(source, /gh release upload "\$\{RELEASE_TAG\}" "out\/\$\{TOOLCHAIN_ASSET_NAME\}" --clobber/);
  assert.match(source, /--prepackaged "\$\{app_path\}" \\\n\s+--mac dmg zip \\/);
  assert.match(source, /latest-mac\.yml was not generated/);
  assert.match(source, /latest\.yml was not generated/);
  assert.match(source, /app-update\.yml is missing from notarized app bundle/);
  assert.match(source, /Desktop typecheck/);
  assert.match(source, /Runtime harness host tests/);
});

test("docs workflow remains independent and CI ignores docs-only changes", async () => {
  const [ciSource, docsSource] = await Promise.all([
    readFile(ciWorkflowPath, "utf8"),
    readFile(docsWorkflowPath, "utf8"),
  ]);

  assert.match(ciSource, /paths-ignore:\n\s+- \.github\/workflows\/deploy-docs\.yml\n\s+- website\/docs\/\*\*/);
  assert.match(docsSource, /^name: Deploy Docs$/m);
  assert.match(docsSource, /pull_request:\n\s+paths:\n\s+- \.github\/workflows\/deploy-docs\.yml\n\s+- website\/docs\/\*\*/);
  assert.match(docsSource, /push:\n\s+branches:\n\s+- main\n\s+paths:\n\s+- \.github\/workflows\/deploy-docs\.yml\n\s+- website\/docs\/\*\*/);
  assert.match(docsSource, /run: npm run docs:test/);
  assert.match(docsSource, /run: npm run docs:build/);
});
