import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const desktopRoot = process.cwd();
const repoRoot = path.resolve(desktopRoot, "..");
const runtimeRoot = path.join(desktopRoot, "out", "runtime-macos");
const requiredRuntimePaths = [
  path.join(runtimeRoot, "bin", "sandbox-runtime"),
  path.join(runtimeRoot, "package-metadata.json"),
  path.join(runtimeRoot, "node-runtime", "node_modules", ".bin", "node"),
  path.join(runtimeRoot, "runtime", "metadata.json"),
  path.join(runtimeRoot, "runtime", "api-server", "dist", "index.mjs")
];
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
  path.join(repoRoot, "runtime", "deploy", "build_runtime_root.sh"),
  path.join(repoRoot, "runtime", "deploy", "package_macos_runtime.sh")
];

async function runtimeBundleExists() {
  try {
    await Promise.all(requiredRuntimePaths.map((targetPath) => access(targetPath)));
    return true;
  } catch {
    return false;
  }
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
const bundleStale = bundleExists ? await runtimeBundleIsStale() : true;

if (!bundleExists || bundleStale) {
  if (bundleStale && bundleExists) {
    console.log("[ensure-runtime-bundle] runtime bundle is older than local runtime sources; rebuilding.");
  }
  const result = spawnSync("npm", ["run", "prepare:runtime:local"], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: process.env
  });
  process.exit(result.status ?? 1);
}
