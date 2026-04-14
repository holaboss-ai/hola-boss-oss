import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { resolveRuntimePlatform, runtimeBundleDirName } from "./runtime-bundle.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const outputDir = path.join(desktopRoot, "out");
const outputPath = path.join(outputDir, "holaboss-config.json");
const runtimePlatform = resolveRuntimePlatform();
const runtimeBundleRoot = path.join(outputDir, runtimeBundleDirName(runtimePlatform));
const runtimeMetadataPath = path.join(runtimeBundleRoot, "runtime", "metadata.json");
const runtimePackageMetadataPath = path.join(runtimeBundleRoot, "package-metadata.json");

async function loadDesktopEnvDefaults() {
  const envCandidates = [
    path.join(desktopRoot, ".env"),
    path.join(desktopRoot, ".env.production")
  ];
  const parsed = {};
  for (const envPath of envCandidates) {
    if (!existsSync(envPath)) {
      continue;
    }
    try {
      Object.assign(parsed, dotenv.parse(await fs.readFile(envPath, "utf8")));
    } catch {
      // Ignore malformed optional env files; explicit process env still applies.
    }
  }
  return parsed;
}

async function loadRuntimeToolchainManifest() {
  const [runtimeMetadataRaw, packageMetadataRaw] = await Promise.all([
    fs.readFile(runtimeMetadataPath, "utf8"),
    fs.readFile(runtimePackageMetadataPath, "utf8"),
  ]);
  const runtimeMetadata = JSON.parse(runtimeMetadataRaw);
  const packageMetadata = JSON.parse(packageMetadataRaw);

  const runtimeVersion =
    typeof runtimeMetadata.runtime_version === "string"
      ? runtimeMetadata.runtime_version.trim()
      : "";
  const toolchainId =
    typeof packageMetadata.toolchain_id === "string"
      ? packageMetadata.toolchain_id.trim()
      : "";
  if (!runtimeVersion || !toolchainId) {
    throw new Error(
      `Runtime metadata under ${runtimeBundleRoot} is incomplete. Run the matching prepare:runtime command before packaging.`,
    );
  }

  return {
    runtimeVersion,
    runtimeSchemaVersion:
      typeof runtimeMetadata.runtime_schema_version === "string"
        ? runtimeMetadata.runtime_schema_version.trim() || null
        : null,
    platform: runtimePlatform,
    toolchainId,
    nodeVersion:
      typeof packageMetadata.bundled_node_version === "string"
        ? packageMetadata.bundled_node_version.trim() || null
        : null,
    npmVersion:
      typeof packageMetadata.bundled_npm_version === "string"
        ? packageMetadata.bundled_npm_version.trim() || null
        : null,
    pythonVersion:
      typeof packageMetadata.bundled_python_version === "string"
        ? packageMetadata.bundled_python_version.trim() || null
        : null,
    pythonTarget:
      typeof packageMetadata.bundled_python_target === "string"
        ? packageMetadata.bundled_python_target.trim() || null
        : null,
  };
}

const desktopEnvDefaults = await loadDesktopEnvDefaults();
const toolchainManifest = await loadRuntimeToolchainManifest();

function resolveEnvValue(...names) {
  for (const name of names) {
    const fromProcess = process.env[name]?.trim();
    if (fromProcess) {
      return fromProcess;
    }
    const fromFile = desktopEnvDefaults[name]?.trim();
    if (fromFile) {
      return fromFile;
    }
  }
  return "";
}

const config = {
  authBaseUrl: resolveEnvValue("HOLABOSS_AUTH_BASE_URL"),
  authSignInUrl: resolveEnvValue("HOLABOSS_AUTH_SIGN_IN_URL"),
  backendBaseUrl: resolveEnvValue("HOLABOSS_BACKEND_BASE_URL"),
  desktopControlPlaneBaseUrl: resolveEnvValue(
    "HOLABOSS_DESKTOP_CONTROL_PLANE_BASE_URL"
  ),
  projectsUrl: resolveEnvValue(
    "HOLABOSS_PROJECTS_URL",
    "HOLABOSS_CLI_PROJECTS_URL"
  ),
  marketplaceUrl: resolveEnvValue(
    "HOLABOSS_MARKETPLACE_URL",
    "HOLABOSS_CLI_MARKETPLACE_URL"
  ),
  proactiveUrl: resolveEnvValue(
    "HOLABOSS_PROACTIVE_URL",
    "HOLABOSS_CLI_PROACTIVE_URL"
  ),
  toolchainManifest,
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

process.stdout.write(`[packaged-config] wrote ${outputPath}\n`);
