import { pathToFileURL } from "node:url";
import { resolveProductRuntimeConfig } from "./runtime-config.js";

export type AgentRuntimeConfigGeneralMemberPayload = {
  id: string;
  model: string;
  prompt: string;
  role?: string | null;
};

export interface AgentRuntimeConfigCliRequest {
  session_id: string;
  workspace_id: string;
  input_id: string;
  runtime_exec_model_proxy_api_key?: string | null;
  runtime_exec_sandbox_id?: string | null;
  runtime_exec_run_id?: string | null;
  selected_model?: string | null;
  default_provider_id: string;
  session_mode: string;
  workspace_config_checksum: string;
  workspace_skill_ids: string[];
  default_tools: string[];
  extra_tools: string[];
  resolved_mcp_tool_refs: Array<{ tool_id: string; server_id: string; tool_name: string }>;
  resolved_output_schemas: Record<string, Record<string, unknown>>;
  general_type: string;
  single_agent?: AgentRuntimeConfigGeneralMemberPayload | null;
  coordinator?: AgentRuntimeConfigGeneralMemberPayload | null;
  members: AgentRuntimeConfigGeneralMemberPayload[];
}

export interface AgentRuntimeConfigCliResponse {
  provider_id: string;
  model_id: string;
  mode: string;
  system_prompt: string;
  model_client: {
    model_proxy_provider: string;
    api_key: string;
    base_url?: string | null;
    default_headers?: Record<string, string> | null;
  };
  tools: Record<string, boolean>;
  workspace_tool_ids: string[];
  workspace_skill_ids: string[];
  output_schema_member_id?: string | null;
  output_format?: Record<string, unknown> | null;
  workspace_config_checksum: string;
}

export type OpencodeRuntimeConfigGeneralMemberPayload = AgentRuntimeConfigGeneralMemberPayload;
export type OpencodeRuntimeConfigCliRequest = AgentRuntimeConfigCliRequest;
export type OpencodeRuntimeConfigCliResponse = AgentRuntimeConfigCliResponse;

const MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE = "openai_compatible";
const MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE = "anthropic_native";
const OPENCODE_OPENAI_COMPATIBLE_PROVIDER_ID = "hb_openai";
const OPENCODE_ANTHROPIC_PROVIDER_ID = "hb_anthropic";
const DEFAULT_OPENCODE_STRUCTURED_RETRY_COUNT = 2;
const DIRECT_OPENAI_FALLBACK_FLAG = "SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK";

function directOpenaiFallbackEnabled(): boolean {
  const raw = (process.env[DIRECT_OPENAI_FALLBACK_FLAG] ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function modelProxyBaseUrlForProvider(provider: string): string {
  const normalizedProvider = normalizeModelProxyProvider(provider);
  const baseRoot = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: true,
    includeDefaultBaseUrl: false
  }).modelProxyBaseUrl.replace(/\/+$/, "");
  if (normalizedProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE) {
    return `${baseRoot}/anthropic/v1`;
  }
  return `${baseRoot}/openai/v1`;
}

