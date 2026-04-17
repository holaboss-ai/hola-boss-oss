import { createHash } from "node:crypto";

import {
  DESKTOP_BROWSER_TOOL_DEFINITIONS,
} from "../../harnesses/src/desktop-browser-tools.js";
import {
  NATIVE_WEB_SEARCH_TOOL_DEFINITIONS,
} from "../../harnesses/src/native-web-search-tools.js";
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
  | "mcp_resource"
  | "mcp_prompt"
  | "mcp_command"
  | "custom_tool"
  | "plugin_capability"
  | "local_capability"
  | "skill"
  | "workspace_command";

export type AgentCapabilityPolicy = "inspect" | "mutate" | "coordinate";

export type AgentCapabilityPermissionSurface =
  | "builtin_tool"
  | "runtime_tool"
  | "browser_tool"
  | "mcp_tool"
  | "mcp_resource"
  | "mcp_prompt"
  | "mcp_command"
  | "custom_tool"
  | "plugin_capability"
  | "local_capability"
  | "workspace_skill"
  | "workspace_command";

export type AgentCapabilityExecutionMode =
  | "tool_call"
  | "resource_reference"
  | "prompt_reference"
  | "skill_reference"
  | "command_reference";

export type AgentCapabilityTrustLevel = "system" | "workspace" | "external" | "plugin" | "local";

export type AgentCapabilityVisibilitySurface =
  | "tool"
  | "metadata"
  | "resource"
  | "prompt";

export type AgentCapabilityConcurrency = "parallel_safe" | "serial_only" | "session_exclusive";

export interface AgentCapabilityExecutionSemantics {
  concurrency: AgentCapabilityConcurrency;
  requires_runtime_service: boolean;
  requires_browser: boolean;
  requires_user_confirmation: boolean;
}

export interface AgentCapabilityAuthorityBoundary {
  filesystem: boolean;
  shell: boolean;
  network: boolean;
  browser: boolean;
  runtime_state: boolean;
}

export interface AgentCapabilityPolicyContext {
  harness_id: string | null;
  session_kind: string | null;
  browser_tools_available: boolean | null;
  browser_tool_ids: string[];
  runtime_tool_ids: string[];
  workspace_command_ids: string[];
  mcp_server_ids?: string[];
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
    | "workspace_command"
    | "implied_tool";
}

export interface AgentCapabilityRefreshSemantics {
  evaluation_scope: "per_run";
  skills_resolved_at: "run_start";
  commands_resolved_at: "run_start";
  supports_live_deltas: boolean;
}

export interface AgentCapabilityEvaluationMetadata {
  fingerprint: string;
  refresh_behavior: "run_start_snapshot";
  refresh_summary: string;
}

export interface AgentReservedCapabilitySurface {
  id: string;
  kind: Extract<
    AgentCapabilityKind,
    "mcp_resource" | "mcp_prompt" | "mcp_command" | "plugin_capability" | "local_capability"
  >;
  title: string;
  description: string;
  visibility_surface: AgentCapabilityVisibilitySurface;
  execution_mode: AgentCapabilityExecutionMode;
  trust_level: AgentCapabilityTrustLevel;
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
  reserved_surfaces: AgentReservedCapabilitySurface[];
  mcp_tool_aliases: Array<{
    tool_id: string;
    server_id: string;
    tool_name: string;
    callable_name: string;
  }>;
  evaluation: AgentCapabilityEvaluationMetadata;
  fingerprint: string;
  refresh_semantics: AgentCapabilityRefreshSemantics;
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
  resolvedMcpServerIds?: string[] | null;
  toolServerIdMap?: Readonly<Record<string, string>> | null;
}

interface CapabilityAvailabilityRules {
  harnessIds?: string[];
  sessionKinds?: string[];
}

type ToolCapabilityDefinition = {
  kind: Exclude<AgentCapabilityKind, "mcp_tool" | "skill" | "workspace_command">;
  policy: AgentCapabilityPolicy;
  title: string;
  description: string;
  availability?: CapabilityAvailabilityRules;
};

type CapabilityCallableSpec =
  | {
      kind: "fixed";
      callable_name: string;
    }
  | {
      kind: "mcp";
      server_id: string;
      tool_name: string;
    };

