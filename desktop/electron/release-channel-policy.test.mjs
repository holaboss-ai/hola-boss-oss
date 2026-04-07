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

test("desktop updater filters GitHub releases to desktop-shippable releases", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /const DESKTOP_RELEASE_TAG_PREFIX = "holaboss-";/);
  assert.match(source, /const RUNTIME_RELEASE_TAG_PREFIX = "holaboss-runtime-";/);
  assert.match(
    source,
    /function isDesktopReleaseTag\(tagName: string\): boolean \{[\s\S]*!tagName\.startsWith\(RUNTIME_RELEASE_TAG_PREFIX\)/,
  );
  assert.match(
    source,
    /function releaseMatchesDesktopChannel\(release: GithubReleasePayload\): boolean \{[\s\S]*release\.draft \|\| release\.prerelease[\s\S]*process\.platform === "darwin"[\s\S]*APP_UPDATE_MACOS_ASSET_NAME/,
  );
  assert.match(
    source,
    /https:\/\/api\.github\.com\/repos\/\$\{GITHUB_RELEASES_OWNER\}\/\$\{GITHUB_RELEASES_REPO\}\/releases\?per_page=\$\{GITHUB_RELEASE_LIST_PAGE_SIZE\}/,
  );
  assert.match(source, /const release = Array\.isArray\(releases\)\s*\?\s*selectLatestDesktopRelease\(releases\)\s*:\s*null;/);
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
