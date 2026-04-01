import {
  DESKTOP_BROWSER_TOOL_DEFINITIONS,
} from "../../harnesses/src/desktop-browser-tools.js";
import {
  RUNTIME_AGENT_TOOL_DEFINITIONS,
} from "../../harnesses/src/runtime-agent-tools.js";

export interface AgentCapabilityMcpToolRef {
  tool_id: string;
  server_id: string;
  tool_name: string;
}

export type AgentCapabilityKind =
  | "builtin_tool"
  | "runtime_tool"
  | "browser_tool"
  | "mcp_tool"
  | "custom_tool"
  | "skill";

export type AgentCapabilityPolicy = "inspect" | "mutate" | "coordinate";

export interface AgentCapabilityPolicyContext {
  harness_id: string | null;
  session_kind: string | null;
  browser_tools_available: boolean | null;
  browser_tool_ids: string[];
  runtime_tool_ids: string[];
  workspace_command_ids: string[];
  workspace_commands_available?: boolean;
  workspace_skills_available?: boolean;
  mcp_tools_available?: boolean;
}

export interface AgentCapabilityRecord {
  id: string;
  kind: AgentCapabilityKind;
  policy: AgentCapabilityPolicy;
  title: string;
  description: string;
  callable_name: string | null;
  source:
    | "default_tool"
    | "extra_tool"
    | "workspace_mcp"
    | "workspace_skill"
    | "implied_tool";
}

export interface AgentCapabilityManifest {
  context: AgentCapabilityPolicyContext;
  capabilities: AgentCapabilityRecord[];
  tools: AgentCapabilityRecord[];
  builtin_tools: AgentCapabilityRecord[];
  runtime_tools: AgentCapabilityRecord[];
  browser_tools: AgentCapabilityRecord[];
  mcp_tools: AgentCapabilityRecord[];
  custom_tools: AgentCapabilityRecord[];
  skills: AgentCapabilityRecord[];
  inspect: AgentCapabilityRecord[];
  mutate: AgentCapabilityRecord[];
  coordinate: AgentCapabilityRecord[];
  workspace_commands: string[];
  workspace_skills: string[];
  mcp_tool_aliases: Array<{
    tool_id: string;
    server_id: string;
    tool_name: string;
    callable_name: string;
  }>;
}

export interface BuildAgentCapabilityManifestParams {
  harnessId?: string | null;
  sessionKind?: string | null;
  browserToolsAvailable?: boolean | null;
  browserToolIds?: string[] | null;
  runtimeToolIds?: string[] | null;
  workspaceCommandIds?: string[] | null;
  defaultTools: string[];
  extraTools: string[];
  workspaceSkillIds: string[];
  resolvedMcpToolRefs: AgentCapabilityMcpToolRef[];
  toolServerIdMap?: Readonly<Record<string, string>> | null;
}

interface CapabilityAvailabilityRules {
  harnessIds?: string[];
  sessionKinds?: string[];
  requiresBrowser?: boolean;
}

type CapabilityDefinition = {
  kind: Exclude<AgentCapabilityKind, "mcp_tool" | "skill">;
  policy: AgentCapabilityPolicy;
  title: string;
  description: string;
  availability?: CapabilityAvailabilityRules;
};

const BUILTIN_CAPABILITY_DEFINITIONS: Record<string, CapabilityDefinition> = {
  read: {
    kind: "builtin_tool",
    policy: "inspect",
    title: "Read",
    description: "Read file contents or prior outputs without modifying workspace state.",
  },
  edit: {
    kind: "builtin_tool",
    policy: "mutate",
    title: "Edit",
    description: "Modify workspace files directly.",
  },
  bash: {
    kind: "builtin_tool",
    policy: "mutate",
    title: "Bash",
    description: "Run shell commands that may inspect or mutate workspace state.",
  },
  grep: {
    kind: "builtin_tool",
    policy: "inspect",
    title: "Grep",
    description: "Search workspace file contents by pattern.",
  },
  glob: {
    kind: "builtin_tool",
    policy: "inspect",
    title: "Glob",
    description: "Find files and paths by glob pattern.",
  },
  list: {
    kind: "builtin_tool",
    policy: "inspect",
    title: "List",
    description: "List directory contents and inspect workspace layout.",
  },
  question: {
    kind: "builtin_tool",
    policy: "coordinate",
    title: "Question",
    description: "Pause and ask the user for clarification or confirmation.",
  },
  todowrite: {
    kind: "builtin_tool",
    policy: "coordinate",
    title: "Todo Write",
    description: "Record a working checklist or plan.",
  },
  todoread: {
    kind: "builtin_tool",
    policy: "coordinate",
    title: "Todo Read",
    description: "Read the current working checklist or plan.",
  },
  skill: {
    kind: "builtin_tool",
    policy: "coordinate",
    title: "Skill",
    description: "Consult staged workspace skills when they are relevant.",
  },
};