interface StaticAgentCapabilityDescriptor {
  id: string;
  kind: AgentCapabilityKind;
  policy: AgentCapabilityPolicy;
  title: string;
  description: string;
  source: AgentCapabilityRecord["source"];
  callable_spec: CapabilityCallableSpec | null;
  visibility_surface: AgentCapabilityVisibilitySurface;
  permission_surface: AgentCapabilityPermissionSurface;
  execution_mode: AgentCapabilityExecutionMode;
  trust_level: AgentCapabilityTrustLevel;
  execution_semantics: AgentCapabilityExecutionSemantics;
  authority_boundary: AgentCapabilityAuthorityBoundary;
  availability?: CapabilityAvailabilityRules;
}

interface StaticAgentCapabilityRegistry {
  context: AgentCapabilityPolicyContext;
  descriptors: StaticAgentCapabilityDescriptor[];
  workspace_commands: string[];
  workspace_skills: string[];
}

export interface EvaluatedAgentCapability {
  id: string;
  kind: AgentCapabilityKind;
  policy: AgentCapabilityPolicy;
  title: string;
  description: string;
  source: AgentCapabilityRecord["source"];
  visible_to_model: boolean;
  callable_name: string | null;
  callable: boolean;
  permission_allowed: boolean;
  call_allowed: boolean;
  can_execute: boolean;
  permission_surface: AgentCapabilityPermissionSurface;
  execution_mode: AgentCapabilityExecutionMode;
  trust_level: AgentCapabilityTrustLevel;
  execution_semantics: AgentCapabilityExecutionSemantics;
  authority_boundary: AgentCapabilityAuthorityBoundary;
  unavailable_reason: string | null;
  server_id: string | null;
  tool_name: string | null;
}

export interface EvaluatedAgentCapabilitySet {
  context: AgentCapabilityPolicyContext;
  capabilities: EvaluatedAgentCapability[];
  workspace_commands: string[];
  workspace_skills: string[];
  reserved_surfaces: AgentReservedCapabilitySurface[];
  evaluation: AgentCapabilityEvaluationMetadata;
  fingerprint: string;
  refresh_semantics: AgentCapabilityRefreshSemantics;
}

const AGENT_CAPABILITY_REFRESH_SEMANTICS: AgentCapabilityRefreshSemantics = {
  evaluation_scope: "per_run",
  skills_resolved_at: "run_start",
  commands_resolved_at: "run_start",
  supports_live_deltas: false,
};

const RESERVED_AGENT_CAPABILITY_SURFACES: AgentReservedCapabilitySurface[] = [
  {
    id: "mcp_resource",
    kind: "mcp_resource",
    title: "MCP Resource",
    description: "Reserved for future MCP resource surfaces that expose non-tool data handles.",
    visibility_surface: "resource",
    execution_mode: "resource_reference",
    trust_level: "external",
  },
  {
    id: "mcp_prompt",
    kind: "mcp_prompt",
    title: "MCP Prompt Surface",
    description: "Reserved for future MCP prompt surfaces that contribute prompt content without becoming callable tools.",
    visibility_surface: "prompt",
    execution_mode: "prompt_reference",
    trust_level: "external",
  },
  {
    id: "mcp_command",
    kind: "mcp_command",
    title: "MCP Command Surface",
    description: "Reserved for future MCP command surfaces that may behave like named command references instead of direct tools.",
    visibility_surface: "metadata",
    execution_mode: "command_reference",
    trust_level: "external",
  },
  {
    id: "plugin_capability",
    kind: "plugin_capability",
    title: "Plugin Capability",
    description: "Reserved for future plugin-defined capabilities with trust and authority boundaries distinct from built-in tools.",
    visibility_surface: "metadata",
    execution_mode: "tool_call",
    trust_level: "plugin",
  },
  {
    id: "local_capability",
    kind: "local_capability",
    title: "Local Capability",
    description: "Reserved for future trust-sensitive local capability surfaces that should not be conflated with workspace skills or commands.",
    visibility_surface: "metadata",
    execution_mode: "tool_call",
    trust_level: "local",
  },
];

const BUILTIN_CAPABILITY_DEFINITIONS: Record<string, ToolCapabilityDefinition> = {
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
    description: "Create or update the current working todo.",
  },
  todoread: {
    kind: "builtin_tool",
    policy: "coordinate",
    title: "Todo Read",
    description: "Read the current working todo.",
  },
  skill: {
    kind: "builtin_tool",
    policy: "coordinate",
    title: "Skill",
    description: "Consult available embedded or workspace skills when they are relevant.",
  },
};

