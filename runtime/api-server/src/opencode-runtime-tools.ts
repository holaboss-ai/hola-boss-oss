import fs from "node:fs";
import path from "node:path";

import {
  RUNTIME_AGENT_TOOL_DEFINITIONS,
  RUNTIME_AGENT_TOOL_IDS,
  type RuntimeAgentToolId
} from "../../harnesses/src/runtime-agent-tools.js";

const OPENCODE_PLUGIN_PACKAGE_VERSION = "^1.3.2";
const OPENCODE_PLUGIN_FILE_NAME = "holaboss-runtime-tools.js";

export interface OpencodeRuntimeToolsCliRequest {
  workspace_dir: string;
}

export interface OpencodeRuntimeToolsCliResponse {
  changed: boolean;
  tool_ids: string[];
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

function toolArgsExpression(toolId: RuntimeAgentToolId): string {
  switch (toolId) {
    case "holaboss_onboarding_status":
      return "{}";
    case "holaboss_onboarding_complete":
      return [
        "{",
        "summary: tool.schema.string(),",
        "requested_by: tool.schema.string().optional()",
        "}"
      ].join(" ");
    case "holaboss_cronjobs_list":
      return "{ enabled_only: tool.schema.boolean().optional() }";
    case "holaboss_cronjobs_get":
    case "holaboss_cronjobs_delete":
      return "{ job_id: tool.schema.string() }";
    case "holaboss_cronjobs_create":
      return [
        "{",
        "cron: tool.schema.string(),",
        "description: tool.schema.string(),",
        "initiated_by: tool.schema.string().optional(),",
        "name: tool.schema.string().optional(),",
        "enabled: tool.schema.boolean().optional(),",
        "delivery_channel: tool.schema.string().optional(),",
        "delivery_mode: tool.schema.string().optional(),",
        "delivery_to: tool.schema.string().optional(),",
        "metadata_json: tool.schema.string().optional()",
        "}"
      ].join(" ");
    case "holaboss_cronjobs_update":
      return [
        "{",
        "job_id: tool.schema.string(),",
        "name: tool.schema.string().optional(),",
        "cron: tool.schema.string().optional(),",
        "description: tool.schema.string().optional(),",
        "enabled: tool.schema.boolean().optional(),",
        "delivery_channel: tool.schema.string().optional(),",
        "delivery_mode: tool.schema.string().optional(),",
        "delivery_to: tool.schema.string().optional(),",
        "metadata_json: tool.schema.string().optional()",
        "}"
      ].join(" ");
  }
}

export function renderOpencodeRuntimeToolsPlugin(): string {
  const toolBlocks = RUNTIME_AGENT_TOOL_DEFINITIONS.map(
    (toolDef) => `    ${toolDef.id}: tool({
      description: ${JSON.stringify(toolDef.description)},
      args: ${toolArgsExpression(toolDef.id)},
      async execute(args) {
        return await executeTool(baseUrl, ${JSON.stringify(toolDef.id)}, args);
      },
    })`
  ).join(",\n");

  return [
    `import { tool } from "@opencode-ai/plugin";`,
    ``,
    `const CAPABILITY_STATUS_PATH = "/api/v1/capabilities/runtime-tools";`,
    `const ONBOARDING_STATUS_PATH = "/api/v1/capabilities/runtime-tools/onboarding/status";`,
    `const ONBOARDING_COMPLETE_PATH = "/api/v1/capabilities/runtime-tools/onboarding/complete";`,
    `const CRONJOBS_PATH = "/api/v1/capabilities/runtime-tools/cronjobs";`,
    ``,
    `function runtimeApiBaseUrl() {`,
    `  return String(process.env.SANDBOX_RUNTIME_API_URL || "").trim().replace(/\\/+$/, "");`,
    `}`,
    ``,
    `function workspaceId() {`,
    `  return String(process.env.HOLABOSS_WORKSPACE_ID || "").trim();`,
    `}`,
    ``,
    `function runtimeHeaders() {`,
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
    `  const response = await fetch(\`\${baseUrl}\${CAPABILITY_STATUS_PATH}\`, { method: "GET", headers: runtimeHeaders() });`,
    `  const payload = await readJson(response);`,
    `  if (!response.ok) {`,
    `    throw new Error(String(payload.detail || payload.error || "Holaboss runtime tool capability check failed."));`,
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
    `function parseOptionalJsonObject(raw, fieldName) {`,
    `  if (typeof raw !== "string" || !raw.trim()) {`,
    `    return undefined;`,
    `  }`,
    `  let parsed;`,
    `  try {`,
    `    parsed = JSON.parse(raw);`,
    `  } catch (error) {`,
    `    throw new Error(\`\${fieldName} must be valid JSON object\`);`,
    `  }`,
    `  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {`,
    `    throw new Error(\`\${fieldName} must be valid JSON object\`);`,
    `  }`,
    `  return parsed;`,
    `}`,
    ``,
    `function optionalString(value) {`,
    `  return typeof value === "string" && value.trim() ? value.trim() : undefined;`,
    `}`,
    ``,
    `function buildDeliveryPayload(args) {`,
    `  const channel = optionalString(args?.delivery_channel);`,
    `  const mode = optionalString(args?.delivery_mode);`,
    `  const to = optionalString(args?.delivery_to);`,
    `  if (!channel && !mode && to === undefined) {`,
    `    return undefined;`,
    `  }`,
    `  return {`,
    `    ...(channel ? { channel } : {}),`,
    `    ...(mode ? { mode } : {}),`,
    `    ...(to !== undefined ? { to } : {})`,
    `  };`,
    `}`,
    ``,
    `function cronjobsListPath(args) {`,
    `  const query = new URLSearchParams();`,
    `  if (args?.enabled_only === true) query.set("enabled_only", "true");`,
    `  const suffix = query.toString();`,
    `  return suffix ? \`\${CRONJOBS_PATH}?\${suffix}\` : CRONJOBS_PATH;`,
    `}`,
    ``,
    `function cronjobPath(jobId) {`,
    `  const id = optionalString(jobId);`,
    `  if (!id) {`,
    `    throw new Error("job_id is required");`,
    `  }`,
    `  return \`\${CRONJOBS_PATH}/\${encodeURIComponent(id)}\`;`,
    `}`,
    ``,
    `function createCronjobBody(args) {`,
    `  return {`,
    `    cron: String(args?.cron || ""),`,
    `    description: String(args?.description || ""),`,
    `    ...(optionalString(args?.initiated_by) ? { initiated_by: optionalString(args?.initiated_by) } : {}),`,
    `    ...(optionalString(args?.name) ? { name: optionalString(args?.name) } : {}),`,
    `    ...(typeof args?.enabled === "boolean" ? { enabled: args.enabled } : {}),`,
    `    ...(buildDeliveryPayload(args) ? { delivery: buildDeliveryPayload(args) } : {}),`,
    `    ...(parseOptionalJsonObject(args?.metadata_json, "metadata_json") ? { metadata: parseOptionalJsonObject(args?.metadata_json, "metadata_json") } : {})`,
    `  };`,
    `}`,
    ``,
    `function updateCronjobBody(args) {`,
    `  return {`,
    `    ...(optionalString(args?.name) ? { name: optionalString(args?.name) } : {}),`,
    `    ...(optionalString(args?.cron) ? { cron: optionalString(args?.cron) } : {}),`,
    `    ...(optionalString(args?.description) ? { description: optionalString(args?.description) } : {}),`,
    `    ...(typeof args?.enabled === "boolean" ? { enabled: args.enabled } : {}),`,
    `    ...(buildDeliveryPayload(args) ? { delivery: buildDeliveryPayload(args) } : {}),`,
    `    ...(parseOptionalJsonObject(args?.metadata_json, "metadata_json") ? { metadata: parseOptionalJsonObject(args?.metadata_json, "metadata_json") } : {})`,
    `  };`,
    `}`,
    ``,
    `async function executeJson(baseUrl, method, requestPath, body) {`,
    `  const options = { method, headers: runtimeHeaders() };`,
    `  if (body !== undefined && method !== "GET" && method !== "DELETE") {`,
    `    options.body = JSON.stringify(body);`,
    `  }`,
    `  const response = await fetch(\`\${baseUrl}\${requestPath}\`, options);`,
    `  const payload = await readJson(response);`,
    `  if (!response.ok) {`,
    `    throw new Error(String(payload.detail || payload.error || \`Holaboss runtime tool request failed for \${requestPath}.\`));`,
    `  }`,
    `  return payload;`,
    `}`,
    ``,
    `async function executeTool(baseUrl, toolId, args) {`,
    `  let payload;`,
    `  switch (toolId) {`,
    `    case "holaboss_onboarding_status":`,
    `      payload = await executeJson(baseUrl, "GET", ONBOARDING_STATUS_PATH);`,
    `      break;`,
    `    case "holaboss_onboarding_complete":`,
    `      payload = await executeJson(baseUrl, "POST", ONBOARDING_COMPLETE_PATH, {`,
    `        summary: String(args?.summary || ""),`,
    `        ...(optionalString(args?.requested_by) ? { requested_by: optionalString(args?.requested_by) } : {})`,
    `      });`,
    `      break;`,
    `    case "holaboss_cronjobs_list":`,
    `      payload = await executeJson(baseUrl, "GET", cronjobsListPath(args));`,
    `      break;`,
    `    case "holaboss_cronjobs_create":`,
    `      payload = await executeJson(baseUrl, "POST", CRONJOBS_PATH, createCronjobBody(args));`,
    `      break;`,
    `    case "holaboss_cronjobs_get":`,
    `      payload = await executeJson(baseUrl, "GET", cronjobPath(args?.job_id));`,
    `      break;`,
    `    case "holaboss_cronjobs_update":`,
    `      payload = await executeJson(baseUrl, "PATCH", cronjobPath(args?.job_id), updateCronjobBody(args));`,
    `      break;`,
    `    case "holaboss_cronjobs_delete":`,
    `      payload = await executeJson(baseUrl, "DELETE", cronjobPath(args?.job_id));`,
    `      break;`,
    `    default:`,
    `      throw new Error(\`Unsupported Holaboss runtime tool: \${toolId}\`);`,
    `  }`,
    `  return formatToolResult(payload);`,
    `}`,
    ``,
    `export const HolabossRuntimeToolsPlugin = async () => {`,
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

export function stageOpencodeRuntimeToolsPlugin(
  request: OpencodeRuntimeToolsCliRequest
): OpencodeRuntimeToolsCliResponse {
  const workspaceDir = path.resolve(request.workspace_dir);
  const pluginChanged = writePluginFile(workspaceDir, renderOpencodeRuntimeToolsPlugin());
  const packageChanged = ensurePluginDependency(workspaceDir);
  return {
    changed: pluginChanged || packageChanged,
    tool_ids: [...RUNTIME_AGENT_TOOL_IDS]
  };
}