function resolveModelClientConfig(request: AgentRuntimeConfigCliRequest, modelProxyProvider: string): {
  model_proxy_provider: string;
  api_key: string;
  base_url?: string | null;
  default_headers?: Record<string, string> | null;
} {
  const normalizedProvider = normalizeModelProxyProvider(modelProxyProvider);
  if (
    normalizedProvider !== MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE &&
    normalizedProvider !== MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE
  ) {
    throw new Error(
      `resolved model proxy provider=${modelProxyProvider} is unsupported; expected one of: ` +
        `${MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE}, ${MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE}`
    );
  }

  const proxyApiKey = request.runtime_exec_model_proxy_api_key?.trim() ?? "";
  const sandboxId = request.runtime_exec_sandbox_id?.trim() ?? "";
  const runId = request.runtime_exec_run_id?.trim() ?? "";
  if (proxyApiKey && sandboxId) {
    const headers: Record<string, string> = {
      "X-API-Key": proxyApiKey,
      "X-Holaboss-Sandbox-Id": sandboxId,
      "X-Holaboss-Session-Id": request.session_id,
      "X-Holaboss-Workspace-Id": request.workspace_id,
      "X-Holaboss-Input-Id": request.input_id
    };
    if (runId) {
      headers["X-Holaboss-Run-Id"] = runId;
    }
    return {
      model_proxy_provider: normalizedProvider,
      api_key: proxyApiKey,
      base_url: modelProxyBaseUrlForProvider(normalizedProvider),
      default_headers: headers
    };
  }

  if (normalizedProvider === MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE && directOpenaiFallbackEnabled()) {
    const directApiKey = (process.env.OPENAI_API_KEY ?? "").trim();
    if (directApiKey) {
      return {
        model_proxy_provider: MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE,
        api_key: directApiKey
      };
    }
  }

  const missingVars: string[] = [];
  if (!proxyApiKey) {
    missingVars.push("_sandbox_runtime_exec_v1.model_proxy_api_key");
  }
  if (!sandboxId) {
    missingVars.push("_sandbox_runtime_exec_v1.sandbox_id");
  }
  let message = `Sandbox model proxy is not configured (missing: ${missingVars.join(", ")})`;
  if (normalizedProvider === MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE && directOpenaiFallbackEnabled()) {
    message += "; OPENAI_API_KEY is also missing for direct fallback";
  }
  throw new Error(message);
}

function decodeCliRequest(encoded: string): AgentRuntimeConfigCliRequest {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error("request_base64 is required");
  }
  const raw = Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request payload must be an object");
  }
  return parsed as AgentRuntimeConfigCliRequest;
}

function normalizeModelProxyProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "openai" || normalized === MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE) {
    return MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE;
  }
  if (normalized === "anthropic" || normalized === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE) {
    return MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE;
  }
  return normalized;
}

function resolveModelProxyProviderAndModelId(modelToken: string, defaultProvider: string): [string, string] {
  const token = modelToken.trim();
  if (!token) {
    throw new Error("model must be a non-empty string");
  }

  if (token.includes("/")) {
    const [providerToken, ...rest] = token.split("/");
    const normalizedProvider = normalizeModelProxyProvider(providerToken ?? "");
    const modelId = rest.join("/").trim();
    if (
      (normalizedProvider === MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE ||
        normalizedProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE) &&
      modelId
    ) {
      return [normalizedProvider, modelId];
    }
    if (
      normalizedProvider === MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE ||
      normalizedProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE
    ) {
      throw new Error("model id segment after provider must be non-empty");
    }
  }

  if (token.toLowerCase().startsWith("claude")) {
    return [MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE, token];
  }
  return [normalizeModelProxyProvider(defaultProvider), token];
}

function resolveOpencodeProviderAndModel(model: string, defaultProviderId: string): [string, string] {
  const [provider, modelId] = resolveModelProxyProviderAndModelId(model, defaultProviderId);
  if (provider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE) {
    return [OPENCODE_ANTHROPIC_PROVIDER_ID, modelId];
  }
  return [OPENCODE_OPENAI_COMPATIBLE_PROVIDER_ID, modelId];
}

function opencodeStructuredRetryCount(): number {
  const raw = (process.env.OPENCODE_STRUCTURED_OUTPUT_RETRY_COUNT ?? String(DEFAULT_OPENCODE_STRUCTURED_RETRY_COUNT)).trim();
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return DEFAULT_OPENCODE_STRUCTURED_RETRY_COUNT;
  }
  return Math.max(0, Math.min(value, 10));
}

function opencodeToolNameFromMcpServerAndTool(serverId: string, toolName: string): string {
  return `${serverId}_${toolName}`;
}

