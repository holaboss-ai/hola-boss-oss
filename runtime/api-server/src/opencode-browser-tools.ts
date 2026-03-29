import fs from "node:fs";
import path from "node:path";

import {
  DESKTOP_BROWSER_TOOL_DEFINITIONS,
  DESKTOP_BROWSER_TOOL_IDS,
  type DesktopBrowserToolId
} from "./desktop-browser-tools.js";

const OPENCODE_PLUGIN_PACKAGE_VERSION = "^1.3.2";
const OPENCODE_PLUGIN_FILE_NAME = "holaboss-desktop-browser.js";

export interface OpencodeBrowserToolsCliRequest {
  workspace_dir: string;
}

export interface OpencodeBrowserToolsCliResponse {
  changed: boolean;
  tool_ids: string[];
}

export interface OpencodeBrowserToolsConfig {
  desktopBrowserEnabled: boolean;
  desktopBrowserUrl: string;
  desktopBrowserAuthToken: string;
}

export interface OpencodeBrowserToolsOptions {
  resolveConfig: () => OpencodeBrowserToolsConfig;
}

function pluginRoot(workspaceDir: string): string {
  return path.resolve(workspaceDir, ".opencode");
}

function pluginFilePath(workspaceDir: string): string {
  return path.join(pluginRoot(workspaceDir), "plugins", OPENCODE_PLUGIN_FILE_NAME);
}

function packageJsonPath(workspaceDir: string): string {
  return path.join(pluginRoot(workspaceDir), "package.json");
}

function browserToolsEnabled(config: OpencodeBrowserToolsConfig): boolean {
  return Boolean(
    config.desktopBrowserEnabled && config.desktopBrowserUrl.trim() && config.desktopBrowserAuthToken.trim()
  );
}

function pluginArgsExpression(toolId: DesktopBrowserToolId): string {
  switch (toolId) {
    case "browser_navigate":
      return "{ url: tool.schema.string() }";
    case "browser_get_state":
      return "{ include_screenshot: tool.schema.boolean().optional() }";
    case "browser_click":
      return "{ index: tool.schema.number().int().positive() }";
    case "browser_type":
      return [
        "{",
        "index: tool.schema.number().int().positive(),",
        "text: tool.schema.string(),",
        "clear: tool.schema.boolean().optional(),",
        "submit: tool.schema.boolean().optional()",
        "}"
      ].join(" ");
    case "browser_press":
      return "{ key: tool.schema.string() }";
    case "browser_scroll":
      return [
        "{",
        "direction: tool.schema.string().optional(),",
        "amount: tool.schema.number().int().positive().optional(),",
        "delta_y: tool.schema.number().int().optional()",
        "}"
      ].join(" ");
    case "browser_screenshot":
      return "{ format: tool.schema.string().optional(), quality: tool.schema.number().int().optional() }";
    case "browser_back":
    case "browser_forward":
    case "browser_reload":
    case "browser_list_tabs":
      return "{}";
  }
}

