import assert from "node:assert/strict";
import test from "node:test";

import {
  collectWorkspaceRuntimePlanReferences,
  compileWorkspaceRuntimePlan,
  runWorkspaceRuntimePlanCli
} from "./workspace-runtime-plan.js";

test("collectWorkspaceRuntimePlanReferences returns AGENTS and app configs", () => {
  const references = collectWorkspaceRuntimePlanReferences({
    workspace_yaml: `
template_id: social_operator
applications:
  - app_id: app-a
    config_path: apps/app-a/app.runtime.yaml
  - app_id: app-b
    config_path: apps/app-b/app.runtime.yaml
`
  });

  assert.deepEqual(references, ["AGENTS.md", "apps/app-a/app.runtime.yaml", "apps/app-b/app.runtime.yaml"]);
});

test("compileWorkspaceRuntimePlan resolves workspace catalog tools", () => {
  const plan = compileWorkspaceRuntimePlan({
    workspace_id: "workspace-1",
    workspace_yaml: `
template_id: demo
name: Demo
agents:
  - id: workspace.general
    model: gpt-5.2
mcp_registry:
  allowlist:
    tool_ids:
      - workspace.echo
  servers:
    workspace:
      type: local
      enabled: true
      timeout_ms: 10000
  catalog:
    workspace.echo:
      module_path: tools.echo
      symbol: echo_tool
`,
    references: {}
  });

  assert.deepEqual(plan.resolved_mcp_tool_refs.map((toolRef) => toolRef.tool_id), ["workspace.echo"]);
  assert.deepEqual(plan.resolved_mcp_servers.map((server) => server.server_id), ["workspace"]);
  assert.deepEqual(plan.workspace_mcp_catalog.map((entry) => entry.module_path), ["tools.echo"]);
  assert.deepEqual(plan.schema_aliases, {});
});

test("compileWorkspaceRuntimePlan accepts the minimal empty workspace scaffold", () => {
  const plan = compileWorkspaceRuntimePlan({
    workspace_id: "workspace-empty",
    workspace_yaml: `
agents:
  id: workspace.general
  model: openai/gpt-5
skills:
  path: skills
mcp_registry:
  allowlist:
    tool_ids: []
  servers: {}
`,
    references: {}
  });

  assert.equal(plan.general_config.type, "single");
  assert.equal(plan.general_config.agent.id, "workspace.general");
  assert.equal(plan.general_config.agent.model, "openai/gpt-5");
  assert.deepEqual(plan.mcp_tool_allowlist, []);
  assert.deepEqual(plan.resolved_mcp_servers.map((server) => server.server_id), []);
});

test("compileWorkspaceRuntimePlan loads prompt and applications", () => {
  const plan = compileWorkspaceRuntimePlan({
    workspace_id: "ws-test",
    workspace_yaml: `
template_id: social_operator
name: Social Operator
agents:
  general:
    type: single
    agent:
      id: workspace.general
      model: gpt-4o
applications:
  - app_id: holaposter-ts-lite
    config_path: apps/holaposter-ts-lite/app.runtime.yaml
mcp_registry:
  allowlist:
    tool_ids:
      - holaposter.create_post
  servers:
    holaposter:
      type: remote
      url: "http://localhost:3099/mcp"
      enabled: true
`,
    references: {
      "AGENTS.md": "You are concise.",
      "apps/holaposter-ts-lite/app.runtime.yaml": `
app_id: holaposter-ts-lite
healthchecks:
  mcp:
    path: /mcp/health
    timeout_s: 60
    interval_s: 5
mcp:
  transport: http-sse
  port: 3099
  path: /mcp
env_contract:
  - HOLABOSS_USER_ID
`
    }
  });

  assert.equal(plan.general_config.type, "single");
  assert.equal(plan.general_config.agent.prompt, "You are concise.");
  assert.equal(plan.resolved_applications.length, 1);
  assert.equal(plan.resolved_applications[0]?.mcp.port, 3099);
  assert.deepEqual(plan.mcp_tool_allowlist, ["holaposter.create_post"]);
  assert.deepEqual(plan.schema_aliases, {});
});

test("compileWorkspaceRuntimePlan rejects multiple agents", () => {
  assert.throws(
    () =>
      compileWorkspaceRuntimePlan({
        workspace_id: "workspace-1",
        workspace_yaml: `
agents:
  - id: agent-1
    model: gpt-5.2
  - id: agent-2
    model: gpt-5.2
mcp_registry:
  allowlist:
    tool_ids: []
  servers: {}
`,
        references: {}
      }),
    /multiple agents are no longer supported/
  );
});

test("compileWorkspaceRuntimePlan rejects legacy team mode", () => {
  assert.throws(
    () =>
      compileWorkspaceRuntimePlan({
        workspace_id: "workspace-1",
        workspace_yaml: `
agents:
  general:
    type: team
    coordinator:
      id: coordinator
      model: gpt-5.2
    members:
      - id: writer
        model: gpt-5.2-mini
mcp_registry:
  allowlist:
    tool_ids: []
  servers: {}
`,
        references: {}
      }),
    /team mode is no longer supported/
  );
});

test("runWorkspaceRuntimePlanCli collects structured references", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runWorkspaceRuntimePlanCli(
    [
      "collect-references",
      "--request-base64",
      Buffer.from(
        JSON.stringify({
          workspace_yaml: `
template_id: social_operator
applications:
  - app_id: app-a
    config_path: apps/app-a/app.runtime.yaml
`
        }),
        "utf8"
      ).toString("base64")
    ],
    {
      io: {
        stdout: {
          write(chunk: string) {
            stdout.push(chunk);
            return true;
          }
        } as NodeJS.WritableStream,
        stderr: {
          write(chunk: string) {
            stderr.push(chunk);
            return true;
          }
        } as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.join(""), "");
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    references: ["AGENTS.md", "apps/app-a/app.runtime.yaml"]
  });
});

test("runWorkspaceRuntimePlanCli returns structured compiler errors", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runWorkspaceRuntimePlanCli(
    [
      "compile",
      "--request-base64",
      Buffer.from(
        JSON.stringify({
          workspace_id: "workspace-1",
          workspace_yaml: `
template_id: demo
agents:
  - id: workspace.general
    model: gpt-5.2
mcp_registry:
  allowlist:
    tool_ids:
      - workspace.memory_search
  servers:
    workspace:
      type: local
  catalog: {}
`
        }),
        "utf8"
      ).toString("base64")
    ],
    {
      io: {
        stdout: {
          write(chunk: string) {
            stdout.push(chunk);
            return true;
          }
        } as NodeJS.WritableStream,
        stderr: {
          write(chunk: string) {
            stderr.push(chunk);
            return true;
          }
        } as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.join(""), "");
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: false,
    error: {
      code: "workspace_mcp_catalog_missing",
      path: "mcp_registry.allowlist.tool_ids[0]",
      message: "workspace tool 'workspace.memory_search' is missing catalog entry in mcp_registry.catalog",
      hint: null
    }
  });
});
