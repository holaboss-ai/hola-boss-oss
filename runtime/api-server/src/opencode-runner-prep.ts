import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  collectWorkspaceRuntimePlanReferences,
  compileWorkspaceRuntimePlan,
  type CompiledWorkspaceRuntimePlan,
} from "./workspace-runtime-plan.js";

const WORKSPACE_MCP_SERVER_ID = "workspace";

export type PreparedMcpServerPayload = {
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
};

export type RunningWorkspaceMcpSidecar = {
  physical_server_id: string;
  url: string;
  timeout_ms: number;
  pid?: number | null;
  reused: boolean;
};

function assertSafeRelativePath(relativePath: string): string {
  const normalized = path.normalize(relativePath);
  if (!normalized || path.isAbsolute(normalized) || normalized.split(path.sep).includes("..")) {
    throw new Error(`workspace reference path '${relativePath}' is invalid`);
  }
  return normalized;
}

function readWorkspaceReference(workspaceDir: string, relativePath: string): string {
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const normalized = assertSafeRelativePath(relativePath);
  const target = path.resolve(resolvedWorkspaceDir, normalized);
  const relativeTarget = path.relative(resolvedWorkspaceDir, target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error(`workspace reference path '${relativePath}' escapes workspace root`);
  }
  return fs.readFileSync(target, "utf8");
}

export function readWorkspaceRuntimePlanReferences(workspaceDir: string): Record<string, string> {
  const workspaceYaml = fs.readFileSync(path.join(path.resolve(workspaceDir), "workspace.yaml"), "utf8");
  const references = collectWorkspaceRuntimePlanReferences({ workspace_yaml: workspaceYaml });
  const resolved: Record<string, string> = {};
  for (const relativePath of references) {
    resolved[relativePath] = readWorkspaceReference(workspaceDir, relativePath);
  }
  return resolved;
}

export function compileWorkspaceRuntimePlanFromWorkspace(params: {
  workspaceId: string;
  workspaceDir: string;
}): CompiledWorkspaceRuntimePlan {
  const workspaceDir = path.resolve(params.workspaceDir);
  const workspaceYaml = fs.readFileSync(path.join(workspaceDir, "workspace.yaml"), "utf8");
  return compileWorkspaceRuntimePlan({
    workspace_id: params.workspaceId,
    workspace_yaml: workspaceYaml,
    references: readWorkspaceRuntimePlanReferences(workspaceDir),
  });
}

export function workspaceMcpPhysicalServerId(params: {
  workspaceId: string;
  sandboxId: string;
}): string {
  const workspaceSegment = params.workspaceId.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "workspace";
  const digest = createHash("sha256").update(`${params.sandboxId}:${workspaceSegment}`, "utf8").digest("hex").slice(0, 16);
  return `${WORKSPACE_MCP_SERVER_ID}__${digest}`;
}

export function mcpServerIdMap(params: {
  workspaceId: string;
  sandboxId: string;
  compiledPlan: CompiledWorkspaceRuntimePlan;
}): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const server of params.compiledPlan.resolved_mcp_servers) {
    mapping[server.server_id] = server.server_id;
  }
  if (mapping[WORKSPACE_MCP_SERVER_ID] || params.compiledPlan.workspace_mcp_catalog.length > 0) {
    mapping[WORKSPACE_MCP_SERVER_ID] = workspaceMcpPhysicalServerId({
      workspaceId: params.workspaceId,
      sandboxId: params.sandboxId,
    });
  }
  return mapping;
}

function pairsToMapping(items: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries(items);
}

function resolveEnvPlaceholders(mapping: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping)) {
    const token = value.trim();
    const match = token.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
    if (!match) {
      resolved[key] = value;
      continue;
    }
    const envName = match[1]!;
    const envValue = process.env[envName];
    if (envValue === undefined) {
      throw new Error(`environment variable '${envName}' is required by MCP config for '${key}'`);
    }
    resolved[key] = envValue;
  }
  return resolved;
}

export function workspaceMcpCatalogFingerprint(compiledPlan: CompiledWorkspaceRuntimePlan): string {
  const payload = {
    catalog: compiledPlan.workspace_mcp_catalog.map((entry) => ({
      tool_id: entry.tool_id,
      module_path: entry.module_path,
      symbol_name: entry.symbol_name,
    })),
    timeouts: Object.fromEntries(
      compiledPlan.resolved_mcp_servers
        .filter((server) => server.server_id === WORKSPACE_MCP_SERVER_ID)
        .map((server) => [server.server_id, server.timeout_ms]),
    ),
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function mcpServerPayloads(
  compiledPlan: CompiledWorkspaceRuntimePlan,
  serverIdMap?: Readonly<Record<string, string>>,
): PreparedMcpServerPayload[] {
  return compiledPlan.resolved_mcp_servers.map((server) => {
    const name = serverIdMap?.[server.server_id] ?? server.server_id;
    const headers = resolveEnvPlaceholders(pairsToMapping(server.headers));
    const environment = resolveEnvPlaceholders(pairsToMapping(server.environment));
    if (server.type === "local") {
      return {
        name,
        config: {
          type: "local",
          enabled: true,
          command: [...server.command],
          environment,
          timeout: server.timeout_ms,
        },
      };
    }
    return {
      name,
      config: {
        type: "remote",
        enabled: true,
        url: server.url,
        headers,
        timeout: server.timeout_ms,
      },
    };
  });
}

export function effectiveMcpServerPayloads(params: {
  compiledPlan: CompiledWorkspaceRuntimePlan;
  sidecar: RunningWorkspaceMcpSidecar | null;
  serverIdMap?: Readonly<Record<string, string>>;
}): PreparedMcpServerPayload[] {
  const payloads = mcpServerPayloads(params.compiledPlan, params.serverIdMap);
  if (!params.sidecar) {
    return payloads;
  }
  const sidecarPayload: PreparedMcpServerPayload = {
    name: params.sidecar.physical_server_id,
    config: {
      type: "remote",
      enabled: true,
      url: params.sidecar.url,
      headers: {},
      timeout: params.sidecar.timeout_ms,
    },
    _holaboss_force_refresh: !params.sidecar.reused,
  };
  const existingIndex = payloads.findIndex((payload) => payload.name === params.sidecar!.physical_server_id);
  if (existingIndex >= 0) {
    payloads[existingIndex] = sidecarPayload;
    return payloads;
  }
  payloads.push(sidecarPayload);
  return payloads;
}