const RUNTIME_TOOL_DEFINITIONS = new Map<string, CapabilityDefinition>(
  RUNTIME_AGENT_TOOL_DEFINITIONS.map((toolDef) => [
    toolDef.id,
    {
      kind: "runtime_tool",
      policy: toolDef.policy,
      title: titleFromToken(toolDef.id),
      description: toolDef.description,
    },
  ])
);

const BROWSER_TOOL_DEFINITIONS = new Map<string, CapabilityDefinition>(
  DESKTOP_BROWSER_TOOL_DEFINITIONS.map((toolDef) => [
    toolDef.id,
    {
      kind: "browser_tool",
      policy: toolDef.policy,
      title: titleFromToken(toolDef.id),
      description: toolDef.description,
      availability: {
        sessionKinds: toolDef.session_scope === "main_only" ? ["main"] : undefined,
        requiresBrowser: true,
      },
    },
  ])
);

function titleFromToken(token: string): string {
  return token
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizedToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalToken(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.toLowerCase() : "";
}

function customCapabilityDefinition(toolName: string): CapabilityDefinition {
  const normalized = normalizedToken(toolName);
  const inspectPrefixes = [
    "read",
    "grep",
    "glob",
    "list",
    "ls",
    "find",
    "lookup",
    "search",
    "fetch",
    "get",
    "show",
    "status",
    "inspect",
  ];
  const coordinatePrefixes = ["question", "todo", "plan", "skill", "ask"];
  const mutatePrefixes = [
    "edit",
    "write",
    "create",
    "update",
    "delete",
    "remove",
    "apply",
    "run",
    "exec",
    "bash",
    "navigate",
    "click",
    "type",
    "submit",
  ];

  if (inspectPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return {
      kind: "custom_tool",
      policy: "inspect",
      title: titleFromToken(toolName),
      description: "Inspect or retrieve workspace or runtime state.",
    };
  }
  if (coordinatePrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return {
      kind: "custom_tool",
      policy: "coordinate",
      title: titleFromToken(toolName),
      description: "Coordinate planning, clarification, or skill usage.",
    };
  }
  if (mutatePrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return {
      kind: "custom_tool",
      policy: "mutate",
      title: titleFromToken(toolName),
      description: "Mutate workspace, app, or runtime state.",
    };
  }
  return {
    kind: "custom_tool",
    policy: "inspect",
    title: titleFromToken(toolName),
    description: "Use this tool directly when it is the most reliable path to inspect or complete the task.",
  };
}

function definitionAllowedInContext(
  definition: CapabilityDefinition,
  context: AgentCapabilityPolicyContext
): boolean {
  const availability = definition.availability;
  if (!availability) {
    return true;
  }

  const normalizedHarnessId = normalizeOptionalToken(context.harness_id);
  if (
    availability.harnessIds &&
    normalizedHarnessId &&
    !availability.harnessIds.includes(normalizedHarnessId)
  ) {
    return false;
  }

  const normalizedSessionKind = normalizeOptionalToken(context.session_kind);
  if (
    availability.sessionKinds &&
    normalizedSessionKind &&
    !availability.sessionKinds.includes(normalizedSessionKind)
  ) {
    return false;
  }

  if (availability.requiresBrowser && context.browser_tools_available === false) {
    return false;
  }

  return true;
}

function resolveCapabilityDefinition(
  toolName: string,
  context: AgentCapabilityPolicyContext
): CapabilityDefinition | null {
  const normalized = normalizedToken(toolName);
  const builtin = BUILTIN_CAPABILITY_DEFINITIONS[normalized];
  if (builtin) {
    return definitionAllowedInContext(builtin, context) ? builtin : null;
  }
  const runtimeTool = RUNTIME_TOOL_DEFINITIONS.get(normalized);
  if (runtimeTool) {
    return definitionAllowedInContext(runtimeTool, context) ? runtimeTool : null;
  }
  const browserTool = BROWSER_TOOL_DEFINITIONS.get(normalized);
  if (browserTool) {
    return definitionAllowedInContext(browserTool, context) ? browserTool : null;
  }
  return customCapabilityDefinition(toolName);
}

function inferMcpPolicy(toolRef: AgentCapabilityMcpToolRef): AgentCapabilityPolicy {
  const haystack = `${toolRef.tool_id} ${toolRef.tool_name}`.toLowerCase();
  if (/(create|update|delete|remove|write|edit|patch|post|send|run|execute|trigger|start|stop)/.test(haystack)) {
    return "mutate";
  }
  if (/(ask|question|plan|todo|approve|confirm)/.test(haystack)) {
    return "coordinate";
  }
  return "inspect";
}

export function callableToolNameFromMcpServerAndTool(serverId: string, toolName: string): string {
  return `${serverId}_${toolName}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}

function uniqueNormalizedSorted(values: Array<string | null | undefined>): string[] {
  return uniqueSorted(values.map((value) => normalizeOptionalToken(value)).filter(Boolean));
}

export function buildAgentCapabilityManifest(
  params: BuildAgentCapabilityManifestParams
): AgentCapabilityManifest {
  const browserToolIds = uniqueNormalizedSorted(
    params.browserToolIds
      ? params.browserToolIds
      : params.extraTools.filter((toolName) => BROWSER_TOOL_DEFINITIONS.has(normalizedToken(toolName)))
  );
  const runtimeToolIds = uniqueNormalizedSorted(
    params.runtimeToolIds
      ? params.runtimeToolIds
      : params.extraTools.filter((toolName) => RUNTIME_TOOL_DEFINITIONS.has(normalizedToken(toolName)))
  );
  const workspaceCommands = uniqueSorted((params.workspaceCommandIds ?? []).map((commandId) => commandId.trim()));
  const context: AgentCapabilityPolicyContext = {
    harness_id: (params.harnessId ?? "").trim() || null,
    session_kind: (params.sessionKind ?? "").trim() || null,
    browser_tools_available:
      typeof params.browserToolsAvailable === "boolean" ? params.browserToolsAvailable : null,
    browser_tool_ids: browserToolIds,
    runtime_tool_ids: runtimeToolIds,
    workspace_command_ids: workspaceCommands,
  };
  const capabilityById = new Map<string, AgentCapabilityRecord>();
  const workspaceSkills = uniqueSorted(params.workspaceSkillIds.map((skillId) => skillId.trim()));

  const upsertCapability = (capability: AgentCapabilityRecord) => {
    const key = capability.callable_name ?? `skill:${capability.id}`;
    if (capabilityById.has(key)) {
      return;
    }
    capabilityById.set(key, capability);
  };

  const addTool = (
    toolName: string,
    source: AgentCapabilityRecord["source"]
  ) => {
    const trimmed = toolName.trim();
    if (!trimmed) {
      return;
    }
    const definition = resolveCapabilityDefinition(trimmed, context);
    if (!definition) {
      return;
    }
    upsertCapability({
      id: trimmed,
      kind: definition.kind,
      policy: definition.policy,
      title: definition.title,
      description: definition.description,
      callable_name: trimmed,
      source,
    });
  };

  for (const toolName of params.defaultTools) {
    addTool(toolName, "default_tool");
  }
  for (const toolName of params.extraTools) {
    addTool(toolName, "extra_tool");
  }

  if (workspaceSkills.length > 0) {
    addTool("read", "implied_tool");
    addTool("skill", "implied_tool");
    for (const skillId of workspaceSkills) {
      upsertCapability({
        id: skillId,
        kind: "skill",
        policy: "coordinate",
        title: titleFromToken(skillId),
        description: `Workspace skill '${skillId}' is available for domain-specific guidance.`,
        callable_name: null,
        source: "workspace_skill",
      });
    }
  }

  const mcpToolAliases = params.resolvedMcpToolRefs.map((toolRef) => {
    const mappedServerId = params.toolServerIdMap?.[toolRef.server_id] ?? toolRef.server_id;
    return {
      tool_id: toolRef.tool_id,
      server_id: mappedServerId,
      tool_name: toolRef.tool_name,
      callable_name: callableToolNameFromMcpServerAndTool(mappedServerId, toolRef.tool_name),
    };
  });

  for (const toolRef of params.resolvedMcpToolRefs) {
    const mappedServerId = params.toolServerIdMap?.[toolRef.server_id] ?? toolRef.server_id;
    const callableName = callableToolNameFromMcpServerAndTool(mappedServerId, toolRef.tool_name);
    upsertCapability({
      id: toolRef.tool_id,
      kind: "mcp_tool",
      policy: inferMcpPolicy(toolRef),
      title: titleFromToken(toolRef.tool_name),
      description: `Workspace MCP tool '${toolRef.tool_id}' callable as '${callableName}'.`,
      callable_name: callableName,
      source: "workspace_mcp",
    });
  }

  const capabilities = [...capabilityById.values()].sort((left, right) => {
    if (left.policy !== right.policy) {
      return left.policy.localeCompare(right.policy);
    }
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.id.localeCompare(right.id);
  });
  const tools = capabilities.filter((capability) => capability.callable_name !== null);
  const resolvedBrowserTools = capabilities.filter((capability) => capability.kind === "browser_tool");
  const resolvedContext: AgentCapabilityPolicyContext = {
    ...context,
    browser_tools_available:
      typeof context.browser_tools_available === "boolean"
        ? context.browser_tools_available
        : resolvedBrowserTools.length > 0,
    workspace_commands_available: workspaceCommands.length > 0,
    workspace_skills_available: workspaceSkills.length > 0,
    mcp_tools_available: mcpToolAliases.length > 0,
  };
  return {
    context: resolvedContext,
    capabilities,
    tools,
    builtin_tools: capabilities.filter((capability) => capability.kind === "builtin_tool"),
    runtime_tools: capabilities.filter((capability) => capability.kind === "runtime_tool"),
    browser_tools: resolvedBrowserTools,
    mcp_tools: capabilities.filter((capability) => capability.kind === "mcp_tool"),
    custom_tools: capabilities.filter((capability) => capability.kind === "custom_tool"),
    skills: capabilities.filter((capability) => capability.kind === "skill"),
    inspect: capabilities.filter((capability) => capability.policy === "inspect"),
    mutate: capabilities.filter((capability) => capability.policy === "mutate"),
    coordinate: capabilities.filter((capability) => capability.policy === "coordinate"),
    workspace_commands: workspaceCommands,
    workspace_skills: workspaceSkills,
    mcp_tool_aliases: mcpToolAliases.sort((left, right) => left.tool_id.localeCompare(right.tool_id)),
  };
}

export function buildEnabledToolMapFromManifest(manifest: AgentCapabilityManifest): Record<string, boolean> {
  const tools: Record<string, boolean> = {};
  for (const capability of manifest.tools) {
    if (capability.callable_name) {
      tools[capability.callable_name] = true;
    }
  }
  return tools;
}

function summarizeList(values: string[], limit = 8): string {
  const uniqueValues = uniqueSorted(values);
  if (uniqueValues.length === 0) {
    return "none";
  }
  const visible = uniqueValues.slice(0, limit);
  if (uniqueValues.length <= limit) {
    return visible.join(", ");
  }
  return `${visible.join(", ")} (+${uniqueValues.length - limit} more)`;
}

function namesForCapabilities(capabilities: AgentCapabilityRecord[]): string[] {
  return capabilities.map((capability) => capability.callable_name ?? capability.id);
}

export function renderCapabilityPolicyPromptSection(manifest: AgentCapabilityManifest): string {
  const lines = [
    "Capability policy for this run:",
    `Harness for this run: ${manifest.context.harness_id ?? "unknown"}.`,
    `Session kind for this run: ${manifest.context.session_kind ?? "unknown"}.`,
    "Use inspection capabilities to gather context before mutating workspace, app, browser, or runtime state whenever possible.",
    "After edits, shell commands, browser actions, MCP mutations, or runtime mutations, run a follow-up inspection or verification step before claiming success.",
    "Use coordination capabilities to track progress, consult staged skills, or ask for clarification instead of keeping hidden state.",
    "If a capability is not listed below, do not assume it is available in this run.",
    `Inspect capabilities available now: ${summarizeList(namesForCapabilities(manifest.inspect))}`,
    `Mutating capabilities available now: ${summarizeList(namesForCapabilities(manifest.mutate))}`,
    `Coordination capabilities available now: ${summarizeList(namesForCapabilities(manifest.coordinate))}`,
  ];

  if (manifest.browser_tools.length > 0) {
    lines.push(`Browser capabilities available now: ${summarizeList(namesForCapabilities(manifest.browser_tools))}`);
  }
  if (manifest.runtime_tools.length > 0) {
    lines.push(`Runtime capabilities available now: ${summarizeList(namesForCapabilities(manifest.runtime_tools))}`);
  }
  if (manifest.workspace_commands.length > 0) {
    lines.push(`Workspace commands available now: ${summarizeList(manifest.workspace_commands)}`);
  }
  if (manifest.workspace_skills.length > 0) {
    lines.push(`Workspace skills available now: ${summarizeList(manifest.workspace_skills)}`);
  }
  if (manifest.context.browser_tools_available === false) {
    lines.push("Browser tools are not available in this run.");
  }
  if (manifest.mcp_tools.length > 0) {
    lines.push(
      `Connected MCP tools available now: ${summarizeList(manifest.mcp_tools.map((capability) => capability.id), 6)}`
    );
  }

  return lines.join("\n");
}
