import { access, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  localRuntimePackagerFileNames,
  resolveRuntimePlatform,
  runtimeBundleDirName,
  runtimeBundleRequiredPathGroups
} from "./runtime-bundle.mjs";

const desktopRoot = process.cwd();
const repoRoot = path.resolve(desktopRoot, "..");
const runtimePlatform = resolveRuntimePlatform();
const runtimeRoot = path.join(desktopRoot, "out", runtimeBundleDirName(runtimePlatform));
const requiredRuntimePathGroups = runtimeBundleRequiredPathGroups(runtimePlatform).map((relativePaths) =>
  relativePaths.map((relativePath) => path.join(runtimeRoot, relativePath))
);
const localPackagerPath = localRuntimePackagerFileNames(runtimePlatform)
  .map((fileName) => path.join(repoRoot, "runtime", "deploy", fileName))
  .find((candidatePath) => existsSync(candidatePath));
const canPrepareLocalRuntime = Boolean(localPackagerPath);
const runtimeSourceInputs = [
  path.join(repoRoot, "runtime", "api-server", "src"),
  path.join(repoRoot, "runtime", "api-server", "package.json"),
  path.join(repoRoot, "runtime", "api-server", "package-lock.json"),
  path.join(repoRoot, "runtime", "api-server", "tsconfig.json"),
  path.join(repoRoot, "runtime", "api-server", "tsup.config.ts"),
  path.join(repoRoot, "runtime", "state-store", "src"),
  path.join(repoRoot, "runtime", "state-store", "package.json"),
  path.join(repoRoot, "runtime", "state-store", "package-lock.json"),
  path.join(repoRoot, "runtime", "state-store", "tsconfig.json"),
  path.join(repoRoot, "runtime", "state-store", "tsup.config.ts"),
  path.join(repoRoot, "runtime", "harness-host", "src"),
  path.join(repoRoot, "runtime", "harness-host", "package.json"),
  path.join(repoRoot, "runtime", "harness-host", "package-lock.json"),
  path.join(repoRoot, "runtime", "harness-host", "tsconfig.json"),
  path.join(repoRoot, "runtime", "harness-host", "tsup.config.ts"),
  path.join(repoRoot, "runtime", "harnesses", "src"),
  path.join(repoRoot, "runtime", "harnesses", "package.json"),
  path.join(repoRoot, "runtime", "deploy", "bootstrap"),
  path.join(repoRoot, "runtime", "deploy", "build_runtime_root.mjs"),
  path.join(repoRoot, "runtime", "deploy", "build_runtime_root.sh"),
  path.join(repoRoot, "runtime", "deploy", "prune_packaged_tree.mjs"),
  path.join(repoRoot, "runtime", "deploy", "prune_packaged_tree.sh"),
  localPackagerPath
];

async function firstAccessiblePath(paths) {
  for (const targetPath of paths) {
    try {
      await access(targetPath);
      return targetPath;
    } catch {
      // Continue looking for a valid path in the requirement group.
    }
  }
  return null;
}

async function runtimeBundleExists() {
  for (const requiredPaths of requiredRuntimePathGroups) {
    if (!(await firstAccessiblePath(requiredPaths))) {
      return false;
    }
  }
  return true;
}

async function newestMtime(targetPath) {
  const details = await stat(targetPath);
  if (!details.isDirectory()) {
    return details.mtimeMs;
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  let newest = details.mtimeMs;
  for (const entry of entries) {
    newest = Math.max(newest, await newestMtime(path.join(targetPath, entry.name)));
  }
  return newest;
}

async function runtimeBundleIsStale() {
  const bundleStamp = await newestMtime(path.join(runtimeRoot, "package-metadata.json"));
  let sourceStamp = 0;
  for (const inputPath of runtimeSourceInputs) {
    try {
      sourceStamp = Math.max(sourceStamp, await newestMtime(inputPath));
    } catch {
      // ignore optional or missing inputs
    }
  }
  return sourceStamp > bundleStamp;
}

const bundleExists = await runtimeBundleExists();
const bundleStale = canPrepareLocalRuntime && bundleExists ? await runtimeBundleIsStale() : false;

if (!bundleExists || bundleStale) {
  if (bundleStale && bundleExists) {
    console.log("[ensure-runtime-bundle] runtime bundle is older than local runtime sources; rebuilding.");
  }
  const prepareScript = canPrepareLocalRuntime ? "prepare:runtime:local" : "prepare:runtime";
  const result = spawnSync("npm", ["run", prepareScript], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      HOLABOSS_RUNTIME_PLATFORM: runtimePlatform,
    }
  });
  process.exit(result.status ?? 1);
}
