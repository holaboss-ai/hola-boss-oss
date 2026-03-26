import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { decodeTsRunnerRequest, validateTsRunnerRequest } from "./ts-runner-contracts.js";
import type { TsRunnerEvent, TsRunnerRequest } from "./ts-runner-contracts.js";
import {
  executeTsRunnerRequest,
  relayTsRunnerEvent,
  resolveTsRunnerBootstrapState,
  runTsRunnerCli,
  type TsRunnerExecutionDeps
} from "./ts-runner.js";

const ORIGINAL_SANDBOX_ROOT = process.env.HB_SANDBOX_ROOT;

afterEach(() => {
  if (ORIGINAL_SANDBOX_ROOT === undefined) {
    delete process.env.HB_SANDBOX_ROOT;
  } else {
    process.env.HB_SANDBOX_ROOT = ORIGINAL_SANDBOX_ROOT;
  }
});

function encodeRequest(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function baseRequest(): TsRunnerRequest {
  return {
    workspace_id: "workspace-1",
    session_id: "session-1",
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
        model: "openai/gpt-5.1",
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
} = {}): Partial<TsRunnerExecutionDeps> {
  const harnessEvents = params.harnessEvents ?? [];
  return {
    stageSkills: () => ({ changed: false, skillIds: [] }),
    stageCommands: () => ({ changed: false }),
    compilePlan: () => baseCompiledPlan() as never,
    startWorkspaceMcpSidecar: async () => null,
    bootstrapApplications: async () => [],
    projectRuntimeConfig: () => ({
      provider_id: "openai",
      model_id: "gpt-5.1",
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
    updateOpencodeConfig: () => ({
      path: "/tmp/opencode.json",
      provider_config_changed: false,
      model_selection_changed: false
    }),
    restartOpencodeSidecar: async () => {},
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
      model: "openai/gpt-5.1",
      debug: true
    })
  );

  assert.deepEqual(request, {
    holaboss_user_id: "user-1",
    workspace_id: "workspace-1",
    session_id: "session-1",
    input_id: "input-1",
    instruction: "hello",
    context: { k: "v" },
    model: "openai/gpt-5.1",
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
      harness: "opencode",
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
        harness_session_id: "requested-session-1"
      }
    },
    model: null,
    debug: false
  });

  assert.equal(bootstrap.workspaceDir, workspaceDir);
  assert.equal(bootstrap.requestedHarnessSessionId, "requested-session-1");
  assert.equal(bootstrap.persistedHarnessSessionId, "persisted-session-1");
});

test("relayTsRunnerEvent persists harness_session_id from terminal events", async () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-relay-"));
  const emitted: Array<{ event_type: string; payload: Record<string, unknown> }> = [];

  await relayTsRunnerEvent({
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
      version: 1,
      harness: "opencode",
      main_session_id: "persisted-session-2"
    }
  );
});

test("runTsRunnerCli relays harness-host events after run_claimed", async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-success-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  let stdout = "";
  let stderr = "";
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
  assert.equal(lines.length, 6);
  assert.equal(lines[0].event_type, "run_claimed");
  assert.equal(lines[0].payload.instruction_preview, "hello world");
  assert.deepEqual(
    lines.slice(1, 4).map((event) => [event.event_type, event.payload.phase]),
    [
      ["thinking_delta", "plan_compiled"],
      ["thinking_delta", "runtime_config_ready"],
      ["thinking_delta", "opencode_sidecar_ready"]
    ]
  );
  assert.equal(lines[4].event_type, "run_started");
  assert.equal(lines[4].sequence, 5);
  assert.equal(lines[4].payload.phase, "running");
  assert.equal(lines[5].event_type, "run_completed");
  assert.equal(lines[5].sequence, 6);
  assert.equal(lines[5].payload.status, "success");
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(sandboxRoot, "workspace", "workspace-1", ".holaboss", "harness-session-state.json"), "utf8")
    ),
    {
      version: 1,
      harness: "opencode",
      main_session_id: "persisted-session-3"
    }
  );
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
    [
      "run_claimed:1",
      "run_claimed:1",
      "thinking_delta:2",
      "thinking_delta:3",
      "thinking_delta:4",
      "run_started:5",
      "run_completed:6"
    ]
  );
  assert.equal(stdout.trim().split("\n").length, 6);
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
  assert.equal(lines.length, 6);
  assert.equal(lines[5].event_type, "run_failed");
  assert.deepEqual(lines[5].payload, {
    type: "RuntimeError",
    message: "TypeScript OpenCode harness host ended before terminal event"
  });
});

test("executeTsRunnerRequest offsets harness event sequences after bootstrap status events", async () => {
  const emitted: TsRunnerEvent[] = [];

  await executeTsRunnerRequest(baseRequest(), {
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
    emitEvent: async (event) => {
      emitted.push(event);
    }
  });

  assert.deepEqual(
    emitted.map((event) => [event.event_type, event.sequence, event.payload.phase ?? null]),
    [
      ["run_claimed", 1, null],
      ["thinking_delta", 2, "plan_compiled"],
      ["thinking_delta", 3, "runtime_config_ready"],
      ["thinking_delta", 4, "opencode_sidecar_ready"],
      ["run_started", 5, "running"],
      ["run_completed", 6, null]
    ]
  );
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
