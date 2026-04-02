import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { buildAgentCapabilityManifest } from "./agent-capability-registry.js";
import { decodeTsRunnerRequest, validateTsRunnerRequest } from "./ts-runner-contracts.js";
import type { TsRunnerEvent, TsRunnerRequest } from "./ts-runner-contracts.js";
import {
  relayTsRunnerEvent,
  resolveTsRunnerBootstrapState,
  runTsRunnerCli,
  type TsRunnerExecutionDeps
} from "./ts-runner.js";
import { requireRuntimeHarnessAdapter, type RuntimeHarnessPlugin } from "./harness-registry.js";
import {
  persistWorkspaceMainSessionId,
  readWorkspaceMainSessionId
} from "./ts-runner-session-state.js";

const ORIGINAL_SANDBOX_ROOT = process.env.HB_SANDBOX_ROOT;
const ORIGINAL_EMBEDDED_SKILLS_DIR = process.env.HOLABOSS_EMBEDDED_SKILLS_DIR;
const ORIGINAL_SANDBOX_RUNTIME_API_URL = process.env.SANDBOX_RUNTIME_API_URL;
const ORIGINAL_SANDBOX_RUNTIME_API_HOST = process.env.SANDBOX_RUNTIME_API_HOST;
const ORIGINAL_SANDBOX_RUNTIME_API_PORT = process.env.SANDBOX_RUNTIME_API_PORT;

afterEach(() => {
  if (ORIGINAL_SANDBOX_ROOT === undefined) {
    delete process.env.HB_SANDBOX_ROOT;
  } else {
    process.env.HB_SANDBOX_ROOT = ORIGINAL_SANDBOX_ROOT;
  }

  if (ORIGINAL_EMBEDDED_SKILLS_DIR === undefined) {
    delete process.env.HOLABOSS_EMBEDDED_SKILLS_DIR;
  } else {
    process.env.HOLABOSS_EMBEDDED_SKILLS_DIR = ORIGINAL_EMBEDDED_SKILLS_DIR;
  }

  if (ORIGINAL_SANDBOX_RUNTIME_API_URL === undefined) {
    delete process.env.SANDBOX_RUNTIME_API_URL;
  } else {
    process.env.SANDBOX_RUNTIME_API_URL = ORIGINAL_SANDBOX_RUNTIME_API_URL;
  }

  if (ORIGINAL_SANDBOX_RUNTIME_API_HOST === undefined) {
    delete process.env.SANDBOX_RUNTIME_API_HOST;
  } else {
    process.env.SANDBOX_RUNTIME_API_HOST = ORIGINAL_SANDBOX_RUNTIME_API_HOST;
  }

  if (ORIGINAL_SANDBOX_RUNTIME_API_PORT === undefined) {
    delete process.env.SANDBOX_RUNTIME_API_PORT;
  } else {
    process.env.SANDBOX_RUNTIME_API_PORT = ORIGINAL_SANDBOX_RUNTIME_API_PORT;
  }
});

function encodeRequest(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function setTempSandboxRoot(prefix: string): string {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  return sandboxRoot;
}

function baseRequest(): TsRunnerRequest {
  return {
    workspace_id: "workspace-1",
    session_id: "session-1",
    session_kind: "main",
    input_id: "input-1",
    instruction: "hello world",
    context: {},
    model: null,
    debug: false
  };
}

function baseCompiledPlan() {
  return {
    workspace_id: "workspace-1",
    mode: "single",
    general_config: {
      type: "single",
      agent: {
        id: "main",
        model: "openai/gpt-5.4",
        prompt: "You are concise.",
        role: null
      }
    },
    schema_aliases: {},
    resolved_prompts: { main: "You are concise." },
    resolved_mcp_servers: [],
    resolved_mcp_tool_refs: [],
    workspace_mcp_catalog: [],
    config_checksum: "checksum-1",
    resolved_applications: [],
    mcp_tool_allowlist: []
  } as const;
}

function testDeps(params: {
  harnessEvents?: TsRunnerEvent[];
  harnessResult?: Partial<Awaited<ReturnType<NonNullable<TsRunnerExecutionDeps["runHarnessHost"]>>>>;
  pluginOverrides?: Partial<RuntimeHarnessPlugin>;
} = {}): Partial<TsRunnerExecutionDeps> {
  const harnessEvents = params.harnessEvents ?? [];
  const buildPlugin = (harness: string): RuntimeHarnessPlugin => ({
    id: harness,
    adapter: requireRuntimeHarnessAdapter(harness),
    stageBrowserTools: () => ({ changed: false, toolIds: [] }),
    stageRuntimeTools: () => ({ changed: false, toolIds: [] }),
    stageSkills: () => ({ changed: false, skillIds: [] }),
    stageCommands: () => ({ changed: false, commandIds: [] }),
    prepareRun: async () => {},
    describeRuntimeStatus: async () => ({
      backendConfigPresent: false,
      harnessStatus: { ready: true, state: "ready" }
    }),
    handleRuntimeConfigUpdated: async () => {},
    ensureReady: async () => {},
    backendBaseUrl: () => "http://127.0.0.1:4096",
    timeoutSeconds: () => 1800,
    ...params.pluginOverrides
  });
  return {
    compilePlan: () => baseCompiledPlan() as never,
    startWorkspaceMcpSidecar: async () => null,
    bootstrapApplications: async () => [],
    projectAgentRuntimeConfig: () => ({
      provider_id: "openai",
      model_id: "gpt-5.4",
      mode: "code",
      system_prompt: "You are concise.",
      model_client: {
        model_proxy_provider: "openai_compatible",
        api_key: "token",
        base_url: "http://127.0.0.1:4000/openai/v1",
        default_headers: { "X-Test": "1" }
      },
      tools: { read: true },
      workspace_tool_ids: [],
      workspace_skill_ids: [],
      output_schema_member_id: null,
      output_format: null,
      workspace_config_checksum: "checksum-1"
    }),
    resolveHarnessPlugin: (harness) => buildPlugin(harness),
    runHarnessHost: async ({ emitEvent }) => {
      for (const event of harnessEvents) {
        await emitEvent(event);
      }
      return {
        exitCode: 0,
        stderr: "",
        sawEvent: harnessEvents.length > 0,
        terminalEmitted: harnessEvents.some((event) => ["run_completed", "run_failed"].includes(event.event_type)),
        lastSequence: harnessEvents.reduce((max, event) => Math.max(max, event.sequence), 0),
        ...params.harnessResult
      };
    }
  };
}

test("decodeTsRunnerRequest decodes a valid runner request", () => {
  const request = decodeTsRunnerRequest(
    encodeRequest({
      holaboss_user_id: "user-1",
      workspace_id: "workspace-1",
      session_id: "session-1",
      input_id: "input-1",
      instruction: "hello",
      context: { k: "v" },
      model: "openai/gpt-5.4",
      debug: true
    })
  );

  assert.deepEqual(request, {
    holaboss_user_id: "user-1",
    workspace_id: "workspace-1",
    session_id: "session-1",
    session_kind: null,
    input_id: "input-1",
    instruction: "hello",
    attachments: [],
    context: { k: "v" },
    model: "openai/gpt-5.4",
    debug: true
  });
});

test("validateTsRunnerRequest rejects missing required fields", () => {
  assert.throws(
    () =>
      validateTsRunnerRequest({
        workspace_id: "workspace-1",
        session_id: "session-1",
        instruction: "hello",
        context: {}
      }),
    /input_id is required/
  );
});

test("resolveTsRunnerBootstrapState loads requested and persisted harness session ids", () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-bootstrap-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  const workspaceDir = path.join(sandboxRoot, "workspace", "workspace-1");
  fs.mkdirSync(path.join(workspaceDir, ".holaboss"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, ".holaboss", "harness-session-state.json"),
    JSON.stringify({
      version: 1,
      harness: "pi",
      main_session_id: "persisted-session-1"
    }),
    "utf8"
  );

  const bootstrap = resolveTsRunnerBootstrapState({
    workspace_id: "workspace-1",
    session_id: "session-1",
    input_id: "input-1",
    instruction: "hello",
    context: {
      _sandbox_runtime_exec_v1: {
        harness: "pi",
        harness_session_id: "requested-session-1"
      }
    },
    model: null,
    debug: false
  });

  assert.equal(bootstrap.workspaceDir, workspaceDir);
  assert.equal(bootstrap.harness, "pi");
  assert.equal(bootstrap.requestedHarnessSessionId, "requested-session-1");
  assert.equal(bootstrap.persistedHarnessSessionId, "persisted-session-1");
});

