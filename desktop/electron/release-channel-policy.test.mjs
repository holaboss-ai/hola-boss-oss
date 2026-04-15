import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");
const electronBuilderConfigPath = path.join(__dirname, "..", "electron-builder.config.cjs");
const packagedConfigScriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "write-packaged-config.mjs",
);
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
  const [source, packagedConfigSource] = await Promise.all([
    readFile(mainSourcePath, "utf8"),
    readFile(packagedConfigScriptPath, "utf8"),
  ]);

  assert.match(source, /import \{[\s\S]*autoUpdater,[\s\S]*\} from "electron-updater";/);
  assert.match(source, /const APP_UPDATE_SUPPORTED_PLATFORMS = new Set\(\["darwin", "win32"\]\);/);
  assert.match(source, /const GITHUB_RELEASES_REPO = "holaOS";/);
  assert.match(source, /const DEFAULT_APP_UPDATE_CHANNEL =/);
  assert.match(source, /function preferredAppUpdateChannel\(\): AppUpdateChannel \| null \{/);
  assert.match(source, /function effectiveAppUpdateChannel\(\): AppUpdateChannel \{/);
  assert.match(source, /function applyAutoUpdaterChannelConfiguration\(\) \{/);
  assert.match(source, /autoUpdater\.autoDownload = true;/);
  assert.match(source, /autoUpdater\.autoInstallOnAppQuit = true;/);
  assert.match(source, /autoUpdater\.allowPrerelease = channel === "beta";/);
  assert.match(source, /autoUpdater\.channel = channel;/);
  assert.match(source, /autoUpdater\.on\("update-available"/);
  assert.match(source, /autoUpdater\.on\("download-progress"/);
  assert.match(source, /autoUpdater\.on\("update-downloaded"/);
  assert.match(source, /await autoUpdater\.checkForUpdates\(\);/);
  assert.match(source, /handleTrustedIpc\(\s*"appUpdate:setChannel",\s*\["main"\],\s*async \(_event, channel: AppUpdateChannel\) => setAppUpdateChannel\(channel\),/);
  assert.match(source, /handleTrustedIpc\("appUpdate:installNow", \["main"\], async \(\) => \{/);
  assert.match(source, /autoUpdater\.quitAndInstall\(true, true\);/);
  assert.match(packagedConfigSource, /function resolveUpdateChannel\(\)/);
  assert.match(packagedConfigSource, /\.\.\.\(updateChannel === "beta" \? \{ updateChannel \} : \{\}\),/);
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
  const [source, builderConfig] = await Promise.all([
    readFile(ciWorkflowPath, "utf8"),
    readFile(electronBuilderConfigPath, "utf8"),
  ]);

  assert.match(source, /^name: CI$/m);
  assert.match(source, /workflow_dispatch:\n\s+inputs:\n\s+ref:/);
  assert.match(source, /release_tag:\n\s+description: GitHub release tag to create or update/);
  assert.match(source, /release_title:\n\s+description: Optional GitHub release title/);
  assert.match(source, /prerelease:\n\s+description: Mark the GitHub release as a prerelease/);
  assert.match(source, /release_channel:\n\s+description: Auto-update channel to publish for desktop clients/);
  assert.match(source, /default: latest/);
  assert.match(source, /type: choice/);
  assert.match(source, /options:\n\s+- latest\n\s+- beta/);
  assert.match(source, /release_windows:\n\s+description: Build and publish the Windows desktop installer/);
  assert.match(source, /release_tag must match holaboss-desktop-YYYY\.MDD\.R/);
  assert.match(source, /release_version="\$\{release_tag#holaboss-desktop-\}"/);
  assert.match(source, /release_title="Holaboss \$\{release_version\}"/);
  assert.match(source, /release_channel="\$\{\{ inputs\.release_channel \}\}"/);
  assert.match(source, /beta channel releases must be marked as prerelease/);
  assert.match(source, /latest channel releases must not be marked as prerelease/);
  assert.match(source, /gh release create "\$\{RELEASE_TAG\}" \\\n\s+--title "\$\{RELEASE_TITLE\}" \\\n\s+--notes-file "\$\{notes_path\}" \\\n\s+--draft/);
  assert.match(source, /gh release edit "\$\{RELEASE_TAG\}" \\\n\s+--title "\$\{RELEASE_TITLE\}" \\\n\s+--notes-file "\$\{notes_path\}" \\\n\s+--draft/);
  assert.match(source, /RUNTIME_ASSET_NAME: holaboss-runtime-linux\.tar\.gz/);
  assert.match(source, /RUNTIME_ASSET_NAME: holaboss-runtime-macos\.tar\.gz/);
  assert.match(source, /RUNTIME_ASSET_NAME: holaboss-runtime-windows\.tar\.gz/);
  assert.match(source, /TOOLCHAIN_ASSET_NAME: holaboss-toolchain-linux\.tar\.gz/);
  assert.match(source, /TOOLCHAIN_ASSET_NAME: holaboss-toolchain-macos\.tar\.gz/);
  assert.match(source, /TOOLCHAIN_ASSET_NAME: holaboss-toolchain-windows\.tar\.gz/);
  assert.match(source, /release-macos-desktop:[\s\S]*?runs-on: macos-latest\s+env:\s+RELEASE_TAG:[\s\S]*?GH_REPO: holaboss-ai\/holaOS\s+RUNTIME_ASSET_NAME: holaboss-runtime-macos\.tar\.gz/);
  assert.match(source, /tar -C out\/runtime-linux -czf "out\/\$\{TOOLCHAIN_ASSET_NAME\}" package-metadata\.json node-runtime python-runtime/);
  assert.match(source, /tar -C out\/runtime-macos -czf "out\/\$\{TOOLCHAIN_ASSET_NAME\}" package-metadata\.json node-runtime python-runtime/);
  assert.match(source, /gh release upload "\$\{RELEASE_TAG\}" "out\/\$\{RUNTIME_ASSET_NAME\}" --clobber/);
  assert.match(source, /gh release upload "\$\{RELEASE_TAG\}" "out\/\$\{TOOLCHAIN_ASSET_NAME\}" --clobber/);
  assert.match(source, /app-update\.yml is missing from signed macOS app bundle/);
  assert.match(source, /prepackaged_app="\$\{RUNNER_TEMP\}\/Holaboss\.app"/);
  assert.match(source, /ditto "\$\{app_path\}" "\$\{prepackaged_app\}"/);
  assert.doesNotMatch(source, /node scripts\/write-app-update-config\.mjs "\$\{prepackaged_app\}"/);
  assert.doesNotMatch(source, /app-update\.yml is missing from prepackaged macOS app bundle/);
  assert.match(source, /--prepackaged "\$\{prepackaged_app\}" \\\n\s+--mac dmg zip \\/);
  assert.match(source, /primary_manifest_name="beta-mac\.yml"/);
  assert.match(source, /primary_manifest_name="latest-mac\.yml"/);
  assert.match(source, /beta-mac\.yml was not generated for stable-channel compatibility/);
  assert.match(source, /macOS zip does not contain Holaboss\.app as the root app bundle/);
  assert.match(source, /app-update\.yml is missing from final macOS zip/);
  assert.match(source, /extract_dir="\$\{RUNNER_TEMP\}\/mac-zip-signature-verify"/);
  assert.match(source, /Holaboss\.app was not extracted from the final macOS zip/);
  assert.match(source, /codesign --verify --deep --strict --verbose=2 "\$\{extracted_app\}"/);
  assert.match(source, /spctl -a -vv -t exec "\$\{extracted_app\}"/);
  assert.match(source, /xcrun stapler validate "\$\{extracted_app\}"/);
  assert.match(source, /Verify published macOS release assets from GitHub/);
  assert.match(source, /gh release download "\$\{RELEASE_TAG\}" \\\n\s+--dir "\$\{verify_dir\}" \\\n\s+--pattern 'Holaboss-\*-arm64-mac\.zip'/);
      assert.match(source, /failed to download beta-mac\.yml from GitHub/);
      assert.match(source, /published macOS zip is missing Holaboss\.app\/Contents\/Resources\/app-update\.yml/);
      assert.match(
        source,
        /ruby - "\$\{zip_path\}" "\$\{manifest_path\}" "\$\{verify_dir\}\/beta-mac\.yml" "\$\{primary_channel\}" <<'RUBY'/,
      );
      assert.doesNotMatch(
        source,
        /ruby "\$\{zip_path\}" "\$\{manifest_path\}" "\$\{verify_dir\}\/beta-mac\.yml" "\$\{primary_channel\}" <<'RUBY'/,
      );
      assert.match(source, /raise "app-update repo is not holaOS"/);
      assert.match(source, /raise "latest-mac\.yml path does not match uploaded zip"/);
      assert.match(source, /raise "beta-mac\.yml path does not match uploaded zip"/);
  assert.doesNotMatch(source, /verify-macos-release-assets:/);
  assert.match(source, /publish-release:/);
  assert.match(
    source,
    /publish-release:[\s\S]*?runs-on: ubuntu-latest\s+env:\s+RELEASE_TAG:[\s\S]*?GH_REPO: holaboss-ai\/holaOS\s+steps:/,
  );
  assert.doesNotMatch(source, /needs\.verify-macos-release-assets\.result == 'success'/);
  assert.match(source, /gh release edit "\$\{RELEASE_TAG\}" \\\n\s+--title "\$\{RELEASE_TITLE\}" \\\n\s+--draft=false/);
  assert.match(source, /\$manifestName = if \(\$primaryChannel -eq "beta"\) \{ "beta\.yml" \} else \{ "latest\.yml" \}/);
  assert.match(source, /beta\.yml was not generated for stable-channel compatibility/);
  assert.match(builderConfig, /repo: "holaOS"/);
  assert.match(builderConfig, /generateUpdatesFilesForAllChannels: true/);
  assert.match(builderConfig, /\.\.\.\(releaseChannel === "beta" \? \{ channel: releaseChannel \} : \{\}\)/);
  assert.match(builderConfig, /afterPack: async \(context\) => \{/);
  assert.match(builderConfig, /if \(context\.electronPlatformName !== "darwin"\) \{/);
  assert.match(builderConfig, /const \{ writeAppUpdateConfig \} = await import\(/);
  assert.match(builderConfig, /scripts", "write-app-update-config\.mjs"/);
  assert.match(builderConfig, /await writeAppUpdateConfig\(appBundlePath\);/);
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
