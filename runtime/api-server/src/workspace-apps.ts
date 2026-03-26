import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

const APP_HTTP_PORT_BASE = 18080;
const APP_MCP_PORT_BASE = 13100;

type StringMap = Record<string, unknown>;

export type ParsedInstalledApp = {
  appId: string;
  configPath: string;
  lifecycle: {
    setup: string;
    start: string;
    stop: string;
  };
};

export type ResolvedApplicationRuntime = {
  appId: string;
  mcp: {
    transport: string;
    port: number;
    path: string;
  };
  healthCheck: {
    path: string;
    timeoutS: number;
    intervalS: number;
  };
  envContract: string[];
  startCommand: string;
  baseDir: string;
  lifecycle: {
    setup: string;
    start: string;
    stop: string;
  };
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
};

export type ResolvedWorkspaceApp = {
  appId: string;
  configPath: string;
  appDir: string;
  index: number;
  ports: {
    http: number;
    mcp: number;
  };
};

export type ResolvedWorkspaceAppRuntime = ResolvedWorkspaceApp & {
  resolvedApp: ResolvedApplicationRuntime;
};

export type WorkspaceComposeShutdownTarget = {
  appId: string;
  appDir: string;
};

export class WorkspaceAppsError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is StringMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function portsForAppIndex(index: number): { http: number; mcp: number } {
  return {
    http: APP_HTTP_PORT_BASE + index,
    mcp: APP_MCP_PORT_BASE + index
  };
}

export function readWorkspaceYamlDocument(workspaceDir: string): Record<string, unknown> {
  const workspaceYamlPath = path.join(workspaceDir, "workspace.yaml");
  if (!fs.existsSync(workspaceYamlPath)) {
    return {};
  }
  const loaded = yaml.load(fs.readFileSync(workspaceYamlPath, "utf8"));
  return isRecord(loaded) ? loaded : {};
}

export function writeWorkspaceYamlDocument(workspaceDir: string, document: Record<string, unknown>): void {
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    yaml.dump(document, { sortKeys: false, noRefs: true }),
    "utf8"
  );
}

