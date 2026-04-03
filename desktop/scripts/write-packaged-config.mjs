import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const outputDir = path.join(desktopRoot, "out");
const outputPath = path.join(outputDir, "holaboss-config.json");

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

const desktopEnvDefaults = await loadDesktopEnvDefaults();

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
  )
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

process.stdout.write(`[packaged-config] wrote ${outputPath}\n`);
