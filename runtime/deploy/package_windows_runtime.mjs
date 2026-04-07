#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRuntimeRoot } from "./build_runtime_root.mjs";
import { prunePackagedTree } from "./prune_packaged_tree.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(runtimeRoot, "..");

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function assertWindowsHost() {
  if (process.platform !== "win32") {
    throw new Error("package_windows_runtime.mjs must run on Windows to produce a native Windows runtime bundle.");
  }
}

function firstExistingPath(paths) {
  for (const candidatePath of paths) {
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

function bundledNodeCandidates(outputRoot) {
  return [
    path.join(outputRoot, "node-runtime", "node_modules", ".bin", "node.exe"),
    path.join(outputRoot, "node-runtime", "node_modules", "node", "bin", "node.exe"),
    path.join(outputRoot, "node-runtime", "node_modules", ".bin", "node.cmd")
  ];
}

function bundledNpmCandidates(outputRoot) {
  return [
    path.join(outputRoot, "node-runtime", "node_modules", ".bin", "npm.cmd"),
    path.join(outputRoot, "node-runtime", "node_modules", ".bin", "npm"),
    path.join(outputRoot, "node-runtime", "node_modules", "npm", "bin", "npm-cli.js")
  ];
}

function resolveNodeVersion() {
  return process.env.HOLABOSS_RUNTIME_NODE_VERSION?.trim() || process.versions.node;
}

function resolveNpmVersion() {
  const explicitVersion = process.env.HOLABOSS_RUNTIME_NPM_VERSION?.trim();
  if (explicitVersion) {
    return explicitVersion;
  }
  return execFileSync(npmCommand(), ["--version"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8"
  }).trim();
}

export function buildWindowsRuntimeLauncherSource() {
  return `import { startWindowsRuntime } from "../runtime/bootstrap/windows.mjs";

try {
  const exitCode = await startWindowsRuntime(process.argv.slice(2));
  process.exit(typeof exitCode === "number" ? exitCode : 0);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(\`\${message}\\n\`);
  process.exit(1);
}
`;
}

export function buildWindowsRuntimeCmdLauncherSource() {
  return `@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "BUNDLE_ROOT=%%~fI"
set "BUNDLED_NODE_BIN=%BUNDLE_ROOT%\\node-runtime\\node_modules\\.bin\\node.exe"
if not exist "%BUNDLED_NODE_BIN%" set "BUNDLED_NODE_BIN=%BUNDLE_ROOT%\\node-runtime\\node_modules\\node\\bin\\node.exe"
if not exist "%BUNDLED_NODE_BIN%" (
  >&2 echo bundled node runtime not found under "%BUNDLE_ROOT%\\node-runtime"
  exit /b 1
)
"%BUNDLED_NODE_BIN%" "%SCRIPT_DIR%sandbox-runtime.mjs" %*
`;
}

export function packageWindowsRuntime(
  outputRootArg = path.join(repoRoot, "out", "runtime-windows")
) {
  assertWindowsHost();

  const outputRoot = path.resolve(outputRootArg);
  const stagingRoot = mkdtempSync(path.join(os.tmpdir(), "holaboss-runtime-windows."));
  const runtimeStagingRoot = path.join(stagingRoot, "runtime-root");
  const runtimeOutputRoot = path.join(outputRoot, "runtime");
  const nodeRuntimeDir = path.join(outputRoot, "node-runtime");
  const binDir = path.join(outputRoot, "bin");
  const packageMetadataPath = path.join(outputRoot, "package-metadata.json");
  const skipNodeDeps = process.env.HOLABOSS_SKIP_NODE_DEPS?.trim() === "1";
  const nodeVersion = resolveNodeVersion();
  const npmVersion = resolveNpmVersion();

  try {
    buildRuntimeRoot(runtimeStagingRoot);

    rmSync(outputRoot, { recursive: true, force: true });
    mkdirSync(outputRoot, { recursive: true });
    cpSync(runtimeStagingRoot, runtimeOutputRoot, { recursive: true });
    prunePackagedTree(runtimeOutputRoot, "windows");

    mkdirSync(binDir, { recursive: true });
    if (!skipNodeDeps) {
      mkdirSync(nodeRuntimeDir, { recursive: true });
      execFileSync(npmCommand(), ["install", "--prefix", nodeRuntimeDir, `node@${nodeVersion}`, `npm@${npmVersion}`], {
        stdio: "inherit",
        env: process.env
      });
      prunePackagedTree(nodeRuntimeDir, "windows");
    }

    writeFileSync(path.join(binDir, "sandbox-runtime.mjs"), buildWindowsRuntimeLauncherSource());
    writeFileSync(path.join(binDir, "sandbox-runtime.cmd"), buildWindowsRuntimeCmdLauncherSource());

    const bundledNodeBin = firstExistingPath(bundledNodeCandidates(outputRoot));
    const bundledNpmBin = firstExistingPath(bundledNpmCandidates(outputRoot));
    const packageMetadata = {
      platform: "windows",
      node_deps_installed: !skipNodeDeps,
      bundled_node_bin: Boolean(bundledNodeBin),
      bundled_node_version: skipNodeDeps ? null : nodeVersion,
      bundled_npm_bin: Boolean(bundledNpmBin),
      bundled_npm_version: skipNodeDeps ? null : npmVersion
    };
    writeFileSync(packageMetadataPath, `${JSON.stringify(packageMetadata, null, 2)}\n`);

    console.error(`packaged Windows runtime bundle at ${outputRoot}`);
    return outputRoot;
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function isDirectRun() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  packageWindowsRuntime(process.argv[2]);
}
