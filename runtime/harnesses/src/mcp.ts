export interface HarnessMcpToolRef {
  tool_id: string;
  server_id: string;
  tool_name: string;
}

export interface HarnessPreparedMcpServerConfig {
  name: string;
  config: {
    type: "local" | "remote";
    enabled: boolean;
    command?: string[];
    environment?: Record<string, string>;
    headers?: Record<string, string>;
    url?: string | null;
    timeout: number;
  };
  _holaboss_force_refresh?: boolean;
}

export type HarnessMcpServerBinding = {
  serverId: string;
  timeoutMs: number;
  description: string;
  transport:
    | {
        kind: "stdio";
        command: string;
        args: string[];
        cwd: string;
        env: Record<string, string>;
      }
    | {
        kind: "http";
        url: string;
        headers: Record<string, string>;
      };
};

export interface HarnessMcpRuntimeToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface HarnessMcpRuntimeLike {
  listTools: (
    serverId: string,
    options?: { includeSchema?: boolean },
  ) => Promise<HarnessMcpRuntimeToolInfo[]>;
}

export interface HarnessDiscoveredMcpTool {
  harnessToolName: string;
  serverId: string;
  toolId: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  timeoutMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function sanitizeHarnessToolNameSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "tool";
}

export function buildHarnessMcpToolName(serverId: string, toolName: string): string {
  return `mcp__${sanitizeHarnessToolNameSegment(serverId)}__${sanitizeHarnessToolNameSegment(toolName)}`;
}

export function buildUniqueHarnessMcpToolName(
  serverId: string,
  toolName: string,
  usedNames: ReadonlySet<string>,
): string {
  const baseName = buildHarnessMcpToolName(serverId, toolName);
  if (!usedNames.has(baseName)) {
    return baseName;
  }
  let suffix = 2;
  while (usedNames.has(`${baseName}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}_${suffix}`;
}

function fallbackMcpToolParametersSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

export function normalizeHarnessMcpToolParametersSchema(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    return fallbackMcpToolParametersSchema();
  }
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function toHarnessMcpServerBinding(
  payload: HarnessPreparedMcpServerConfig,
  workspaceDir: string,
): HarnessMcpServerBinding | null {
  const name = firstNonEmptyString(payload.name);
  const config = isRecord(payload.config) ? payload.config : null;
  if (!name || !config) {
    return null;
  }

  const enabled = typeof config.enabled === "boolean" ? config.enabled : true;
  if (!enabled) {
    return null;
  }

  const timeoutMs = typeof config.timeout === "number" && Number.isFinite(config.timeout) ? config.timeout : 30000;
  const description = `Holaboss MCP server ${name}`;
  if (config.type === "local") {
    const command = Array.isArray(config.command)
      ? config.command.filter((item): item is string => typeof item === "string")
      : [];
    const [executable, ...args] = command;
    if (!executable) {
      throw new Error(`Pi MCP server ${name} is missing a local command`);
    }
    return {
      serverId: name,
      timeoutMs,
      description,
      transport: {
        kind: "stdio",
        command: executable,
        args,
        cwd: workspaceDir,
        env: stringRecord(config.environment),
      },
    };
  }

  const url = firstNonEmptyString(config.url);
  if (!url) {
    throw new Error(`Pi MCP server ${name} is missing a remote url`);
  }
  return {
    serverId: name,
    timeoutMs,
    description,
    transport: {
      kind: "http",
      url,
      headers: stringRecord(config.headers),
    },
  };
}

export function buildHarnessMcpServerBindings(params: {
  servers: HarnessPreparedMcpServerConfig[];
  workspaceDir: string;
}): HarnessMcpServerBinding[] {
  return params.servers
    .map((server) => toHarnessMcpServerBinding(server, params.workspaceDir))
    .filter((binding): binding is HarnessMcpServerBinding => Boolean(binding));
}

function mcpToolAllowlist(
  toolRefs: HarnessMcpToolRef[],
): Map<string, Map<string, HarnessMcpToolRef>> {
  const allowlist = new Map<string, Map<string, HarnessMcpToolRef>>();
  for (const toolRef of toolRefs) {
    const serverTools = allowlist.get(toolRef.server_id) ?? new Map<string, HarnessMcpToolRef>();
    serverTools.set(toolRef.tool_name, toolRef);
    allowlist.set(toolRef.server_id, serverTools);
  }
  return allowlist;
}

export async function discoverHarnessMcpTools(params: {
  bindings: HarnessMcpServerBinding[];
  runtime: HarnessMcpRuntimeLike;
  toolRefs: HarnessMcpToolRef[];
  retryIntervalMs?: number;
  maxWaitMs?: number;
}): Promise<HarnessDiscoveredMcpTool[]> {
  const retryIntervalMs = Math.max(1, params.retryIntervalMs ?? 250);
  const maxWaitMs = Math.max(retryIntervalMs, params.maxWaitMs ?? 10000);
  const allowlist = mcpToolAllowlist(params.toolRefs);
  const discovered: HarnessDiscoveredMcpTool[] = [];
  const usedNames = new Set<string>();

  for (const binding of params.bindings) {
    const allowedTools = allowlist.get(binding.serverId);
    const discoveryDeadline = Date.now() + Math.min(binding.timeoutMs, maxWaitMs);
    let discoveredTools: HarnessMcpRuntimeToolInfo[] = [];
    let lastDiscoveryError: unknown = null;

    while (true) {
      try {
        discoveredTools = await params.runtime.listTools(binding.serverId, { includeSchema: true });
        lastDiscoveryError = null;
      } catch (error) {
        lastDiscoveryError = error;
        discoveredTools = [];
      }

      const missingAllowedTools = allowedTools
        ? [...allowedTools.keys()].filter((toolName) => !discoveredTools.some((tool) => tool.name === toolName))
        : [];
      if (missingAllowedTools.length === 0) {
        break;
      }
      if (Date.now() >= discoveryDeadline) {
        if (lastDiscoveryError) {
          throw lastDiscoveryError;
        }
        throw new Error(
          `Pi MCP tool ${binding.serverId}.${missingAllowedTools[0]} for tool_id=${allowedTools?.get(missingAllowedTools[0])?.tool_id ?? `${binding.serverId}.${missingAllowedTools[0]}`} was not discovered`,
        );
      }
      await sleep(retryIntervalMs);
    }

    const filteredTools = allowedTools
      ? discoveredTools.filter((tool) => allowedTools.has(tool.name))
      : discoveredTools;

    if (allowedTools) {
      for (const [toolName, toolRef] of allowedTools.entries()) {
        if (!discoveredTools.some((tool) => tool.name === toolName)) {
          throw new Error(`Pi MCP tool ${binding.serverId}.${toolName} for tool_id=${toolRef.tool_id} was not discovered`);
        }
      }
    }

    for (const tool of filteredTools) {
      const toolRef = allowedTools?.get(tool.name);
      const harnessToolName = buildUniqueHarnessMcpToolName(binding.serverId, tool.name, usedNames);
      usedNames.add(harnessToolName);
      discovered.push({
        harnessToolName,
        serverId: binding.serverId,
        toolId: toolRef?.tool_id ?? `${binding.serverId}.${tool.name}`,
        toolName: tool.name,
        description: [tool.description?.trim(), `MCP server: ${binding.serverId}`, `MCP tool: ${tool.name}`]
          .filter(Boolean)
          .join("\n"),
        inputSchema: normalizeHarnessMcpToolParametersSchema(tool.inputSchema),
        timeoutMs: binding.timeoutMs,
      });
    }
  }

  return discovered;
}