export function renderOpencodeDesktopBrowserPlugin(): string {
  const toolBlocks = DESKTOP_BROWSER_TOOL_DEFINITIONS.map(
    (toolDef) => `    ${toolDef.id}: tool({
      description: ${JSON.stringify(toolDef.description)},
      args: ${pluginArgsExpression(toolDef.id)},
      async execute(args) {
        return await executeTool(baseUrl, ${JSON.stringify(toolDef.id)}, args);
      },
    })`
  ).join(",\n");

  return [
    `import { tool } from "@opencode-ai/plugin";`,
    ``,
    `const CAPABILITY_STATUS_PATH = "/api/v1/capabilities/browser";`,
    `const CAPABILITY_TOOL_PATH = "/api/v1/capabilities/browser/tools";`,
    ``,
    `function runtimeApiBaseUrl() {`,
    `  return String(process.env.SANDBOX_RUNTIME_API_URL || "").trim().replace(/\\/+$/, "");`,
    `}`,
    ``,
    `function workspaceId() {`,
    `  return String(process.env.HOLABOSS_WORKSPACE_ID || "").trim();`,
    `}`,
    ``,
    `function browserHeaders() {`,
    `  const headers = { "content-type": "application/json; charset=utf-8" };`,
    `  const id = workspaceId();`,
    `  if (id) headers["x-holaboss-workspace-id"] = id;`,
    `  return headers;`,
    `}`,
    ``,
    `async function readJson(response) {`,
    `  const text = await response.text();`,
    `  if (!text.trim()) return {};`,
    `  return JSON.parse(text);`,
    `}`,
    ``,
    `async function fetchStatus(baseUrl) {`,
    `  const response = await fetch(\`\${baseUrl}\${CAPABILITY_STATUS_PATH}\`, { method: "GET", headers: browserHeaders() });`,
    `  const payload = await readJson(response);`,
    `  if (!response.ok) {`,
    `    throw new Error(String(payload.detail || payload.error || "Holaboss browser capability check failed."));`,
    `  }`,
    `  return payload;`,
    `}`,
    ``,
    `function formatToolResult(payload) {`,
    `  if (typeof payload === "string") {`,
    `    return payload;`,
    `  }`,
    `  return JSON.stringify(payload, null, 2);`,
    `}`,
    ``,
    `async function executeTool(baseUrl, toolId, args) {`,
    `  const response = await fetch(\`\${baseUrl}\${CAPABILITY_TOOL_PATH}/\${toolId}\`, {`,
    `    method: "POST",`,
    `    headers: browserHeaders(),`,
    `    body: JSON.stringify(args || {})`,
    `  });`,
    `  const payload = await readJson(response);`,
    `  if (!response.ok) {`,
    `    throw new Error(String(payload.detail || payload.error || \`Holaboss browser tool '\${toolId}' failed.\`));`,
    `  }`,
    `  return formatToolResult(payload);`,
    `}`,
    ``,
    `export const HolabossDesktopBrowserPlugin = async () => {`,
    `  const baseUrl = runtimeApiBaseUrl();`,
    `  if (!baseUrl) {`,
    `    return {};`,
    `  }`,
    `  try {`,
    `    const status = await fetchStatus(baseUrl);`,
    `    if (status.available !== true) {`,
    `      return {};`,
    `    }`,
    `  } catch {`,
    `    return {};`,
    `  }`,
    `  return {`,
    `    tool: {`,
    toolBlocks,
    `    }`,
    `  };`,
    `};`,
    ""
  ].join("\n");
}

function readJsonFile(targetPath: string): Record<string, unknown> | null {
  if (!fs.existsSync(targetPath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${targetPath} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function ensurePluginDependency(workspaceDir: string): boolean {
  const targetPath = packageJsonPath(workspaceDir);
  const existing = readJsonFile(targetPath) ?? {};
  const nextPayload: Record<string, unknown> = { ...existing };
  const existingDependencies =
    nextPayload.dependencies && typeof nextPayload.dependencies === "object" && !Array.isArray(nextPayload.dependencies)
      ? { ...(nextPayload.dependencies as Record<string, unknown>) }
      : {};
  const currentVersion = String(existingDependencies["@opencode-ai/plugin"] ?? "").trim();
  if (currentVersion === OPENCODE_PLUGIN_PACKAGE_VERSION) {
    return false;
  }
  existingDependencies["@opencode-ai/plugin"] = OPENCODE_PLUGIN_PACKAGE_VERSION;
  nextPayload.dependencies = existingDependencies;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf8");
  return true;
}

function writePluginFile(workspaceDir: string, source: string): boolean {
  const targetPath = pluginFilePath(workspaceDir);
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
  if (existing === source) {
    return false;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, source, "utf8");
  return true;
}

function removePluginFile(workspaceDir: string): boolean {
  const targetPath = pluginFilePath(workspaceDir);
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  fs.rmSync(targetPath, { force: true });
  const pluginsDir = path.dirname(targetPath);
  if (fs.existsSync(pluginsDir) && fs.readdirSync(pluginsDir).length === 0) {
    fs.rmdirSync(pluginsDir);
  }
  return true;
}

export function stageOpencodeDesktopBrowserPlugin(
  request: OpencodeBrowserToolsCliRequest,
  options: OpencodeBrowserToolsOptions
): OpencodeBrowserToolsCliResponse {
  const browserEnabled = browserToolsEnabled(options.resolveConfig());
  const workspaceDir = path.resolve(request.workspace_dir);

  if (!browserEnabled) {
    return {
      changed: removePluginFile(workspaceDir),
      tool_ids: []
    };
  }

  const pluginChanged = writePluginFile(workspaceDir, renderOpencodeDesktopBrowserPlugin());
  const packageChanged = ensurePluginDependency(workspaceDir);
  return {
    changed: pluginChanged || packageChanged,
    tool_ids: [...DESKTOP_BROWSER_TOOL_IDS]
  };
}