test("relayTsRunnerEvent persists harness_session_id from terminal events", async () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-relay-"));
  const emitted: Array<{ event_type: string; payload: Record<string, unknown> }> = [];

  await relayTsRunnerEvent({
    harness: "pi",
    workspaceDir,
    event: {
      session_id: "session-1",
      input_id: "input-1",
      sequence: 4,
      event_type: "run_completed",
      timestamp: new Date().toISOString(),
      payload: {
        status: "success",
        harness_session_id: "persisted-session-2"
      }
    },
    emitEvent: async (event) => {
      emitted.push({
        event_type: event.event_type,
        payload: event.payload
      });
    }
  });

  assert.equal(emitted.length, 1);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(workspaceDir, ".holaboss", "harness-session-state.json"), "utf8")),
    {
      version: 2,
      harness_sessions: {
        pi: {
          main_session_id: "persisted-session-2"
        }
      }
    }
  );
});

test("relayTsRunnerEvent clears persisted harness session ids after run_failed", async () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-relay-clear-"));
  persistWorkspaceMainSessionId({
    workspaceDir,
    harness: "pi",
    sessionId: "persisted-session-2"
  });

  await relayTsRunnerEvent({
    harness: "pi",
    workspaceDir,
    event: {
      session_id: "session-1",
      input_id: "input-1",
      sequence: 4,
      event_type: "run_failed",
      timestamp: new Date().toISOString(),
      payload: {
        type: "OpenCodeSessionError",
        message: "boom",
        harness_session_id: "failed-session-1"
      }
    },
    emitEvent: async () => {}
  });

  assert.equal(readWorkspaceMainSessionId({ workspaceDir, harness: "pi" }), null);
});

test("runTsRunnerCli relays harness-host events after run_claimed", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-success-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  let stdout = "";
  let stderr = "";
  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        context: {
          _sandbox_runtime_exec_v1: {
            harness: "pi",
          }
        }
      })
    ],
    {
      deps: testDeps({
        harnessEvents: [
          {
            session_id: "session-1",
            input_id: "input-1",
            sequence: 1,
            event_type: "run_started",
            timestamp: new Date().toISOString(),
            payload: { phase: "running" }
          },
          {
            session_id: "session-1",
            input_id: "input-1",
            sequence: 2,
            event_type: "run_completed",
            timestamp: new Date().toISOString(),
            payload: {
              status: "success",
              harness_session_id: "persisted-session-3"
            }
          }
        ]
      }),
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");

  const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].event_type, "run_claimed");
  assert.equal(lines[0].payload.instruction_preview, "hello world");
  assert.equal(lines[1].event_type, "run_started");
  assert.equal(lines[1].payload.phase, "running");
  assert.equal(lines[2].event_type, "run_completed");
  assert.equal(lines[2].payload.status, "success");
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(sandboxRoot, "workspace", "workspace-1", ".holaboss", "harness-session-state.json"), "utf8")
    ),
    {
      version: 2,
      harness_sessions: {
        pi: {
          main_session_id: "persisted-session-3"
        }
      }
    }
  );
});

test("runTsRunnerCli persists pi harness session ids when runtime context selects pi", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-pi-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  let stdout = "";
  let capturedHarness = "";

  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        context: {
          _sandbox_runtime_exec_v1: {
            harness: "pi"
          }
        }
      })
    ],
    {
      deps: {
        ...testDeps({
          harnessEvents: [
            {
              session_id: "session-1",
              input_id: "input-1",
              sequence: 1,
              event_type: "run_started",
              timestamp: new Date().toISOString(),
              payload: { phase: "running" }
            },
            {
              session_id: "session-1",
              input_id: "input-1",
              sequence: 2,
              event_type: "run_completed",
              timestamp: new Date().toISOString(),
              payload: {
                status: "success",
                harness_session_id: "/tmp/pi-session.jsonl"
              }
            }
          ]
        }),
        runHarnessHost: async ({ harness, emitEvent }) => {
          capturedHarness = harness;
          await emitEvent({
            session_id: "session-1",
            input_id: "input-1",
            sequence: 1,
            event_type: "run_started",
            timestamp: new Date().toISOString(),
            payload: { phase: "running" }
          });
          await emitEvent({
            session_id: "session-1",
            input_id: "input-1",
            sequence: 2,
            event_type: "run_completed",
            timestamp: new Date().toISOString(),
            payload: {
              status: "success",
              harness_session_id: "/tmp/pi-session.jsonl"
            }
          });
          return {
            exitCode: 0,
            stderr: "",
            sawEvent: true,
            terminalEmitted: true,
            lastSequence: 2
          };
        }
      },
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(capturedHarness, "pi");
  assert.equal(stdout.trim().split("\n").length, 3);
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(sandboxRoot, "workspace", "workspace-1", ".holaboss", "harness-session-state.json"), "utf8")
    ),
    {
      version: 2,
      harness_sessions: {
        pi: {
          main_session_id: "/tmp/pi-session.jsonl"
        }
      }
    }
  );
});

