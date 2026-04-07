#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(runtimeRoot, "..");

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function copyIfPresent(sourcePath, destinationPath) {
  if (!existsSync(sourcePath)) {
    return;
  }
  cpSync(sourcePath, destinationPath, { recursive: true });
}

function runCommand(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options
  });
}

export function resolveRuntimeVersion() {
  const packageJsonPath = path.join(runtimeRoot, "api-server", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const version = typeof packageJson.version === "string" ? packageJson.version.trim() : "";
  if (!version) {
    throw new Error("failed to resolve runtime version from runtime/api-server/package.json");
  }
  return version;
}

function resolveGitSha() {
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    }).trim();
  } catch {
    return "unknown";
  }
}

function stageNodePackage(outputRoot, packageDir, outputName) {
  if (!existsSync(path.join(packageDir, "package.json"))) {
    return;
  }

  const targetDir = path.join(outputRoot, outputName);
  mkdirSync(targetDir, { recursive: true });
  copyIfPresent(path.join(packageDir, "package.json"), path.join(targetDir, "package.json"));
  copyIfPresent(path.join(packageDir, "package-lock.json"), path.join(targetDir, "package-lock.json"));
  copyIfPresent(path.join(packageDir, "tsconfig.json"), path.join(targetDir, "tsconfig.json"));
  copyIfPresent(path.join(packageDir, "tsup.config.ts"), path.join(targetDir, "tsup.config.ts"));
  copyIfPresent(path.join(packageDir, "src"), path.join(targetDir, "src"));

  runCommand(npmCommand(), ["ci"], { cwd: targetDir });
  runCommand(npmCommand(), ["run", "build"], { cwd: targetDir });
  runCommand(npmCommand(), ["prune", "--omit=dev"], { cwd: targetDir });

  rmSync(path.join(targetDir, "src"), { recursive: true, force: true });
  rmSync(path.join(targetDir, "tsconfig.json"), { force: true });
  rmSync(path.join(targetDir, "tsup.config.ts"), { force: true });
}

function stageSourcePackage(outputRoot, packageDir, outputName) {
  if (!existsSync(path.join(packageDir, "package.json"))) {
    return;
  }

  const targetDir = path.join(outputRoot, outputName);
  mkdirSync(targetDir, { recursive: true });
  copyIfPresent(path.join(packageDir, "package.json"), path.join(targetDir, "package.json"));
  copyIfPresent(path.join(packageDir, "src"), path.join(targetDir, "src"));
}

export function buildRuntimeRoot(outputRootArg = path.join(repoRoot, "out", "runtime-root")) {
  const outputRoot = path.resolve(outputRootArg);
  const runtimeVersion = resolveRuntimeVersion();
  const metadata = {
    runtime_version: runtimeVersion,
    runtime_schema_version: process.env.HOLABOSS_RUNTIME_SCHEMA_VERSION?.trim() || "1",
    git_sha: resolveGitSha(),
    build_id: process.env.HOLABOSS_RUNTIME_BUILD_ID?.trim() || "local",
    built_at_utc: new Date().toISOString(),
    source_path: "runtime"
  };

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  stageSourcePackage(outputRoot, path.join(runtimeRoot, "harnesses"), "harnesses");
  stageNodePackage(outputRoot, path.join(runtimeRoot, "harness-host"), "harness-host");
  stageNodePackage(outputRoot, path.join(runtimeRoot, "state-store"), "state-store");
  stageNodePackage(outputRoot, path.join(runtimeRoot, "api-server"), "api-server");
  copyIfPresent(path.join(scriptDir, "bootstrap"), path.join(outputRoot, "bootstrap"));

  writeFileSync(path.join(outputRoot, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  console.error(`assembled runtime root at ${outputRoot}`);
  return outputRoot;
}

function isDirectRun() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  buildRuntimeRoot(process.argv[2]);
}
