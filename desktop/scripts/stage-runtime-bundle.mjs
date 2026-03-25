import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
function resolveRuntimePlatform() {
  const explicitPlatform = process.env.HOLABOSS_RUNTIME_PLATFORM?.trim();
  if (explicitPlatform) {
    return explicitPlatform.toLowerCase();
  }

  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported host platform: ${process.platform}`);
  }
}

const runtimePlatform = resolveRuntimePlatform();
const stageParentDir = path.join(repoRoot, "out");
const stageDir = path.join(stageParentDir, `runtime-${runtimePlatform}`);
const defaultLocalRuntimeDir = `/tmp/holaboss-runtime-${runtimePlatform}-full`;
const sourceRepo = process.env.HOLABOSS_RUNTIME_SOURCE_REPO?.trim() || "holaboss-ai/hola-boss-oss";
const latestReleaseAssetPrefix = `holaboss-runtime-${runtimePlatform}-`;

function log(message) {
  process.stdout.write(`[stage-runtime] ${message}\n`);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureCleanStageDir() {
  await fs.rm(stageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.mkdir(stageParentDir, { recursive: true });
}

async function copyRuntimeDirectory(sourceDir) {
  log(`copying runtime directory from ${sourceDir}`);
  await fs.cp(sourceDir, stageDir, { recursive: true, verbatimSymlinks: true });
}

async function extractRuntimeTarball(tarballPath) {
  log(`extracting runtime tarball from ${tarballPath}`);
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), "holaboss-runtime-extract-"));
  await execFileAsync("tar", ["-xzf", tarballPath, "-C", extractDir]);

  const entries = await fs.readdir(extractDir);
  if (entries.length === 0) {
    throw new Error(`Runtime tarball ${tarballPath} extracted no files.`);
  }

  const rootEntry = entries.length === 1 ? path.join(extractDir, entries[0]) : extractDir;
  const runtimeRoot = await pathExists(path.join(rootEntry, "bin", "sandbox-runtime")) ? rootEntry : null;
  if (!runtimeRoot) {
    throw new Error(`Runtime tarball ${tarballPath} did not contain a runtime root with bin/sandbox-runtime.`);
  }

  await fs.cp(runtimeRoot, stageDir, { recursive: true, verbatimSymlinks: true });
}

async function downloadRuntimeTarball(url, destinationTarball) {
  log(`downloading runtime tarball from ${url}`);
  const headers = {};
  if (process.env.HOLABOSS_RUNTIME_BUNDLE_TOKEN) {
    headers.Authorization = `Bearer ${process.env.HOLABOSS_RUNTIME_BUNDLE_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download runtime bundle (${response.status} ${response.statusText}).`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationTarball));
}

async function githubApiFetchJson(url, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "holaboss-desktop-runtime-stager"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status} ${response.statusText}) for ${url}`);
  }

  return response.json();
}

async function downloadGithubReleaseAsset(url, destinationTarball, token) {
  const headers = {
    Accept: "application/octet-stream",
    "User-Agent": "holaboss-desktop-runtime-stager"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers, redirect: "follow" });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download GitHub release asset (${response.status} ${response.statusText}).`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationTarball));
}

async function stageFromLatestGithubRelease(token) {
  const [owner, repo] = sourceRepo.split("/");
  const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const release = await githubApiFetchJson(releaseUrl, token);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((candidate) => {
    return (
      typeof candidate.name === "string" &&
      candidate.name.startsWith(latestReleaseAssetPrefix) &&
      candidate.name.endsWith(".tar.gz")
    );
  });

  if (!asset) {
    throw new Error(
      `No latest release asset matching ${latestReleaseAssetPrefix}*.tar.gz found in ${sourceRepo}.`
    );
  }

  const releaseTag = typeof release.tag_name === "string" ? release.tag_name : "latest";
  const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "holaboss-runtime-release-"));
  const downloadPath = path.join(downloadDir, asset.name);
  log(`downloading latest GitHub release asset ${asset.name} from release ${releaseTag}`);
  await downloadGithubReleaseAsset(asset.url, downloadPath, token);
  await extractRuntimeTarball(downloadPath);
}

async function validateStageDir() {
  const requiredPaths = [
    path.join(stageDir, "bin", "sandbox-runtime"),
    path.join(stageDir, "package-metadata.json"),
    path.join(stageDir, "runtime", "metadata.json"),
    path.join(stageDir, "runtime", "api-server", "dist", "index.mjs")
  ];

  for (const requiredPath of requiredPaths) {
    if (!(await pathExists(requiredPath))) {
      throw new Error(`Staged runtime is incomplete. Missing ${requiredPath}.`);
    }
  }

  const packageMetadataPath = path.join(stageDir, "package-metadata.json");
  const packageMetadata = JSON.parse(await fs.readFile(packageMetadataPath, "utf-8"));
  const createdAt = packageMetadata.createdAt ?? packageMetadata.created_at ?? "unknown";
  log(`staged runtime ready at ${stageDir} (platform=${packageMetadata.platform}, createdAt=${createdAt})`);
}

async function stageRuntimeBundle() {
  const runtimeDir = process.env.HOLABOSS_RUNTIME_DIR?.trim();
  const runtimeTarball = process.env.HOLABOSS_RUNTIME_TARBALL?.trim();
  const runtimeBundleUrl = process.env.HOLABOSS_RUNTIME_BUNDLE_URL?.trim();
  const githubToken = process.env.HOLABOSS_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();

  await ensureCleanStageDir();

  if (runtimeDir) {
    await copyRuntimeDirectory(path.resolve(runtimeDir));
    await validateStageDir();
    return;
  }

  if (runtimeTarball) {
    await extractRuntimeTarball(path.resolve(runtimeTarball));
    await validateStageDir();
    return;
  }

  if (runtimeBundleUrl) {
    const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "holaboss-runtime-download-"));
    const downloadPath = path.join(downloadDir, `runtime-${runtimePlatform}.tar.gz`);
    await downloadRuntimeTarball(runtimeBundleUrl, downloadPath);
    await extractRuntimeTarball(downloadPath);
    await validateStageDir();
    return;
  }

  try {
    await stageFromLatestGithubRelease(githubToken);
    await validateStageDir();
    return;
  } catch (error) {
    if (!existsSync(defaultLocalRuntimeDir)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    log(`latest release staging failed, falling back to ${defaultLocalRuntimeDir}: ${message}`);
  }

  if (existsSync(defaultLocalRuntimeDir)) {
    await copyRuntimeDirectory(defaultLocalRuntimeDir);
    await validateStageDir();
    return;
  }

  throw new Error(
    "No runtime bundle source found. Set HOLABOSS_RUNTIME_DIR, HOLABOSS_RUNTIME_TARBALL, HOLABOSS_RUNTIME_BUNDLE_URL, or make sure the latest GitHub release asset is reachable."
  );
}

stageRuntimeBundle().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[stage-runtime] ${message}\n`);
  process.exitCode = 1;
});