test("runTsRunnerCli passes MCP servers and tool refs into the pi harness request", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-pi-mcp-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  let capturedRequestPayload: Record<string, unknown> | null = null;

  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        context: {
          _sandbox_runtime_exec_v1: {
            harness: "pi"
          }
        }
      })
    ],
    {
      deps: {
        ...testDeps(),
        compilePlan: () =>
          ({
            ...baseCompiledPlan(),
            resolved_mcp_servers: [
              {
                server_id: "docs",
                type: "remote",
                url: "http://127.0.0.1:9200/mcp",
                headers: [],
                environment: [],
                timeout_ms: 25000,
                enabled: true,
                command: []
              }
            ],
            resolved_mcp_tool_refs: [
              {
                tool_id: "docs.lookup",
                server_id: "docs",
                tool_name: "lookup"
              }
            ]
          }) as never,
        runHarnessHost: async ({ requestPayload }) => {
          capturedRequestPayload = requestPayload;
          return {
            exitCode: 0,
            stderr: "",
            sawEvent: false,
            terminalEmitted: false,
            lastSequence: 0
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedRequestPayload);
  assert.deepEqual((capturedRequestPayload as { mcp_servers: Array<Record<string, unknown>> }).mcp_servers, [
    {
      name: "docs",
      config: {
        type: "remote",
        enabled: true,
        url: "http://127.0.0.1:9200/mcp",
        headers: {},
        timeout: 25000
      }
    }
  ]);
  assert.deepEqual((capturedRequestPayload as { mcp_tool_refs: Array<Record<string, unknown>> }).mcp_tool_refs, [
    {
      tool_id: "docs.lookup",
      server_id: "docs",
      tool_name: "lookup"
    }
  ]);
});

test("runTsRunnerCli only advertises structured output when the selected harness supports it", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-pi-structured-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  process.env.SANDBOX_RUNTIME_API_HOST = "127.0.0.1";
  process.env.SANDBOX_RUNTIME_API_PORT = "5060";
  let capturedRequestPayload: Record<string, unknown> | null = null;
  const capabilityManifest = buildAgentCapabilityManifest({
    harnessId: "pi",
    sessionKind: "main",
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
  });

  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        context: {
          _sandbox_runtime_exec_v1: {
            harness: "pi"
          }
        }
      })
    ],
    {
      deps: {
        ...testDeps(),
        projectAgentRuntimeConfig: () => ({
          provider_id: "openai",
          model_id: "gpt-5.4",
          mode: "code",
          system_prompt: "You are concise.",
          prompt_sections: [
            {
              id: "runtime_core",
              channel: "system_prompt",
              apply_at: "runtime_config",
              priority: 100,
              volatility: "stable",
              content: "You are concise."
            },
            {
              id: "execution_policy",
              channel: "system_prompt",
              apply_at: "runtime_config",
              priority: 200,
              volatility: "stable",
              content: "Inspect before mutating."
            },
            {
              id: "session_policy",
              channel: "system_prompt",
              apply_at: "runtime_config",
              priority: 300,
              volatility: "run",
              content: "This is the main session."
            },
            {
              id: "capability_policy",
              channel: "system_prompt",
              apply_at: "runtime_config",
              priority: 400,
              volatility: "run",
              content: "Use available tools."
            }
          ],
          model_client: {
            model_proxy_provider: "openai_compatible",
            api_key: "token",
            base_url: "http://127.0.0.1:4000/openai/v1",
            default_headers: { "X-Test": "1" }
          },
          tools: { read: true },
          workspace_tool_ids: [],
          workspace_skill_ids: [],
          capability_manifest: capabilityManifest,
          output_schema_member_id: "main",
          output_format: { type: "json_schema", schema: { type: "object" } },
          workspace_config_checksum: "checksum-1"
        }),
        runHarnessHost: async ({ requestPayload }) => {
          capturedRequestPayload = requestPayload;
          return {
            exitCode: 0,
            stderr: "",
            sawEvent: false,
            terminalEmitted: false,
            lastSequence: 0
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedRequestPayload);
  assert.equal(
    (capturedRequestPayload as { runtime_api_base_url?: string | null }).runtime_api_base_url,
    "http://127.0.0.1:5060"
  );
  const runStartedPayload = (capturedRequestPayload as { run_started_payload: Record<string, unknown> }).run_started_payload;
  assert.deepEqual({
    instruction_preview: runStartedPayload.instruction_preview,
    provider_id: runStartedPayload.provider_id,
    model_id: runStartedPayload.model_id,
    workspace_tool_ids: runStartedPayload.workspace_tool_ids,
    workspace_skill_ids: runStartedPayload.workspace_skill_ids,
    prompt_section_ids: runStartedPayload.prompt_section_ids,
    request_snapshot_fingerprint: runStartedPayload.request_snapshot_fingerprint,
    capability_manifest_fingerprint: runStartedPayload.capability_manifest_fingerprint,
    mcp_server_ids: runStartedPayload.mcp_server_ids,
    mcp_server_mappings: runStartedPayload.mcp_server_mappings,
    workspace_mcp_sidecar_reused: runStartedPayload.workspace_mcp_sidecar_reused,
    structured_output_enabled: runStartedPayload.structured_output_enabled,
    workspace_config_checksum: runStartedPayload.workspace_config_checksum
  }, {
    instruction_preview: "hello world",
    provider_id: "openai",
    model_id: "gpt-5.4",
    workspace_tool_ids: [],
    workspace_skill_ids: [],
    prompt_section_ids: [
      "runtime_core",
      "execution_policy",
      "session_policy",
      "capability_policy",
    ],
    request_snapshot_fingerprint: runStartedPayload.request_snapshot_fingerprint,
    capability_manifest_fingerprint: runStartedPayload.capability_manifest_fingerprint,
    mcp_server_ids: [],
    mcp_server_mappings: [],
    workspace_mcp_sidecar_reused: false,
    structured_output_enabled: false,
    workspace_config_checksum: "checksum-1"
  });
  assert.equal(typeof runStartedPayload.bootstrap_started_at, "string");
  assert.equal(typeof runStartedPayload.bootstrap_ready_at, "string");
  assert.equal(typeof runStartedPayload.bootstrap_total_ms, "number");
  assert.ok((runStartedPayload.bootstrap_total_ms as number) >= 0);
  assert.match(String(runStartedPayload.request_snapshot_fingerprint ?? ""), /^[a-f0-9]{64}$/);
  assert.match(String(runStartedPayload.capability_manifest_fingerprint ?? ""), /^[a-f0-9]{64}$/);
  const bootstrapStageTimingKeys = Object.keys((runStartedPayload.bootstrap_stage_timings_ms as Record<string, unknown>) ?? {}).sort();
  assert.deepEqual(
    bootstrapStageTimingKeys,
    [
      "build_harness_host_request",
      "compile_runtime_plan",
      "load_recalled_memory_context",
      "load_recent_runtime_context",
      "load_session_resume_context",
      "persist_turn_request_snapshot",
      "prepare_harness_run",
      "project_runtime_config",
      "resolve_workspace_skills",
      "stage_browser_tools",
      "stage_runtime_tools"
    ]
  );
});

test("runTsRunnerCli includes staged runtime tool ids in the projected extra tool set", async () => {
  setTempSandboxRoot("hb-ts-runner-runtime-tools-");
  let capturedProjectRequest: Record<string, unknown> | null = null;

  const exitCode = await runTsRunnerCli(
    ["--request-base64", encodeRequest(baseRequest())],
    {
      deps: {
        ...testDeps({
          pluginOverrides: {
            stageBrowserTools: () => ({ changed: false, toolIds: ["browser_get_state"] }),
            stageRuntimeTools: () => ({ changed: false, toolIds: ["holaboss_onboarding_complete"] })
          }
        }),
        projectAgentRuntimeConfig: (request) => {
          capturedProjectRequest = request as unknown as Record<string, unknown>;
          return {
            provider_id: "openai",
            model_id: "gpt-5.4",
            mode: "code",
            system_prompt: "You are concise.",
            model_client: {
              model_proxy_provider: "openai_compatible",
              api_key: "token",
              base_url: "http://127.0.0.1:4000/openai/v1",
              default_headers: { "X-Test": "1" }
            },
            tools: { read: true },
            workspace_tool_ids: [],
            workspace_skill_ids: [],
            output_schema_member_id: null,
            output_format: null,
            workspace_config_checksum: "checksum-1"
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedProjectRequest);
  assert.equal((capturedProjectRequest as { browser_tools_available: boolean }).browser_tools_available, true);
  assert.deepEqual(
    (capturedProjectRequest as { browser_tool_ids: string[] }).browser_tool_ids,
    ["browser_get_state"]
  );
  assert.deepEqual(
    (capturedProjectRequest as { runtime_tool_ids: string[] }).runtime_tool_ids,
    ["holaboss_onboarding_complete"]
  );
  assert.deepEqual(
    (capturedProjectRequest as { extra_tools: string[] }).extra_tools,
    ["browser_get_state", "holaboss_onboarding_complete"]
  );
});

test("runTsRunnerCli derives recent runtime context from the latest prior turn result", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-recent-context-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  const workspaceRoot = path.join(sandboxRoot, "workspace");
  const store = new RuntimeStateStore({
    workspaceRoot,
    sandboxRoot,
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
    mainSessionId: "session-1",
  });
  store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-1",
    inputId: "input-0",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    status: "failed",
    stopReason: "permission_denied",
    assistantText: "",
    toolUsageSummary: {
      total_calls: 1,
      completed_calls: 0,
      failed_calls: 1,
      tool_names: ["deploy"],
      tool_ids: ["workspace.deploy"],
    },
    permissionDenials: [
      {
        tool_name: "deploy",
        tool_id: "workspace.deploy",
        reason: "permission denied by policy",
      },
    ],
    promptSectionIds: ["runtime_core", "execution_policy"],
    capabilityManifestFingerprint: "c".repeat(64),
    compactedSummary: "Run failed while trying to deploy because policy denied the action.",
    tokenUsage: { input_tokens: 3, output_tokens: 5 },
  });
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-1",
    role: "user",
    text: "Please continue after deploy permissions are fixed.",
    messageId: "user-input-0",
  });
  store.close();

  let capturedProjectRequest: Record<string, unknown> | null = null;
  const exitCode = await runTsRunnerCli(
    ["--request-base64", encodeRequest(baseRequest())],
    {
      deps: {
        ...testDeps(),
        projectAgentRuntimeConfig: (request) => {
          capturedProjectRequest = request as unknown as Record<string, unknown>;
          return {
            provider_id: "openai",
            model_id: "gpt-5.4",
            mode: "code",
            system_prompt: "You are concise.",
            model_client: {
              model_proxy_provider: "openai_compatible",
              api_key: "token",
              base_url: "http://127.0.0.1:4000/openai/v1",
              default_headers: { "X-Test": "1" }
            },
            tools: { read: true },
            workspace_tool_ids: [],
            workspace_skill_ids: [],
            output_schema_member_id: null,
            output_format: null,
            workspace_config_checksum: "checksum-1"
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedProjectRequest);
  assert.deepEqual(
    (capturedProjectRequest as { recent_runtime_context: Record<string, unknown> }).recent_runtime_context,
    {
      summary: "Run failed while trying to deploy because policy denied the action.",
      last_stop_reason: "permission_denied",
      last_error: "permission_denied",
      waiting_for_user: null,
    }
  );
  assert.deepEqual(
    (capturedProjectRequest as { session_resume_context: Record<string, unknown> }).session_resume_context,
    {
      recent_turns: [
        {
          input_id: "input-0",
          status: "failed",
          stop_reason: "permission_denied",
          summary: "Run failed while trying to deploy because policy denied the action.",
          completed_at: "2026-01-01T00:00:05.000Z",
        },
      ],
      recent_user_messages: [
        "Please continue after deploy permissions are fixed.",
      ],
    }
  );
});

test("runTsRunnerCli restores resume context from the latest prior compaction boundary", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-compaction-boundary-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  const workspaceRoot = path.join(sandboxRoot, "workspace");
  const store = new RuntimeStateStore({
    workspaceRoot,
    sandboxRoot,
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
    mainSessionId: "session-1",
  });
  store.upsertCompactionBoundary({
    boundaryId: "compaction:input-0",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    inputId: "input-0",
    summary: "Resume from compacted deploy attempt.",
    recentRuntimeContext: {
      summary: "Resume from compacted deploy attempt.",
      last_stop_reason: "waiting_user",
      last_error: null,
      waiting_for_user: true,
    },
    restorationContext: {
      compaction_source: "executor_post_turn",
      restoration_order: [
        "boundary_summary",
        "recent_runtime_context",
        "session_resume_context",
        "preserved_turn_input_ids",
        "restored_memory_paths",
      ],
      session_resume_context: {
        recent_turns: [
          {
            input_id: "input-0",
            status: "waiting_user",
            stop_reason: "waiting_user",
            summary: "Deploy paused waiting for confirmation.",
            completed_at: "2026-01-01T00:00:05.000Z",
          },
        ],
        recent_user_messages: [
          "Continue after confirmation once the deploy is approved.",
        ],
      },
      restored_memory_paths: [
        "workspace/workspace-1/runtime/latest-turn.md",
      ],
    },
    preservedTurnInputIds: ["input-0"],
  });
  store.close();

  let capturedProjectRequest: Record<string, unknown> | null = null;
  const exitCode = await runTsRunnerCli(
    ["--request-base64", encodeRequest(baseRequest())],
    {
      deps: {
        ...testDeps(),
        projectAgentRuntimeConfig: (request) => {
          capturedProjectRequest = request as unknown as Record<string, unknown>;
          return {
            provider_id: "openai",
            model_id: "gpt-5.4",
            mode: "code",
            system_prompt: "You are concise.",
            model_client: {
              model_proxy_provider: "openai_compatible",
              api_key: "token",
              base_url: "http://127.0.0.1:4000/openai/v1",
              default_headers: { "X-Test": "1" }
            },
            tools: { read: true },
            workspace_tool_ids: [],
            workspace_skill_ids: [],
            output_schema_member_id: null,
            output_format: null,
            workspace_config_checksum: "checksum-1"
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedProjectRequest);
  assert.deepEqual(
    (capturedProjectRequest as { recent_runtime_context: Record<string, unknown> }).recent_runtime_context,
    {
      summary: "Resume from compacted deploy attempt.",
      last_stop_reason: "waiting_user",
      last_error: null,
      waiting_for_user: true,
    }
  );
  assert.deepEqual(
    (capturedProjectRequest as { session_resume_context: Record<string, unknown> }).session_resume_context,
    {
      recent_turns: [
        {
          input_id: "input-0",
          status: "waiting_user",
          stop_reason: "waiting_user",
          summary: "Deploy paused waiting for confirmation.",
          completed_at: "2026-01-01T00:00:05.000Z",
        },
      ],
      recent_user_messages: [
        "Continue after confirmation once the deploy is approved.",
      ],
      compaction_source: "executor_post_turn",
      compaction_boundary_id: "compaction:input-0",
      compaction_boundary_summary: "Resume from compacted deploy attempt.",
      restoration_order: [
        "boundary_summary",
        "recent_runtime_context",
        "session_resume_context",
        "preserved_turn_input_ids",
        "restored_memory_paths",
      ],
      preserved_turn_input_ids: ["input-0"],
      restored_memory_paths: [
        "workspace/workspace-1/runtime/latest-turn.md",
      ],
    }
  );
});

test("runTsRunnerCli derives recalled durable memory from indexed memory entries", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-recalled-memory-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  const workspaceRoot = path.join(sandboxRoot, "workspace");
  const store = new RuntimeStateStore({
    workspaceRoot,
    sandboxRoot,
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
    mainSessionId: "session-1",
  });
  store.upsertMemoryEntry({
    memoryId: "user-preference:response-style",
    workspaceId: null,
    sessionId: "session-1",
    scope: "user",
    memoryType: "preference",
    subjectKey: "response-style",
    path: "preference/response-style.md",
    title: "User response style",
    summary: "User prefers concise responses.",
    tags: ["concise"],
    verificationPolicy: "none",
    stalenessPolicy: "stable",
    staleAfterSeconds: null,
    sourceTurnInputId: "input-0",
    sourceMessageId: "user-0",
    fingerprint: "p".repeat(64),
  });
  store.upsertMemoryEntry({
    memoryId: "workspace-blocker:workspace-1:deploy",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    scope: "workspace",
    memoryType: "blocker",
    subjectKey: "permission:deploy",
    path: "workspace/workspace-1/knowledge/blockers/deploy.md",
    title: "Deploy permission blocker",
    summary: "Deploy calls may be denied by workspace policy.",
    tags: ["deploy", "permission", "blocker"],
    verificationPolicy: "check_before_use",
    stalenessPolicy: "workspace_sensitive",
    staleAfterSeconds: 14 * 24 * 60 * 60,
    sourceTurnInputId: "input-0",
    sourceMessageId: null,
    fingerprint: "d".repeat(64),
  });
  store.close();

  let capturedProjectRequest: Record<string, unknown> | null = null;
  const exitCode = await runTsRunnerCli(
    ["--request-base64", encodeRequest({ ...baseRequest(), instruction: "Please deploy after fixing permissions." })],
    {
      deps: {
        ...testDeps(),
        projectAgentRuntimeConfig: (request) => {
          capturedProjectRequest = request as unknown as Record<string, unknown>;
          return {
            provider_id: "openai",
            model_id: "gpt-5.4",
            mode: "code",
            system_prompt: "You are concise.",
            model_client: {
              model_proxy_provider: "openai_compatible",
              api_key: "token",
              base_url: "http://127.0.0.1:4000/openai/v1",
              default_headers: { "X-Test": "1" }
            },
            tools: { read: true },
            workspace_tool_ids: [],
            workspace_skill_ids: [],
            output_schema_member_id: null,
            output_format: null,
            workspace_config_checksum: "checksum-1"
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedProjectRequest);
  const recalledMemoryContext = (capturedProjectRequest as {
    recalled_memory_context: { entries: Array<Record<string, unknown>>; selection_trace: Array<Record<string, unknown>> }
  }).recalled_memory_context;
  assert.equal(recalledMemoryContext.entries.length, 2);
  assert.deepEqual(
    recalledMemoryContext.entries.map((entry) => ({
      scope: entry.scope,
      memory_type: entry.memory_type,
      title: entry.title,
      summary: entry.summary,
      path: entry.path,
      verification_policy: entry.verification_policy,
      staleness_policy: entry.staleness_policy,
      freshness_state: entry.freshness_state,
      source_type: entry.source_type,
      })),
    [
      {
        scope: "user",
        memory_type: "preference",
        title: "User response style",
        summary: "User prefers concise responses.",
        path: "preference/response-style.md",
        verification_policy: "none",
        staleness_policy: "stable",
        freshness_state: "stable",
        source_type: null,
      },
      {
        scope: "workspace",
        memory_type: "blocker",
        title: "Deploy permission blocker",
        summary: "Deploy calls may be denied by workspace policy.",
        path: "workspace/workspace-1/knowledge/blockers/deploy.md",
        verification_policy: "check_before_use",
        staleness_policy: "workspace_sensitive",
        freshness_state: "fresh",
        source_type: null,
      },
    ]
  );
  assert.match(String(recalledMemoryContext.entries[0]?.updated_at ?? ""), /\d{4}-\d{2}-\d{2}T/);
  assert.match(String(recalledMemoryContext.entries[1]?.updated_at ?? ""), /\d{4}-\d{2}-\d{2}T/);
  assert.equal(recalledMemoryContext.selection_trace.length, 2);
  assert.equal(recalledMemoryContext.selection_trace[0]?.memory_id, "user-preference:response-style");
});

test("runTsRunnerCli only stages browser tools for the main session", async () => {
  setTempSandboxRoot("hb-ts-runner-browser-scope-");
  const seenSessionKinds: Array<string | null | undefined> = [];
  let capturedProjectRequest: Record<string, unknown> | null = null;

  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        session_kind: "task_proposal"
      })
    ],
    {
      deps: {
        ...testDeps({
          pluginOverrides: {
            stageBrowserTools: ({ sessionKind }) => {
              seenSessionKinds.push(sessionKind);
              return { changed: false, toolIds: sessionKind === "main" ? ["browser_get_state"] : [] };
            },
            stageRuntimeTools: () => ({ changed: false, toolIds: ["holaboss_onboarding_complete"] })
          }
        }),
        projectAgentRuntimeConfig: (request) => {
          capturedProjectRequest = request as unknown as Record<string, unknown>;
          return {
            provider_id: "openai",
            model_id: "gpt-5.4",
            mode: "code",
            system_prompt: "You are concise.",
            model_client: {
              model_proxy_provider: "openai_compatible",
              api_key: "token",
              base_url: "http://127.0.0.1:4000/openai/v1",
              default_headers: { "X-Test": "1" }
            },
            tools: { read: true },
            workspace_tool_ids: [],
            workspace_skill_ids: [],
            output_schema_member_id: null,
            output_format: null,
            workspace_config_checksum: "checksum-1"
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(seenSessionKinds, ["task_proposal"]);
  assert.ok(capturedProjectRequest);
  assert.equal((capturedProjectRequest as { browser_tools_available: boolean }).browser_tools_available, false);
  assert.equal((capturedProjectRequest as { session_kind: string | null }).session_kind, "task_proposal");
  assert.deepEqual((capturedProjectRequest as { browser_tool_ids: string[] }).browser_tool_ids, []);
  assert.deepEqual(
    (capturedProjectRequest as { runtime_tool_ids: string[] }).runtime_tool_ids,
    ["holaboss_onboarding_complete"]
  );
  assert.deepEqual(
    (capturedProjectRequest as { extra_tools: string[] }).extra_tools,
    ["holaboss_onboarding_complete"]
  );
});

test("runTsRunnerCli includes embedded default skill ids and source directories for the pi harness", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-pi-embedded-skills-"));
  const embeddedSkillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-embedded-skill-root-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  process.env.HOLABOSS_EMBEDDED_SKILLS_DIR = embeddedSkillsRoot;
  const workspaceDir = path.join(sandboxRoot, "workspace", "workspace-1");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const embeddedSkillDir = path.join(embeddedSkillsRoot, "holaboss-runtime");
  fs.mkdirSync(embeddedSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(embeddedSkillDir, "SKILL.md"),
    "---\ndescription: Runtime skill\n---\n# Holaboss Runtime\n",
    "utf8"
  );

  let capturedProjectRequest: Record<string, unknown> | null = null;
  let capturedHarnessRequest: Record<string, unknown> | null = null;

  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        context: {
          _sandbox_runtime_exec_v1: {
            harness: "pi"
          }
        }
      })
    ],
    {
      deps: {
        ...testDeps(),
        projectAgentRuntimeConfig: (request) => {
          capturedProjectRequest = request as unknown as Record<string, unknown>;
          return {
            provider_id: "openai",
            model_id: "gpt-5.4",
            mode: "code",
            system_prompt: "You are concise.",
            model_client: {
              model_proxy_provider: "openai_compatible",
              api_key: "token",
              base_url: "http://127.0.0.1:4000/openai/v1",
              default_headers: { "X-Test": "1" }
            },
            tools: { read: true, skill: true },
            workspace_tool_ids: [],
            workspace_skill_ids: ["holaboss-runtime"],
            output_schema_member_id: null,
            output_format: null,
            workspace_config_checksum: "checksum-1"
          };
        },
        runHarnessHost: async ({ requestPayload }) => {
          capturedHarnessRequest = requestPayload;
          return {
            exitCode: 0,
            stderr: "",
            sawEvent: false,
            terminalEmitted: false,
            lastSequence: 0
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedProjectRequest);
  assert.deepEqual(
    (capturedProjectRequest as { workspace_skill_ids: string[] }).workspace_skill_ids,
    ["holaboss-runtime"]
  );
  assert.ok(capturedHarnessRequest);
  assert.deepEqual(
    (capturedHarnessRequest as { workspace_skill_dirs: string[] }).workspace_skill_dirs,
    [fs.realpathSync(embeddedSkillDir)]
  );
});

test("runTsRunnerCli keeps embedded skills authoritative when a workspace skill reuses the same id", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-pi-embedded-skill-shadow-"));
  const embeddedSkillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-embedded-skill-shadow-root-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  process.env.HOLABOSS_EMBEDDED_SKILLS_DIR = embeddedSkillsRoot;
  const workspaceDir = path.join(sandboxRoot, "workspace", "workspace-1");
  const workspaceSkillDir = path.join(workspaceDir, "skills", "holaboss-runtime");
  fs.mkdirSync(workspaceSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceSkillDir, "SKILL.md"),
    "---\ndescription: Workspace override\n---\n# Workspace Override\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    ['skills:', '  path: "skills"', '  enabled:', '    - "holaboss-runtime"'].join("\n"),
    "utf8"
  );
  const embeddedSkillDir = path.join(embeddedSkillsRoot, "holaboss-runtime");
  fs.mkdirSync(embeddedSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(embeddedSkillDir, "SKILL.md"),
    "---\ndescription: Embedded runtime skill\n---\n# Holaboss Runtime\n",
    "utf8"
  );

  let capturedProjectRequest: Record<string, unknown> | null = null;
  let capturedHarnessRequest: Record<string, unknown> | null = null;

  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        context: {
          _sandbox_runtime_exec_v1: {
            harness: "pi"
          }
        }
      })
    ],
    {
      deps: {
        ...testDeps(),
        projectAgentRuntimeConfig: (request) => {
          capturedProjectRequest = request as unknown as Record<string, unknown>;
          return {
            provider_id: "openai",
            model_id: "gpt-5.4",
            mode: "code",
            system_prompt: "You are concise.",
            model_client: {
              model_proxy_provider: "openai_compatible",
              api_key: "token",
              base_url: "http://127.0.0.1:4000/openai/v1",
              default_headers: { "X-Test": "1" }
            },
            tools: { read: true, skill: true },
            workspace_tool_ids: [],
            workspace_skill_ids: ["holaboss-runtime"],
            output_schema_member_id: null,
            output_format: null,
            workspace_config_checksum: "checksum-1"
          };
        },
        runHarnessHost: async ({ requestPayload }) => {
          capturedHarnessRequest = requestPayload;
          return {
            exitCode: 0,
            stderr: "",
            sawEvent: false,
            terminalEmitted: false,
            lastSequence: 0
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedProjectRequest);
  assert.deepEqual(
    (capturedProjectRequest as { workspace_skill_ids: string[] }).workspace_skill_ids,
    ["holaboss-runtime"]
  );
  assert.ok(capturedHarnessRequest);
  assert.deepEqual(
    (capturedHarnessRequest as { workspace_skill_dirs: string[] }).workspace_skill_dirs,
    [fs.realpathSync(embeddedSkillDir)]
  );
});

test("runTsRunnerCli resolves workspace skill ids and source directories for the pi harness", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-pi-skills-source-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  const workspaceDir = path.join(sandboxRoot, "workspace", "workspace-1");
  const skillDir = path.join(workspaceDir, "skills", "alpha");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\ndescription: Alpha skill\n---\n# Alpha\n", "utf8");
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    ['skills:', '  path: "skills"', '  enabled:', '    - "alpha"'].join("\n"),
    "utf8"
  );

  let capturedProjectRequest: Record<string, unknown> | null = null;
  let capturedHarnessRequest: Record<string, unknown> | null = null;

  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        context: {
          _sandbox_runtime_exec_v1: {
            harness: "pi"
          }
        }
      })
    ],
    {
      deps: {
        ...testDeps(),
        projectAgentRuntimeConfig: (request) => {
          capturedProjectRequest = request as unknown as Record<string, unknown>;
          return {
            provider_id: "openai",
            model_id: "gpt-5.4",
            mode: "code",
            system_prompt: "You are concise.",
            model_client: {
              model_proxy_provider: "openai_compatible",
              api_key: "token",
              base_url: "http://127.0.0.1:4000/openai/v1",
              default_headers: { "X-Test": "1" }
            },
            tools: { read: true },
            workspace_tool_ids: [],
            workspace_skill_ids: ["alpha"],
            output_schema_member_id: null,
            output_format: null,
            workspace_config_checksum: "checksum-1"
          };
        },
        runHarnessHost: async ({ requestPayload }) => {
          capturedHarnessRequest = requestPayload;
          return {
            exitCode: 0,
            stderr: "",
            sawEvent: false,
            terminalEmitted: false,
            lastSequence: 0
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedProjectRequest);
  assert.equal((capturedProjectRequest as { harness_id: string | null }).harness_id, "pi");
  assert.deepEqual((capturedProjectRequest as { workspace_skill_ids: string[] }).workspace_skill_ids, ["alpha"]);
  assert.ok(capturedHarnessRequest);
  assert.deepEqual((capturedHarnessRequest as { workspace_skill_dirs: string[] }).workspace_skill_dirs, [fs.realpathSync(skillDir)]);
});

test("runTsRunnerCli skips workspace command staging for harnesses that do not support it", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-pi-commands-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  let stageCommandsCalls = 0;

  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        context: {
          _sandbox_runtime_exec_v1: {
            harness: "pi"
          }
        }
      })
    ],
    {
      deps: {
        ...testDeps({
          pluginOverrides: {
            stageCommands: () => {
              stageCommandsCalls += 1;
              return { changed: false, commandIds: [] };
            }
          }
        }),
        runHarnessHost: async () => ({
          exitCode: 0,
          stderr: "",
          sawEvent: false,
          terminalEmitted: false,
          lastSequence: 0
        })
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stageCommandsCalls, 0);
});

test("runTsRunnerCli skips skill staging when the harness prep plan disables it", { concurrency: false }, async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-pi-skills-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  const piHarnessAdapter = requireRuntimeHarnessAdapter("pi");
  const originalBuildRunnerPrepPlan = piHarnessAdapter.buildRunnerPrepPlan;
  let stageSkillsCalls = 0;

  piHarnessAdapter.buildRunnerPrepPlan = () => ({
    stageWorkspaceSkills: false,
    stageWorkspaceCommands: false,
    prepareMcpTooling: true,
    startWorkspaceMcpSidecar: true,
    bootstrapResolvedApplications: true
  });
  try {
    const exitCode = await runTsRunnerCli(
      [
        "--request-base64",
        encodeRequest({
          ...baseRequest(),
          context: {
            _sandbox_runtime_exec_v1: {
              harness: "pi"
            }
          }
        })
      ],
      {
        deps: {
          ...testDeps({
            pluginOverrides: {
              stageSkills: () => {
                stageSkillsCalls += 1;
                return { changed: false, skillIds: [] };
              }
            }
          }),
          runHarnessHost: async () => ({
            exitCode: 0,
            stderr: "",
            sawEvent: false,
            terminalEmitted: false,
            lastSequence: 0
          })
        },
        io: {
          stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
          stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(stageSkillsCalls, 0);
  } finally {
    piHarnessAdapter.buildRunnerPrepPlan = originalBuildRunnerPrepPlan;
  }
});

test("runTsRunnerCli skips MCP prep when the harness prep plan disables it", { concurrency: false }, async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-pi-no-mcp-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  const piHarnessAdapter = requireRuntimeHarnessAdapter("pi");
  const originalBuildRunnerPrepPlan = piHarnessAdapter.buildRunnerPrepPlan;
  let startWorkspaceMcpSidecarCalls = 0;
  let bootstrapApplicationsCalls = 0;
  let capturedProjectRequest: Record<string, unknown> | null = null;
  let capturedHarnessRequest: Record<string, unknown> | null = null;

  piHarnessAdapter.buildRunnerPrepPlan = () => ({
    stageWorkspaceSkills: true,
    stageWorkspaceCommands: false,
    prepareMcpTooling: false,
    startWorkspaceMcpSidecar: false,
    bootstrapResolvedApplications: false
  });
  try {
    const exitCode = await runTsRunnerCli(
      [
        "--request-base64",
        encodeRequest({
          ...baseRequest(),
          context: {
            _sandbox_runtime_exec_v1: {
              harness: "pi"
            }
          }
        })
      ],
      {
        deps: {
          ...testDeps(),
          compilePlan: () =>
            ({
              ...baseCompiledPlan(),
              resolved_mcp_servers: [
                {
                  server_id: "workspace",
                  type: "local",
                  url: null,
                  headers: [],
                  environment: [],
                  timeout_ms: 20000,
                  enabled: true,
                  command: ["node", "workspace-mcp.js"]
                }
              ],
              resolved_mcp_tool_refs: [
                {
                  tool_id: "workspace.lookup",
                  server_id: "workspace",
                  tool_name: "lookup"
                }
              ],
              workspace_mcp_catalog: [
                {
                  tool_id: "workspace.lookup",
                  tool_name: "lookup",
                  module_path: "tools/lookup.ts",
                  symbol_name: "lookupTool"
                }
              ],
              resolved_applications: [
                {
                  app_id: "app-a",
                  mcp: { transport: "http-sse", port: 3099, path: "/mcp" },
                  health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
                  env_contract: [],
                  start_command: "npm run start",
                  base_dir: "apps/app-a",
                  lifecycle: { setup: "", start: "", stop: "" }
                }
              ]
            }) as never,
          projectAgentRuntimeConfig: (request) => {
            capturedProjectRequest = request as unknown as Record<string, unknown>;
            return {
              provider_id: "openai",
              model_id: "gpt-5.4",
              mode: "code",
              system_prompt: "You are concise.",
              model_client: {
                model_proxy_provider: "openai_compatible",
                api_key: "token",
                base_url: "http://127.0.0.1:4000/openai/v1",
                default_headers: { "X-Test": "1" }
              },
              tools: { read: true },
              workspace_tool_ids: [],
              workspace_skill_ids: [],
              output_schema_member_id: null,
              output_format: null,
              workspace_config_checksum: "checksum-1"
            };
          },
          startWorkspaceMcpSidecar: async () => {
            startWorkspaceMcpSidecarCalls += 1;
            return null;
          },
          bootstrapApplications: async () => {
            bootstrapApplicationsCalls += 1;
            return [];
          },
          runHarnessHost: async ({ requestPayload }) => {
            capturedHarnessRequest = requestPayload;
            return {
              exitCode: 0,
              stderr: "",
              sawEvent: false,
              terminalEmitted: false,
              lastSequence: 0
            };
          }
        },
        io: {
          stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
          stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(startWorkspaceMcpSidecarCalls, 0);
    assert.equal(bootstrapApplicationsCalls, 0);
    assert.ok(capturedProjectRequest);
    assert.deepEqual((capturedProjectRequest as { tool_server_id_map: Record<string, string> }).tool_server_id_map, {});
    assert.deepEqual(
      (capturedProjectRequest as { resolved_mcp_tool_refs: Array<Record<string, string>> }).resolved_mcp_tool_refs,
      []
    );
    assert.ok(capturedHarnessRequest);
    assert.deepEqual((capturedHarnessRequest as { mcp_servers: unknown[] }).mcp_servers, []);
    assert.deepEqual((capturedHarnessRequest as { mcp_tool_refs: unknown[] }).mcp_tool_refs, []);
  } finally {
    piHarnessAdapter.buildRunnerPrepPlan = originalBuildRunnerPrepPlan;
  }
});

test("runTsRunnerCli pushes emitted events with retry semantics", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-push-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  let stdout = "";
  const attempts: Array<{ eventType: string; sequence: number }> = [];
  const statuses = [500, 204, 204, 204];
  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        ...baseRequest(),
        instruction: "hello",
        context: {
          _sandbox_runtime_push_v1: {
            run_id: "run-1",
            callback_url: "https://runtime.example/push",
            callback_token: "token-1",
            ack_timeout_ms: 500,
            max_retries: 1
          }
        }
      })
    ],
    {
      deps: testDeps({
        harnessEvents: [
          {
            session_id: "session-1",
            input_id: "input-1",
            sequence: 1,
            event_type: "run_started",
            timestamp: new Date().toISOString(),
            payload: { phase: "running" }
          },
          {
            session_id: "session-1",
            input_id: "input-1",
            sequence: 2,
            event_type: "run_completed",
            timestamp: new Date().toISOString(),
            payload: { status: "success" }
          }
        ]
      }),
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      },
      fetchImpl: (async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { event_type: string; sequence: number };
        attempts.push({ eventType: body.event_type, sequence: body.sequence });
        const status = statuses.shift() ?? 204;
        return new Response(status === 204 ? null : "", { status });
      }) as typeof fetch
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(
    attempts.map((attempt) => `${attempt.eventType}:${attempt.sequence}`),
    ["run_claimed:1", "run_claimed:1", "run_started:1", "run_completed:2"]
  );
  assert.equal(stdout.trim().split("\n").length, 3);
});

test("runTsRunnerCli synthesizes run_failed when harness-host ends without a terminal event", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-no-terminal-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  let stdout = "";
  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest(baseRequest())
    ],
    {
      deps: testDeps({
        harnessEvents: [
          {
            session_id: "session-1",
            input_id: "input-1",
            sequence: 1,
            event_type: "run_started",
            timestamp: new Date().toISOString(),
            payload: { phase: "running" }
          }
        ],
        harnessResult: {
          sawEvent: true,
          terminalEmitted: false,
          lastSequence: 1,
          exitCode: 0,
          stderr: ""
        }
      }),
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.equal(lines[2].event_type, "run_failed");
  assert.deepEqual(lines[2].payload, {
    type: "RuntimeError",
    message: "TypeScript harness host ended before terminal event"
  });
});

test("runTsRunnerCli appends bootstrapped app MCP servers into the harness-host request", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-apps-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  let capturedRequestPayload: Record<string, unknown> | null = null;

  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest(baseRequest())
    ],
    {
      deps: {
        ...testDeps(),
        compilePlan: () => ({
          ...baseCompiledPlan(),
          resolved_applications: [
            {
              app_id: "app-a",
              mcp: { transport: "http-sse", port: 3099, path: "/mcp" },
              health_check: { path: "/health", timeout_s: 60, interval_s: 5 },
              env_contract: ["HOLABOSS_USER_ID"],
              start_command: "npm run start",
              base_dir: "apps/app-a",
              lifecycle: { setup: "", start: "", stop: "" }
            }
          ]
        }) as never,
        bootstrapApplications: async () => [
          {
            name: "app-a",
            config: {
              type: "remote",
              enabled: true,
              url: "http://localhost:13100/mcp",
              headers: { "X-Workspace-Id": "workspace-1" },
              timeout: 60000
            }
          }
        ],
        runHarnessHost: async ({ requestPayload }) => {
          capturedRequestPayload = requestPayload;
          return {
            exitCode: 0,
            stderr: "",
            sawEvent: false,
            terminalEmitted: false,
            lastSequence: 0
          };
        }
      },
      io: {
        stdout: { write() { return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(capturedRequestPayload);
  const mcpServers = (capturedRequestPayload as { mcp_servers: Array<Record<string, unknown>> }).mcp_servers;
  assert.deepEqual(mcpServers.map((server) => server.name), ["app-a"]);
});

test("runTsRunnerCli emits validation failures as run_failed JSONL", async () => {
  setTempSandboxRoot("hb-ts-runner-validation-");
  let stdout = "";
  const exitCode = await runTsRunnerCli(
    [
      "--request-base64",
      encodeRequest({
        workspace_id: "workspace-1",
        session_id: "session-1",
        instruction: "hello",
        context: {}
      })
    ],
    {
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write() { return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 1);

  const event = JSON.parse(stdout.trim());
  assert.equal(event.session_id, "session-1");
  assert.equal(event.input_id, "unknown");
  assert.equal(event.event_type, "run_failed");
  assert.equal(event.payload.type, "TsRunnerRequestError");
  assert.match(String(event.payload.message), /invalid runner request payload: input_id is required/);
});