export function updateWorkspaceApplications(
  workspaceDir: string,
  updater: (applications: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
): void {
  const document = readWorkspaceYamlDocument(workspaceDir);
  const currentApplications = Array.isArray(document.applications) ? document.applications.filter(isRecord) : [];
  document.applications = updater([...currentApplications]);
  writeWorkspaceYamlDocument(workspaceDir, document);
}

export function removeWorkspaceApplication(workspaceDir: string, appId: string): void {
  updateWorkspaceApplications(workspaceDir, (applications) =>
    applications.filter((entry) => entry.app_id !== appId)
  );
}

export function listWorkspaceApplications(workspaceDir: string): Array<Record<string, unknown>> {
  const document = readWorkspaceYamlDocument(workspaceDir);
  return Array.isArray(document.applications) ? document.applications.filter(isRecord) : [];
}

export function parseInstalledAppRuntime(
  rawYaml: string,
  declaredAppId: string,
  configPath: string
): ParsedInstalledApp {
  const resolved = parseResolvedAppRuntime(rawYaml, declaredAppId, configPath);
  return {
    appId: resolved.appId,
    configPath,
    lifecycle: { ...resolved.lifecycle }
  };
}

export function parseResolvedAppRuntime(
  rawYaml: string,
  declaredAppId: string,
  configPath: string
): ResolvedApplicationRuntime {
  let loaded: unknown;
  try {
    loaded = yaml.load(rawYaml);
  } catch (error) {
    throw new Error(`invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(loaded)) {
    throw new Error("app.runtime.yaml must be a mapping");
  }
  const yamlAppId = String(loaded.app_id ?? "");
  if (yamlAppId !== declaredAppId) {
    throw new Error(`app_id in yaml ('${yamlAppId}') does not match declared app_id ('${declaredAppId}')`);
  }
  const mcp = isRecord(loaded.mcp) ? loaded.mcp : null;
  if (mcp?.port === undefined || mcp.port === null || Number.isNaN(Number(mcp.port))) {
    throw new Error(`mcp.port is required (${configPath})`);
  }
  const healthchecks = isRecord(loaded.healthchecks) ? loaded.healthchecks : null;
  const preferredHealthcheck =
    (healthchecks && (isRecord(healthchecks.mcp) ? healthchecks.mcp : null)) ||
    (healthchecks && (isRecord(healthchecks.api) ? healthchecks.api : null)) ||
    (healthchecks
      ? Object.values(healthchecks).find((entry) => isRecord(entry)) as StringMap | undefined
      : undefined);
  const lifecycle = isRecord(loaded.lifecycle) ? loaded.lifecycle : {};
  const envContract = Array.isArray(loaded.env_contract) ? loaded.env_contract.filter((value) => typeof value === "string") : [];
  const rawTools = Array.isArray(loaded.tools) ? loaded.tools : [];
  const tools = rawTools.filter(isRecord).map((tool) => ({
    name: typeof tool.name === "string" ? tool.name : "",
    description: typeof tool.description === "string" ? tool.description : "",
    parameters: isRecord(tool.parameters) ? tool.parameters : {},
  }));
  const configDir = path.posix.dirname(configPath);
  return {
    appId: declaredAppId,
    mcp: {
      transport: typeof mcp.transport === "string" ? mcp.transport : "http-sse",
      port: Number(mcp.port),
      path: typeof mcp.path === "string" ? mcp.path : "/mcp"
    },
    healthCheck: {
      path: preferredHealthcheck && typeof preferredHealthcheck.path === "string" ? preferredHealthcheck.path : "/health",
      timeoutS:
        preferredHealthcheck && preferredHealthcheck.timeout_s !== undefined && !Number.isNaN(Number(preferredHealthcheck.timeout_s))
          ? Number(preferredHealthcheck.timeout_s)
          : 60,
      intervalS:
        preferredHealthcheck && preferredHealthcheck.interval_s !== undefined && !Number.isNaN(Number(preferredHealthcheck.interval_s))
          ? Number(preferredHealthcheck.interval_s)
          : 5
    },
    envContract,
    startCommand: typeof loaded.start === "string" ? loaded.start : "",
    baseDir: configDir === "." ? "." : configDir,
    lifecycle: {
      setup: typeof lifecycle.setup === "string" ? lifecycle.setup : "",
      start: typeof lifecycle.start === "string" ? lifecycle.start : "",
      stop: typeof lifecycle.stop === "string" ? lifecycle.stop : ""
    },
    tools
  };
}

export function appendWorkspaceApplication(
  workspaceDir: string,
  params: { appId: string; configPath: string; lifecycle?: Record<string, string> | null }
): void {
  updateWorkspaceApplications(workspaceDir, (applications) => {
    if (applications.some((entry) => entry.app_id === params.appId)) {
      return applications;
    }
    const nextEntry: Record<string, unknown> = {
      app_id: params.appId,
      config_path: params.configPath
    };
    if (params.lifecycle && Object.keys(params.lifecycle).length > 0) {
      nextEntry.lifecycle = params.lifecycle;
    }
    applications.push(nextEntry);
    return applications;
  });
}

export function resolveWorkspaceApp(workspaceDir: string, targetAppId: string): ResolvedWorkspaceApp {
  const workspaceYamlPath = path.join(workspaceDir, "workspace.yaml");
  if (!fs.existsSync(workspaceYamlPath)) {
    throw new WorkspaceAppsError(404, "workspace.yaml not found");
  }
  const applications = listWorkspaceApplications(workspaceDir);
  for (const [index, entry] of applications.entries()) {
    const appId = typeof entry.app_id === "string" ? entry.app_id : "";
    if (appId !== targetAppId) {
      continue;
    }
    const configPath = typeof entry.config_path === "string" ? entry.config_path : "";
    if (!configPath) {
      throw new WorkspaceAppsError(400, `app '${targetAppId}' is missing config_path`);
    }
    return {
      appId,
      configPath,
      appDir: path.join(workspaceDir, configPath ? path.dirname(configPath) : path.join("apps", appId)),
      index,
      ports: portsForAppIndex(index)
    };
  }
  throw new WorkspaceAppsError(404, `app '${targetAppId}' not found in workspace.yaml`);
}

export function resolveWorkspaceAppRuntime(workspaceDir: string, targetAppId: string): ResolvedWorkspaceAppRuntime {
  const resolved = resolveWorkspaceApp(workspaceDir, targetAppId);
  const fullPath = path.join(workspaceDir, resolved.configPath);
  if (!fs.existsSync(fullPath)) {
    throw new WorkspaceAppsError(404, `app config not found: '${resolved.configPath}'`);
  }
  return {
    ...resolved,
    resolvedApp: parseResolvedAppRuntime(fs.readFileSync(fullPath, "utf8"), resolved.appId, resolved.configPath)
  };
}

export function listWorkspaceApplicationPorts(workspaceDir: string): Record<string, { http: number; mcp: number }> {
  const result: Record<string, { http: number; mcp: number }> = {};
  for (const [index, entry] of listWorkspaceApplications(workspaceDir).entries()) {
    const appId = typeof entry.app_id === "string" ? entry.app_id : "";
    if (!appId) {
      continue;
    }
    result[appId] = portsForAppIndex(index);
  }
  return result;
}

export function listWorkspaceComposeShutdownTargets(workspaceDir: string): WorkspaceComposeShutdownTarget[] {
  const targets: WorkspaceComposeShutdownTarget[] = [];
  for (const entry of listWorkspaceApplications(workspaceDir)) {
    const appId = typeof entry.app_id === "string" ? entry.app_id : "";
    if (!appId) {
      continue;
    }
    const configPath = typeof entry.config_path === "string" ? entry.config_path : "";
    const appDir = path.join(workspaceDir, configPath ? path.dirname(configPath) : path.join("apps", appId));
    if (
      fs.existsSync(path.join(appDir, "docker-compose.yml")) ||
      fs.existsSync(path.join(appDir, "docker-compose.yaml"))
    ) {
      targets.push({ appId, appDir });
    }
  }
  return targets;
}

export function listWorkspaceToolSchemas(workspaceDir: string): Array<{
  appId: string;
  mcpPort: number;
  mcpPath: string;
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}> {
  const applications = listWorkspaceApplications(workspaceDir);
  const result: Array<{
    appId: string;
    mcpPort: number;
    mcpPath: string;
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  }> = [];

  for (const entry of applications) {
    const appId = typeof entry.app_id === "string" ? entry.app_id : "";
    const configPath = typeof entry.config_path === "string" ? entry.config_path : "";
    if (!appId || !configPath) continue;

    const fullConfigPath = path.join(workspaceDir, configPath);
    if (!fs.existsSync(fullConfigPath)) continue;

    try {
      const rawYaml = fs.readFileSync(fullConfigPath, "utf-8");
      const resolved = parseResolvedAppRuntime(rawYaml, appId, configPath);
      if (resolved.tools && resolved.tools.length > 0) {
        result.push({
          appId: resolved.appId,
          mcpPort: resolved.mcp.port,
          mcpPath: resolved.mcp.path,
          tools: resolved.tools,
        });
      }
    } catch {
      // Skip apps with invalid config
    }
  }

  return result;
}
