import { access } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const desktopRoot = process.cwd();
const runtimeRoot = path.join(desktopRoot, "out", "runtime-macos");
const requiredRuntimePaths = [
  path.join(runtimeRoot, "bin", "sandbox-runtime"),
  path.join(runtimeRoot, "package-metadata.json"),
  path.join(runtimeRoot, "runtime", "metadata.json"),
  path.join(runtimeRoot, "runtime", "api-server", "dist", "index.mjs")
];

async function runtimeBundleExists() {
  try {
    await Promise.all(requiredRuntimePaths.map((targetPath) => access(targetPath)));
    return true;
  } catch {
    return false;
  }
}

if (!(await runtimeBundleExists())) {
  const result = spawnSync("npm", ["run", "prepare:runtime:local"], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: process.env
  });
  process.exit(result.status ?? 1);
}
