import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compileWorkspaceRuntimePlanFromWorkspace,
  encodeWorkspaceMcpCatalog,
  effectiveMcpServerPayloads,
  mergePreparedMcpServerPayloads,
  mcpServerMappingMetadata,
  mcpServerIdMap,
  readWorkspaceRuntimePlanReferences,
  workspaceMcpCatalogFingerprint,
  workspaceMcpPhysicalServerId,
} from "./opencode-runner-prep.js";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("compileWorkspaceRuntimePlanFromWorkspace reads referenced prompt files from disk", () => {
  const root = makeTempDir("hb-opencode-runner-prep-");
  fs.writeFileSync(
    path.join(root, "workspace.yaml"),
    [
      "template_id: demo",
      "name: Demo",
      "agents:",
      "  general:",
      "    type: single",
      "    agent:",
      "      id: main",
      "      model: gpt-5",
      "mcp_registry:",
      "  allowlist:",
      "    tool_ids: []",
      "  servers: {}",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "AGENTS.md"), "You are concise.\n", "utf8");

  assert.deepEqual(readWorkspaceRuntimePlanReferences(root), {
    "AGENTS.md": "You are concise.\n",
  });

  const plan = compileWorkspaceRuntimePlanFromWorkspace({
    workspaceId: "workspace-1",
    workspaceDir: root,
  });
  assert.equal(plan.workspace_id, "workspace-1");
  assert.equal(plan.general_config.type, "single");
  assert.equal(plan.resolved_prompts.main.trim(), "You are concise.");
});

test("mcpServerIdMap assigns a stable physical workspace server id", () => {
  const compiledPlan = {
    resolved_mcp_servers: [{ server_id: "workspace" }, { server_id: "twitter" }],
    workspace_mcp_catalog: [{ tool_id: "workspace.lookup", module_path: "tools/a.py", symbol_name: "lookup" }],
  } as never;

  const mapping = mcpServerIdMap({
    workspaceId: "workspace-1",
    sandboxId: "sandbox-1",
    compiledPlan,
  });
  assert.equal(mapping.twitter, "twitter");
  assert.equal(mapping.workspace, workspaceMcpPhysicalServerId({ workspaceId: "workspace-1", sandboxId: "sandbox-1" }));
});

test("workspaceMcpCatalogFingerprint is stable for equivalent plans", () => {
  const planA = {
    workspace_mcp_catalog: [{ tool_id: "workspace.lookup", module_path: "tools/a.py", symbol_name: "lookup" }],
    resolved_mcp_servers: [{ server_id: "workspace", timeout_ms: 5000 }],
  } as never;
  const planB = {
    workspace_mcp_catalog: [{ tool_id: "workspace.lookup", module_path: "tools/a.py", symbol_name: "lookup" }],
    resolved_mcp_servers: [{ server_id: "workspace", timeout_ms: 5000 }],
  } as never;

  assert.equal(workspaceMcpCatalogFingerprint(planA), workspaceMcpCatalogFingerprint(planB));
});

test("encodeWorkspaceMcpCatalog preserves the workspace MCP catalog shape", () => {
  const compiledPlan = {
    workspace_mcp_catalog: [
      {
        tool_id: "workspace.lookup",
        tool_name: "lookup",
        module_path: "tools/a.py",
        symbol_name: "lookup_tool"
      }
    ]
  } as never;

  assert.deepEqual(
    JSON.parse(Buffer.from(encodeWorkspaceMcpCatalog(compiledPlan), "base64").toString("utf8")),
    [
      {
        tool_id: "workspace.lookup",
        tool_name: "lookup",
        module_path: "tools/a.py",
        symbol_name: "lookup_tool"
      }
    ]
  );
});

test("mcpServerMappingMetadata reports only rewritten logical ids", () => {
  assert.deepEqual(
    mcpServerMappingMetadata({
      workspace: "workspace__abc",
      twitter: "twitter"
    }),
    [
      {
        logical_id: "workspace",
        physical_id: "workspace__abc"
      }
    ]
  );
});

test("effectiveMcpServerPayloads replaces logical workspace server with sidecar payload", () => {
  const compiledPlan = {
    resolved_mcp_servers: [
      {
        server_id: "workspace",
        type: "remote",
        command: [],
        url: "http://old/mcp",
        headers: [],
        environment: [],
        timeout_ms: 9000,
      },
    ],
    workspace_mcp_catalog: [],
  } as never;

  const payloads = effectiveMcpServerPayloads({
    compiledPlan,
    sidecar: {
      physical_server_id: "workspace__abc",
      url: "http://127.0.0.1:9911/mcp",
      timeout_ms: 7000,
      reused: false,
    },
    serverIdMap: { workspace: "workspace__abc" },
  });

  assert.deepEqual(payloads, [
    {
      name: "workspace__abc",
      config: {
        type: "remote",
        enabled: true,
        url: "http://127.0.0.1:9911/mcp",
        headers: {},
        timeout: 7000,
      },
      _holaboss_force_refresh: true,
    },
  ]);
});

test("mergePreparedMcpServerPayloads prefers later bootstrapped servers with the same name", () => {
  const merged = mergePreparedMcpServerPayloads(
    [
      {
        name: "twitter",
        config: {
          type: "remote",
          enabled: true,
          url: "http://localhost:13100/mcp/sse",
          headers: {},
          timeout: 30000
        }
      },
      {
        name: "linkedin",
        config: {
          type: "remote",
          enabled: true,
          url: "http://localhost:13101/mcp/sse",
          headers: {},
          timeout: 30000
        }
      }
    ],
    [
      {
        name: "twitter",
        config: {
          type: "remote",
          enabled: true,
          url: "http://127.0.0.1:38081/mcp/sse",
          headers: { "X-Workspace-Id": "workspace-1" },
          timeout: 60000
        }
      }
    ]
  );

  assert.deepEqual(merged, [
    {
      name: "twitter",
      config: {
        type: "remote",
        enabled: true,
        url: "http://127.0.0.1:38081/mcp/sse",
        headers: { "X-Workspace-Id": "workspace-1" },
        timeout: 60000
      },
      _holaboss_force_refresh: true
    },
    {
      name: "linkedin",
      config: {
        type: "remote",
        enabled: true,
        url: "http://localhost:13101/mcp/sse",
        headers: {},
        timeout: 30000
      }
    }
  ]);
});