function appendToolExecutionGuidance(
  systemPrompt: string,
  request: Pick<
    AgentRuntimeConfigCliRequest,
    "default_tools" | "extra_tools" | "workspace_skill_ids" | "resolved_mcp_tool_refs"
  >
): string {
  const builtinOrExtraTools = [...request.default_tools, ...request.extra_tools]
    .map((toolName) => toolName.trim())
    .filter(Boolean);
  const hasSkills = (request.workspace_skill_ids ?? []).length > 0;
  const hasMcpTools = request.resolved_mcp_tool_refs.length > 0;
  if (builtinOrExtraTools.length === 0 && !hasSkills && !hasMcpTools) {
    return systemPrompt.trim();
  }

  const lines = [
    systemPrompt.trim(),
    "",
    "Tool execution guidance:",
    "When available tools or connected MCP servers can inspect, verify, retrieve, or complete the task, use them instead of answering only with raw text.",
    "Prefer concrete tool results over guesses, especially for code, files, workspace state, app state, or live integrations.",
    "If you claim that you checked, changed, ran, or verified something, use the relevant tool first.",
    "Respond directly without tool calls only when the request is purely conversational or explanatory and tools would not improve the outcome."
  ];
  if (hasMcpTools) {
    lines.push("When a connected MCP tool is relevant, invoke it directly instead of describing what it would do or return.");
  }
  return lines.join("\n").trim();
}

function appendOpencodeMcpToolAliasGuidance(
  systemPrompt: string,
  resolvedMcpToolRefs: AgentRuntimeConfigCliRequest["resolved_mcp_tool_refs"]
): string {
  if (resolvedMcpToolRefs.length === 0) {
    return systemPrompt.trim();
  }

  const aliasLines = resolvedMcpToolRefs.map((toolRef) => {
    const callableName = opencodeToolNameFromMcpServerAndTool(toolRef.server_id, toolRef.tool_name);
    return `- ${toolRef.tool_id} -> ${callableName}`;
  });

  return [
    systemPrompt.trim(),
    "",
    "MCP tool naming:",
    "Workspace configuration and workspace.yaml list MCP tool ids as `server.tool`.",
    "When calling MCP tools through OpenCode, use these callable tool names:",
    ...aliasLines,
    "Use the callable OpenCode tool name for tool invocation."
  ]
    .join("\n")
    .trim();
}

function composeOpencodeTeamSystemPrompt(
  coordinator: AgentRuntimeConfigGeneralMemberPayload,
  members: AgentRuntimeConfigGeneralMemberPayload[]
): string {
  const lines = [
    "You are the workspace coordinator agent.",
    "Follow coordinator guidance and apply member guidance when useful.",
    "",
    "Coordinator instructions:",
    coordinator.prompt.trim(),
    "",
    "Member guidance:"
  ];
  for (const member of members) {
    lines.push(`- ${member.id} (${member.role || "member"}):`);
    lines.push(member.prompt.trim());
    lines.push("");
  }
  return lines.join("\n").trim();
}

function selectedOpencodeSchema(
  request: AgentRuntimeConfigCliRequest
): { outputSchemaMemberId: string | null; outputFormat: Record<string, unknown> | null } {
  if (request.general_type === "single") {
    const memberId = request.single_agent?.id?.trim() || null;
    if (!memberId) {
      return { outputSchemaMemberId: null, outputFormat: null };
    }
    const schema = request.resolved_output_schemas[memberId];
    return {
      outputSchemaMemberId: memberId,
      outputFormat: schema
        ? {
            type: "json_schema",
            schema,
            retryCount: opencodeStructuredRetryCount()
          }
        : null
    };
  }

  const coordinatorId = request.coordinator?.id?.trim() || null;
  if (!coordinatorId) {
    throw new Error("coordinator must be configured for team mode");
  }
  const unsupportedMembers = Object.keys(request.resolved_output_schemas).filter((memberId) => memberId !== coordinatorId);
  if (unsupportedMembers.length > 0) {
    throw new Error(
      "OpenCode harness currently validates a single schema for the selected runtime member only; " +
        `unsupported schema members: ${unsupportedMembers.sort((a, b) => a.localeCompare(b)).join(", ")}`
    );
  }
  const schema = request.resolved_output_schemas[coordinatorId];
  return {
    outputSchemaMemberId: coordinatorId,
    outputFormat: schema
      ? {
          type: "json_schema",
          schema,
          retryCount: opencodeStructuredRetryCount()
        }
      : null
  };
}

