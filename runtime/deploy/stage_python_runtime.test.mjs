import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPythonAssetName,
  buildPythonDownloadUrl,
  normalizeRuntimeArch,
  normalizeRuntimePlatform,
  resolvePythonTargetTriple,
  resolvePythonVariants,
} from "./stage_python_runtime.mjs";

test("python runtime helper normalizes supported platforms and architectures", () => {
  assert.equal(normalizeRuntimePlatform("darwin"), "macos");
  assert.equal(normalizeRuntimePlatform("linux"), "linux");
  assert.equal(normalizeRuntimePlatform("win32"), "windows");
  assert.equal(normalizeRuntimeArch("amd64"), "x64");
  assert.equal(normalizeRuntimeArch("aarch64"), "arm64");
});

test("python runtime helper maps target triples by platform and architecture", () => {
  assert.equal(resolvePythonTargetTriple("macos", "arm64"), "aarch64-apple-darwin");
  assert.equal(resolvePythonTargetTriple("macos", "x64"), "x86_64-apple-darwin");
  assert.equal(resolvePythonTargetTriple("linux", "arm64"), "aarch64-unknown-linux-gnu");
  assert.equal(resolvePythonTargetTriple("linux", "x64"), "x86_64-unknown-linux-gnu");
  assert.equal(resolvePythonTargetTriple("windows", "arm64"), "aarch64-pc-windows-msvc");
  assert.equal(resolvePythonTargetTriple("windows", "x64"), "x86_64-pc-windows-msvc");
});

test("python runtime helper builds pinned standalone asset names and download URLs", () => {
  const assetName = buildPythonAssetName({
    pythonVersion: "3.12.13",
    pythonRelease: "20260303",
    targetTriple: "x86_64-unknown-linux-gnu",
    variant: "install_only_stripped",
  });
  assert.equal(
    assetName,
    "cpython-3.12.13+20260303-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
  );
  assert.equal(
    buildPythonDownloadUrl({
      sourceRepo: "astral-sh/python-build-standalone",
      pythonRelease: "20260303",
      assetName,
    }),
    "https://github.com/astral-sh/python-build-standalone/releases/download/20260303/cpython-3.12.13%2B20260303-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
  );
});

test("python runtime helper defaults to stripped then unstripped archives", () => {
  assert.deepEqual(resolvePythonVariants({}), ["install_only_stripped", "install_only"]);
  assert.deepEqual(
    resolvePythonVariants({ HOLABOSS_RUNTIME_PYTHON_VARIANT: "install_only" }),
    ["install_only"],
  );
});