const RUNTIME_TOOL_DEFINITIONS = new Map<string, ToolCapabilityDefinition>(
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

const BROWSER_TOOL_DEFINITIONS = new Map<string, ToolCapabilityDefinition>(
  DESKTOP_BROWSER_TOOL_DEFINITIONS.map((toolDef) => [
    toolDef.id,
    {
      kind: "browser_tool",
      policy: toolDef.policy,
      title: titleFromToken(toolDef.id),
      description: toolDef.description,
      availability: {
        sessionKinds: toolDef.session_scope === "workspace_session_only" ? ["workspace_session"] : undefined,
      },
    },
  ])
);

const CUSTOM_TOOL_DEFINITIONS = new Map<string, ToolCapabilityDefinition>(
  NATIVE_WEB_SEARCH_TOOL_DEFINITIONS.map((toolDef) => [
    toolDef.id,
    {
      kind: "custom_tool",
      policy: toolDef.policy,
      title: titleFromToken(toolDef.id),
      description: toolDef.description,
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}

function uniqueNormalizedSorted(values: Array<string | null | undefined>): string[] {
  return uniqueSorted(values.map((value) => normalizeOptionalToken(value)).filter(Boolean));
}

function customCapabilityDefinition(toolName: string): ToolCapabilityDefinition {
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

function definitionAllowedInContext(
  availability: CapabilityAvailabilityRules | undefined,
  context: AgentCapabilityPolicyContext
): { allowed: boolean; reason: string | null } {
  if (!availability) {
    return { allowed: true, reason: null };
  }

  const normalizedHarnessId = normalizeOptionalToken(context.harness_id);
  if (
    availability.harnessIds &&
    normalizedHarnessId &&
    !availability.harnessIds.includes(normalizedHarnessId)
  ) {
    return {
      allowed: false,
      reason: "harness_not_allowed",
    };
  }

  const normalizedSessionKind = normalizeOptionalToken(context.session_kind);
  if (
    availability.sessionKinds &&
    normalizedSessionKind &&
    !availability.sessionKinds.includes(normalizedSessionKind)
  ) {
    return {
      allowed: false,
      reason: "session_kind_not_allowed",
    };
  }

  return { allowed: true, reason: null };
}

function resolveToolCapabilityDefinition(toolName: string): ToolCapabilityDefinition {
  const normalized = normalizedToken(toolName);
  return (
    BUILTIN_CAPABILITY_DEFINITIONS[normalized] ??
    RUNTIME_TOOL_DEFINITIONS.get(normalized) ??
    BROWSER_TOOL_DEFINITIONS.get(normalized) ??
    CUSTOM_TOOL_DEFINITIONS.get(normalized) ??
    customCapabilityDefinition(toolName)
  );
}

function executionSemanticsForDescriptor(params: {
  kind: AgentCapabilityKind;
  id: string;
  executionMode: AgentCapabilityExecutionMode;
}): AgentCapabilityExecutionSemantics {
  const normalizedId = normalizedToken(params.id);
  if (params.kind === "browser_tool") {
    return {
      concurrency: "session_exclusive",
      requires_runtime_service: false,
      requires_browser: true,
      requires_user_confirmation: false,
    };
  }
  if (params.kind === "runtime_tool") {
    return {
      concurrency: "serial_only",
      requires_runtime_service: true,
      requires_browser: false,
      requires_user_confirmation: normalizedId === "holaboss_onboarding_complete",
    };
  }
  if (params.kind === "workspace_command") {
    return {
      concurrency: "serial_only",
      requires_runtime_service: false,
      requires_browser: false,
      requires_user_confirmation: false,
    };
  }
  if (params.kind === "skill") {
    return {
      concurrency: "parallel_safe",
      requires_runtime_service: false,
      requires_browser: false,
      requires_user_confirmation: false,
    };
  }
  if (params.kind === "mcp_tool" || params.kind === "custom_tool") {
    return {
      concurrency: "serial_only",
      requires_runtime_service: false,
      requires_browser: false,
      requires_user_confirmation: /approve|confirm|delete|deploy/.test(normalizedId),
    };
  }
  if (normalizedId === "question") {
    return {
      concurrency: "session_exclusive",
      requires_runtime_service: false,
      requires_browser: false,
      requires_user_confirmation: true,
    };
  }
  if (normalizedId === "read" || normalizedId === "grep" || normalizedId === "glob" || normalizedId === "list" || normalizedId === "todoread") {
    return {
      concurrency: "parallel_safe",
      requires_runtime_service: false,
      requires_browser: false,
      requires_user_confirmation: false,
    };
  }
  return {
    concurrency: "serial_only",
    requires_runtime_service: false,
    requires_browser: false,
    requires_user_confirmation: false,
  };
}

function authorityBoundaryForDescriptor(params: {
  kind: AgentCapabilityKind;
  id: string;
}): AgentCapabilityAuthorityBoundary {
  const normalizedId = normalizedToken(params.id);
  if (params.kind === "browser_tool") {
    return {
      filesystem: false,
      shell: false,
      network: false,
      browser: true,
      runtime_state: false,
    };
  }
  if (params.kind === "runtime_tool") {
    return {
      filesystem: false,
      shell: false,
      network: false,
      browser: false,
      runtime_state: true,
    };
  }
  if (params.kind === "mcp_tool" || params.kind === "custom_tool") {
    return {
      filesystem: false,
      shell: false,
      network: true,
      browser: false,
      runtime_state: false,
    };
  }
  if (params.kind === "workspace_command") {
    return {
      filesystem: false,
      shell: false,
      network: false,
      browser: false,
      runtime_state: false,
    };
  }
  if (params.kind === "skill") {
    return {
      filesystem: false,
      shell: false,
      network: false,
      browser: false,
      runtime_state: false,
    };
  }
  if (normalizedId === "bash") {
    return {
      filesystem: true,
      shell: true,
      network: true,
      browser: false,
      runtime_state: false,
    };
  }
  if (normalizedId === "read" || normalizedId === "edit" || normalizedId === "grep" || normalizedId === "glob" || normalizedId === "list") {
    return {
      filesystem: true,
      shell: false,
      network: false,
      browser: false,
      runtime_state: false,
    };
  }
  return {
    filesystem: false,
    shell: false,
    network: false,
    browser: false,
    runtime_state: false,
  };
}

function buildToolDescriptor(
  toolName: string,
  source: AgentCapabilityRecord["source"]
): StaticAgentCapabilityDescriptor | null {
  const trimmed = toolName.trim();
  if (!trimmed) {
    return null;
  }

  const definition = resolveToolCapabilityDefinition(trimmed);
  const executionMode: AgentCapabilityExecutionMode = "tool_call";
  return {
    id: trimmed,
    kind: definition.kind,
    policy: definition.policy,
    title: definition.title,
    description: definition.description,
    source,
    callable_spec: {
      kind: "fixed",
      callable_name: trimmed,
    },
    visibility_surface: "tool",
    permission_surface: definition.kind,
    execution_mode: executionMode,
    trust_level: definition.kind === "custom_tool" ? "external" : "system",
    execution_semantics: executionSemanticsForDescriptor({
      kind: definition.kind,
      id: trimmed,
      executionMode,
    }),
    authority_boundary: authorityBoundaryForDescriptor({
      kind: definition.kind,
      id: trimmed,
    }),
    availability: definition.availability,
  };
}

function buildSkillDescriptor(skillId: string): StaticAgentCapabilityDescriptor | null {
  const trimmed = skillId.trim();
  if (!trimmed) {
    return null;
  }
  return {
    id: trimmed,
    kind: "skill",
    policy: "coordinate",
    title: titleFromToken(trimmed),
    description: `Skill '${trimmed}' is available for domain-specific guidance.`,
    source: "workspace_skill",
    callable_spec: null,
    visibility_surface: "metadata",
    permission_surface: "workspace_skill",
    execution_mode: "skill_reference",
    trust_level: "workspace",
    execution_semantics: executionSemanticsForDescriptor({
      kind: "skill",
      id: trimmed,
      executionMode: "skill_reference",
    }),
    authority_boundary: authorityBoundaryForDescriptor({
      kind: "skill",
      id: trimmed,
    }),
  };
}

function buildWorkspaceCommandDescriptor(commandId: string): StaticAgentCapabilityDescriptor | null {
  const trimmed = commandId.trim();
  if (!trimmed) {
    return null;
  }
  const inferred = customCapabilityDefinition(trimmed);
  return {
    id: trimmed,
    kind: "workspace_command",
    policy: inferred.policy,
    title: titleFromToken(trimmed),
    description: `Workspace command '${trimmed}' is available as a workspace-defined command surface.`,
    source: "workspace_command",
    callable_spec: null,
    visibility_surface: "metadata",
    permission_surface: "workspace_command",
    execution_mode: "command_reference",
    trust_level: "workspace",
    execution_semantics: executionSemanticsForDescriptor({
      kind: "workspace_command",
      id: trimmed,
      executionMode: "command_reference",
    }),
    authority_boundary: authorityBoundaryForDescriptor({
      kind: "workspace_command",
      id: trimmed,
    }),
  };
}

function buildMcpDescriptor(toolRef: AgentCapabilityMcpToolRef): StaticAgentCapabilityDescriptor {
  const executionMode: AgentCapabilityExecutionMode = "tool_call";
  return {
    id: toolRef.tool_id,
    kind: "mcp_tool",
    policy: inferMcpPolicy(toolRef),
    title: titleFromToken(toolRef.tool_name),
    description: `Workspace MCP tool '${toolRef.tool_id}' is connected for this run.`,
    source: "workspace_mcp",
    callable_spec: {
      kind: "mcp",
      server_id: toolRef.server_id,
      tool_name: toolRef.tool_name,
    },
    visibility_surface: "tool",
    permission_surface: "mcp_tool",
    execution_mode: executionMode,
    trust_level: "external",
    execution_semantics: executionSemanticsForDescriptor({
      kind: "mcp_tool",
      id: toolRef.tool_id,
      executionMode,
    }),
    authority_boundary: authorityBoundaryForDescriptor({
      kind: "mcp_tool",
      id: toolRef.tool_id,
    }),
  };
}

function descriptorKey(descriptor: StaticAgentCapabilityDescriptor): string {
  if (descriptor.callable_spec?.kind === "fixed") {
    return `callable:${normalizedToken(descriptor.callable_spec.callable_name)}`;
  }
  if (descriptor.callable_spec?.kind === "mcp") {
    return `mcp:${normalizedToken(descriptor.callable_spec.server_id)}:${normalizedToken(descriptor.callable_spec.tool_name)}`;
  }
  return `surface:${descriptor.kind}:${normalizedToken(descriptor.id)}`;
}

function buildPolicyContext(
  params: BuildAgentCapabilityManifestParams
): {
  context: AgentCapabilityPolicyContext;
  workspaceCommands: string[];
  workspaceSkills: string[];
} {
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
  const mcpServerIds = uniqueSorted((params.resolvedMcpServerIds ?? []).map((serverId) => serverId.trim()));
  const workspaceCommands = uniqueSorted((params.workspaceCommandIds ?? []).map((commandId) => commandId.trim()));
  const workspaceSkills = uniqueSorted(params.workspaceSkillIds.map((skillId) => skillId.trim()));
  const context: AgentCapabilityPolicyContext = {
    harness_id: (params.harnessId ?? "").trim() || null,
    session_kind: (params.sessionKind ?? "").trim() || null,
    browser_tools_available:
      typeof params.browserToolsAvailable === "boolean" ? params.browserToolsAvailable : null,
    browser_tool_ids: browserToolIds,
    runtime_tool_ids: runtimeToolIds,
    workspace_command_ids: workspaceCommands,
  };

  if (mcpServerIds.length > 0) {
    context.mcp_server_ids = mcpServerIds;
  }

  return {
    context,
    workspaceCommands,
    workspaceSkills,
  };
}

function buildStaticCapabilityRegistry(
  params: BuildAgentCapabilityManifestParams
): StaticAgentCapabilityRegistry {
  const { context, workspaceCommands, workspaceSkills } = buildPolicyContext(params);
  const descriptorByKey = new Map<string, StaticAgentCapabilityDescriptor>();

  const upsertDescriptor = (descriptor: StaticAgentCapabilityDescriptor | null) => {
    if (!descriptor) {
      return;
    }
    const key = descriptorKey(descriptor);
    if (descriptorByKey.has(key)) {
      return;
    }
    descriptorByKey.set(key, descriptor);
  };

  for (const toolName of params.defaultTools) {
    upsertDescriptor(buildToolDescriptor(toolName, "default_tool"));
  }
  for (const toolName of params.extraTools) {
    upsertDescriptor(buildToolDescriptor(toolName, "extra_tool"));
  }

  if (workspaceSkills.length > 0) {
    upsertDescriptor(buildToolDescriptor("read", "implied_tool"));
    upsertDescriptor(buildToolDescriptor("skill", "implied_tool"));
    for (const skillId of workspaceSkills) {
      upsertDescriptor(buildSkillDescriptor(skillId));
    }
  }

  for (const commandId of workspaceCommands) {
    upsertDescriptor(buildWorkspaceCommandDescriptor(commandId));
  }
  for (const toolRef of params.resolvedMcpToolRefs) {
    upsertDescriptor(buildMcpDescriptor(toolRef));
  }

  return {
    context,
    descriptors: [...descriptorByKey.values()],
    workspace_commands: workspaceCommands,
    workspace_skills: workspaceSkills,
  };
}

function resolveCallableName(
  descriptor: StaticAgentCapabilityDescriptor,
  toolServerIdMap: Readonly<Record<string, string>> | null | undefined
): { callableName: string | null; serverId: string | null; toolName: string | null } {
  if (!descriptor.callable_spec) {
    return { callableName: null, serverId: null, toolName: null };
  }
  if (descriptor.callable_spec.kind === "fixed") {
    return {
      callableName: descriptor.callable_spec.callable_name,
      serverId: null,
      toolName: null,
    };
  }

  const mappedServerId =
    toolServerIdMap?.[descriptor.callable_spec.server_id] ?? descriptor.callable_spec.server_id;
  return {
    callableName: callableToolNameFromMcpServerAndTool(mappedServerId, descriptor.callable_spec.tool_name),
    serverId: mappedServerId,
    toolName: descriptor.callable_spec.tool_name,
  };
}

function evaluateCallAllowance(
  descriptor: StaticAgentCapabilityDescriptor,
  context: AgentCapabilityPolicyContext
): { allowed: boolean; reason: string | null } {
  if (descriptor.kind === "browser_tool") {
    if (!context.browser_tool_ids.includes(normalizedToken(descriptor.id))) {
      return {
        allowed: false,
        reason: "browser_tool_not_staged",
      };
    }
  }
  if (descriptor.kind === "runtime_tool") {
    if (!context.runtime_tool_ids.includes(normalizedToken(descriptor.id))) {
      return {
        allowed: false,
        reason: "runtime_tool_not_staged",
      };
    }
  }
  return { allowed: true, reason: null };
}

function evaluateExecutionReadiness(
  descriptor: StaticAgentCapabilityDescriptor,
  context: AgentCapabilityPolicyContext
): { ready: boolean; reason: string | null } {
  if (descriptor.kind === "browser_tool" && context.browser_tools_available === false) {
    return {
      ready: false,
      reason: "browser_tools_unavailable",
    };
  }
  return { ready: true, reason: null };
}

function sortEvaluatedCapabilities(
  capabilities: EvaluatedAgentCapability[]
): EvaluatedAgentCapability[] {
  return [...capabilities].sort((left, right) => {
    if (left.policy !== right.policy) {
      return left.policy.localeCompare(right.policy);
    }
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.id.localeCompare(right.id);
  });
}

function fingerprintPayloadForEvaluatedSet(
  evaluatedSet: Omit<EvaluatedAgentCapabilitySet, "fingerprint" | "evaluation">
): string {
  return JSON.stringify({
    context: evaluatedSet.context,
    workspace_commands: evaluatedSet.workspace_commands,
    workspace_skills: evaluatedSet.workspace_skills,
    reserved_surfaces: evaluatedSet.reserved_surfaces,
    refresh_semantics: evaluatedSet.refresh_semantics,
    capabilities: evaluatedSet.capabilities.map((capability) => ({
      id: capability.id,
      kind: capability.kind,
      policy: capability.policy,
      source: capability.source,
      visible_to_model: capability.visible_to_model,
      callable_name: capability.callable_name,
      callable: capability.callable,
      permission_allowed: capability.permission_allowed,
      call_allowed: capability.call_allowed,
      can_execute: capability.can_execute,
      permission_surface: capability.permission_surface,
      execution_mode: capability.execution_mode,
      trust_level: capability.trust_level,
      execution_semantics: capability.execution_semantics,
      authority_boundary: capability.authority_boundary,
      unavailable_reason: capability.unavailable_reason,
      server_id: capability.server_id,
      tool_name: capability.tool_name,
    })),
  });
}

function buildFingerprint(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

function buildEvaluationMetadata(fingerprint: string): AgentCapabilityEvaluationMetadata {
  return {
    fingerprint,
    refresh_behavior: "run_start_snapshot",
    refresh_summary:
      "Capability evaluation is captured once at run start. New skills or commands appear on the next run.",
  };
}

export function evaluateAgentCapabilities(
  params: BuildAgentCapabilityManifestParams
): EvaluatedAgentCapabilitySet {
  const registry = buildStaticCapabilityRegistry(params);

  const evaluatedCapabilities = sortEvaluatedCapabilities(
    registry.descriptors.map((descriptor) => {
      const callable = descriptor.callable_spec !== null;
      const permissionCheck = definitionAllowedInContext(descriptor.availability, registry.context);
      const callCheck =
        callable && permissionCheck.allowed
          ? evaluateCallAllowance(descriptor, registry.context)
          : { allowed: false, reason: permissionCheck.reason };
      const executionCheck =
        callable && callCheck.allowed
          ? evaluateExecutionReadiness(descriptor, registry.context)
          : { ready: false, reason: callCheck.reason };
      const callableResolution = resolveCallableName(descriptor, params.toolServerIdMap ?? null);
      const metadataExecutionReady = descriptor.kind === "skill";
      const visibleToModel =
        descriptor.visibility_surface === "metadata" ||
        (callable && permissionCheck.allowed && callCheck.allowed && executionCheck.ready);

      let unavailableReason: string | null = null;
      if (!permissionCheck.allowed) {
        unavailableReason = permissionCheck.reason;
      } else if (callable && !callCheck.allowed) {
        unavailableReason = callCheck.reason;
      } else if (callable && !executionCheck.ready) {
        unavailableReason = executionCheck.reason;
      }

      return {
        id: descriptor.id,
        kind: descriptor.kind,
        policy: descriptor.policy,
        title: descriptor.title,
        description: descriptor.description,
        source: descriptor.source,
        visible_to_model: visibleToModel,
        callable_name: callableResolution.callableName,
        callable,
        permission_allowed: permissionCheck.allowed,
        call_allowed: callable && permissionCheck.allowed && callCheck.allowed,
        can_execute: callable
          ? permissionCheck.allowed && callCheck.allowed && executionCheck.ready
          : metadataExecutionReady,
        permission_surface: descriptor.permission_surface,
        execution_mode: descriptor.execution_mode,
        trust_level: descriptor.trust_level,
        execution_semantics: descriptor.execution_semantics,
        authority_boundary: descriptor.authority_boundary,
        unavailable_reason:
          unavailableReason ??
          (descriptor.kind === "workspace_command" ? "command_reference_only" : null),
        server_id: callableResolution.serverId,
        tool_name: callableResolution.toolName,
      };
    })
  );

  const fingerprint = buildFingerprint(
    fingerprintPayloadForEvaluatedSet({
      context: registry.context,
      capabilities: evaluatedCapabilities,
      workspace_commands: registry.workspace_commands,
      workspace_skills: registry.workspace_skills,
      reserved_surfaces: RESERVED_AGENT_CAPABILITY_SURFACES,
      refresh_semantics: AGENT_CAPABILITY_REFRESH_SEMANTICS,
    })
  );
  const evaluation = buildEvaluationMetadata(fingerprint);

  return {
    context: registry.context,
    capabilities: evaluatedCapabilities,
    workspace_commands: registry.workspace_commands,
    workspace_skills: registry.workspace_skills,
    reserved_surfaces: RESERVED_AGENT_CAPABILITY_SURFACES,
    evaluation,
    fingerprint,
    refresh_semantics: AGENT_CAPABILITY_REFRESH_SEMANTICS,
  };
}

function projectCapabilityRecord(
  capability: EvaluatedAgentCapability
): AgentCapabilityRecord {
  return {
    id: capability.id,
    kind: capability.kind,
    policy: capability.policy,
    title: capability.title,
    description:
      capability.kind === "mcp_tool" && capability.callable_name
        ? `Workspace MCP tool '${capability.id}' callable as '${capability.callable_name}'.`
        : capability.description,
    callable_name: capability.callable_name,
    source: capability.source,
  };
}

function projectAgentCapabilityManifest(
  evaluatedSet: EvaluatedAgentCapabilitySet
): AgentCapabilityManifest {
  const projectedCapabilities = sortEvaluatedCapabilities(
    evaluatedSet.capabilities.filter(
      (capability) => capability.visible_to_model && capability.kind !== "workspace_command"
    )
  ).map(projectCapabilityRecord);
  const tools = projectedCapabilities.filter((capability) => capability.callable_name !== null);
  const browserTools = projectedCapabilities.filter((capability) => capability.kind === "browser_tool");
  const mcpToolAliases = evaluatedSet.capabilities
    .filter(
      (capability) =>
        capability.kind === "mcp_tool" &&
        capability.callable_name !== null &&
        capability.server_id !== null &&
        capability.tool_name !== null
    )
    .map((capability) => ({
      tool_id: capability.id,
      server_id: capability.server_id as string,
      tool_name: capability.tool_name as string,
      callable_name: capability.callable_name as string,
    }))
    .sort((left, right) => left.tool_id.localeCompare(right.tool_id));

  const context: AgentCapabilityPolicyContext = {
    ...evaluatedSet.context,
    browser_tools_available:
      typeof evaluatedSet.context.browser_tools_available === "boolean"
        ? evaluatedSet.context.browser_tools_available
        : browserTools.length > 0,
    workspace_commands_available: evaluatedSet.workspace_commands.length > 0,
    workspace_skills_available: evaluatedSet.workspace_skills.length > 0,
    mcp_tools_available:
      mcpToolAliases.length > 0 || (evaluatedSet.context.mcp_server_ids?.length ?? 0) > 0,
  };

  return {
    context,
    capabilities: projectedCapabilities,
    tools,
    builtin_tools: projectedCapabilities.filter((capability) => capability.kind === "builtin_tool"),
    runtime_tools: projectedCapabilities.filter((capability) => capability.kind === "runtime_tool"),
    browser_tools: browserTools,
    mcp_tools: projectedCapabilities.filter((capability) => capability.kind === "mcp_tool"),
    custom_tools: projectedCapabilities.filter((capability) => capability.kind === "custom_tool"),
    skills: projectedCapabilities.filter((capability) => capability.kind === "skill"),
    inspect: projectedCapabilities.filter((capability) => capability.policy === "inspect"),
    mutate: projectedCapabilities.filter((capability) => capability.policy === "mutate"),
    coordinate: projectedCapabilities.filter((capability) => capability.policy === "coordinate"),
    workspace_commands: evaluatedSet.workspace_commands,
    workspace_skills: evaluatedSet.workspace_skills,
    reserved_surfaces: evaluatedSet.reserved_surfaces,
    mcp_tool_aliases: mcpToolAliases,
    evaluation: evaluatedSet.evaluation,
    fingerprint: evaluatedSet.fingerprint,
    refresh_semantics: evaluatedSet.refresh_semantics,
  };
}

export function buildAgentCapabilityManifest(
  params: BuildAgentCapabilityManifestParams
): AgentCapabilityManifest {
  return projectAgentCapabilityManifest(evaluateAgentCapabilities(params));
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
    "Use coordination capabilities to track progress, consult available skills, or ask for clarification instead of keeping hidden state.",
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
  if (manifest.runtime_tools.some((capability) => capability.id === "holaboss_cronjobs_create")) {
    lines.push("Cronjob delivery routing: use `session_run` for recurring agent work such as running instructions, tasks, analysis, browsing, or writing.");
    lines.push("Use `system_notification` only for lightweight reminders or notifications where the primary outcome is a short message rather than agent execution.");
    lines.push("When creating or updating cronjobs, put the executable task in `instruction` and keep `description` as a short display summary only.");
    lines.push("Do not repeat schedule wording such as 'every 5 minutes' inside the cronjob `instruction` unless the task itself genuinely requires saying that phrase.");
  }
  if (manifest.runtime_tools.some((capability) => capability.id === "terminal_session_start")) {
    lines.push("Background terminal routing: prefer `terminal_session_start` for long-running, interactive, or revisitable shell work such as dev servers, watch mode, and background jobs.");
    lines.push("Prefer one-shot `bash` for short commands that should complete within the current tool call.");
    lines.push("After starting a background terminal, inspect it with `terminal_session_read` or `terminal_session_wait` before claiming success.");
  }
  if (manifest.workspace_commands.length > 0) {
    lines.push(`Workspace commands available now: ${summarizeList(manifest.workspace_commands)}`);
  }
  if (manifest.workspace_skills.length > 0) {
    lines.push(`Skills available now: ${summarizeList(manifest.workspace_skills)}`);
  }
  if (manifest.context.browser_tools_available === false) {
    lines.push("Browser tools are not available in this run.");
  }
  if (manifest.mcp_tools.length > 0) {
    lines.push(
      `Connected MCP tools available now: ${summarizeList(manifest.mcp_tools.map((capability) => capability.id), 6)}`
    );
  } else if ((manifest.context.mcp_server_ids?.length ?? 0) > 0) {
    lines.push(`Connected MCP servers available now: ${summarizeList(manifest.context.mcp_server_ids ?? [], 6)}`);
    lines.push(
      "Specific MCP tool names may be surfaced dynamically by the runtime even when this prompt section does not pre-enumerate them."
    );
  }

  return lines.join("\n");
}