export function projectAgentRuntimeConfig(
  request: AgentRuntimeConfigCliRequest
): AgentRuntimeConfigCliResponse {
  let selectedModel = request.selected_model?.trim() ?? "";
  let systemPrompt = "";

  if (request.general_type === "single") {
    const agent = request.single_agent;
    if (!agent) {
      throw new Error("single_agent must be configured for single mode");
    }
    selectedModel = selectedModel || agent.model;
    systemPrompt = agent.prompt.trim();
  } else if (request.general_type === "team") {
    const coordinator = request.coordinator;
    if (!coordinator) {
      throw new Error("coordinator must be configured for team mode");
    }
    selectedModel = selectedModel || coordinator.model;
    systemPrompt = composeOpencodeTeamSystemPrompt(coordinator, request.members ?? []);
  } else {
    throw new Error(`unsupported general runtime mode: ${request.general_type}`);
  }
  systemPrompt = appendToolExecutionGuidance(systemPrompt, request);
  systemPrompt = appendOpencodeMcpToolAliasGuidance(systemPrompt, request.resolved_mcp_tool_refs);

  const [providerId, modelId] = resolveOpencodeProviderAndModel(selectedModel, request.default_provider_id);
  const modelProxyProvider =
    providerId === OPENCODE_ANTHROPIC_PROVIDER_ID
      ? MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE
      : MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE;
  const workspaceToolIds = request.resolved_mcp_tool_refs.map((toolRef) => toolRef.tool_id);
  const tools: Record<string, boolean> = {};
  for (const toolName of request.default_tools) {
    if (toolName.trim()) {
      tools[toolName] = true;
    }
  }
  for (const toolRef of request.resolved_mcp_tool_refs) {
    tools[opencodeToolNameFromMcpServerAndTool(toolRef.server_id, toolRef.tool_name)] = true;
  }
  for (const toolName of request.extra_tools) {
    if (toolName.trim()) {
      tools[toolName.trim()] = true;
    }
  }
  if ((request.workspace_skill_ids ?? []).length > 0) {
    tools.read = true;
    tools.skill = true;
  }

  const { outputSchemaMemberId, outputFormat } = selectedOpencodeSchema(request);
  return {
    provider_id: providerId,
    model_id: modelId,
    mode: request.session_mode,
    system_prompt: systemPrompt,
    model_client: resolveModelClientConfig(request, modelProxyProvider),
    tools,
    workspace_tool_ids: workspaceToolIds,
    workspace_skill_ids: request.workspace_skill_ids ?? [],
    output_schema_member_id: outputSchemaMemberId,
    output_format: outputFormat,
    workspace_config_checksum: request.workspace_config_checksum
  };
}

export const projectOpencodeRuntimeConfig = projectAgentRuntimeConfig;

export async function runOpencodeRuntimeConfigCli(
  argv: string[],
  options: {
    io?: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
    projectConfig?: (request: AgentRuntimeConfigCliRequest) => AgentRuntimeConfigCliResponse;
  } = {}
): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const requestBase64 = argv[0] === "--request-base64" ? argv[1] ?? "" : argv[0] ?? "";
  if (!requestBase64) {
    io.stderr.write("request_base64 is required\n");
    return 2;
  }
  try {
    const request = decodeCliRequest(requestBase64);
    const result = (options.projectConfig ?? projectAgentRuntimeConfig)(request);
    io.stdout.write(JSON.stringify(result));
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runOpencodeRuntimeConfigCli(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
