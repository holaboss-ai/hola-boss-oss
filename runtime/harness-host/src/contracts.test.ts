import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeHarnessHostOpencodeRequestBase64,
  decodeOpencodeCommandsCliRequestBase64,
  decodeOpencodeConfigCliRequestBase64,
  decodeOpencodeHarnessHostRequestBase64,
  decodeOpencodeRuntimeConfigCliRequestBase64,
  decodeOpencodeSidecarCliRequestBase64,
  decodeOpencodeSkillsCliRequestBase64,
  decodeRunnerRequestBase64,
  decodeWorkspaceMcpSidecarCliRequestBase64,
} from "./contracts.js";
import type {
  HarnessHostModelClientPayload,
  HarnessHostOpencodeRequest,
  JsonObject,
  ModelClientConfigPayload,
  OpencodeHarnessHostRequest,
  RunnerOutputEvent,
  RunnerOutputEventPayload,
} from "./contracts.js";

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

test("contract exports stay compatible with legacy aliases", () => {
  const payload = {
    phase: "booting",
    details: {
      attempt: 1,
      warm: true,
    },
  } satisfies JsonObject;
  const event = {
    session_id: "session-1",
    input_id: "input-1",
    sequence: 1,
    event_type: "run_started",
    payload,
  } satisfies RunnerOutputEvent;
  const legacyEvent: RunnerOutputEventPayload = event;

  const modelClient = {
    model_proxy_provider: "openai_compatible",
    api_key: "token",
    base_url: "http://127.0.0.1:4000/openai/v1",
    default_headers: { "X-Test": "1" },
  } satisfies HarnessHostModelClientPayload;
  const legacyModelClient: ModelClientConfigPayload = modelClient;

  const request = {
    workspace_id: "workspace-1",
    workspace_dir: "/tmp/workspace-1",
    session_id: "session-1",
    input_id: "input-1",
    instruction: "Do the thing",
    debug: false,
    provider_id: "openai",
    model_id: "gpt-5.1",
    mode: "code",
    opencode_base_url: "http://127.0.0.1:4096",
    timeout_seconds: 30,
    system_prompt: "system",
    tools: { read: true },
    workspace_tool_ids: ["workspace.lookup"],
    workspace_skill_ids: ["skill-a"],
    mcp_servers: [{ name: "workspace", config: { type: "remote", url: "http://127.0.0.1:5000" } }],
    output_format: { type: "json_object" },
    workspace_config_checksum: "checksum-1",
    run_started_payload: payload,
    model_client: legacyModelClient,
  } satisfies HarnessHostOpencodeRequest;
  const legacyRequest: OpencodeHarnessHostRequest = request;

  assert.equal(legacyEvent.payload.phase, "booting");
  assert.equal(legacyRequest.model_client.base_url, "http://127.0.0.1:4000/openai/v1");
});

test("decodeRunnerRequestBase64 applies defaults for optional fields", () => {
  const request = decodeRunnerRequestBase64(
    encode({
      workspace_id: "workspace-1",
      session_id: "session-1",
      input_id: "input-1",
      instruction: "Ship it",
      context: {
        nested: {
          ok: true,
        },
      },
    })
  );

  assert.deepEqual(request, {
    holaboss_user_id: undefined,
    workspace_id: "workspace-1",
    session_id: "session-1",
    input_id: "input-1",
    instruction: "Ship it",
    context: {
      nested: {
        ok: true,
      },
    },
    model: undefined,
    debug: false,
  });
});

test("decodeRunnerRequestBase64 rejects non-object payloads", () => {
  assert.throws(
    () => decodeRunnerRequestBase64(encode(["not", "an", "object"])),
    /runner request payload must be an object/
  );
});

test("decodeOpencodeHarnessHostRequestBase64 validates and normalizes request payloads", () => {
  const request = decodeOpencodeHarnessHostRequestBase64(
    encode({
      workspace_id: "workspace-1",
      workspace_dir: "/tmp/workspace-1",
      session_id: "session-1",
      input_id: "input-1",
      instruction: "Do the thing",
      provider_id: "openai",
      model_id: "gpt-5.1",
      mode: "code",
      opencode_base_url: "http://127.0.0.1:4096",
      timeout_seconds: 30,
      system_prompt: "system",
      tools: { read: true },
      workspace_tool_ids: ["workspace.lookup"],
      workspace_skill_ids: ["skill-a"],
      mcp_servers: [{ name: "workspace" }, "ignored"],
      output_format: { type: "json" },
      workspace_config_checksum: "checksum-1",
      run_started_payload: { phase: "booting" },
      model_client: {
        model_proxy_provider: "openai_compatible",
        api_key: "token",
        default_headers: {
          "X-Test": "1",
          ignore: 2,
        },
      },
    })
  );

  assert.deepEqual(request, {
    workspace_id: "workspace-1",
    workspace_dir: "/tmp/workspace-1",
    session_id: "session-1",
    input_id: "input-1",
    instruction: "Do the thing",
    debug: false,
    harness_session_id: undefined,
    persisted_harness_session_id: undefined,
    provider_id: "openai",
    model_id: "gpt-5.1",
    mode: "code",
    opencode_base_url: "http://127.0.0.1:4096",
    timeout_seconds: 30,
    system_prompt: "system",
    tools: { read: true },
    workspace_tool_ids: ["workspace.lookup"],
    workspace_skill_ids: ["skill-a"],
    mcp_servers: [{ name: "workspace" }],
    output_format: { type: "json" },
    workspace_config_checksum: "checksum-1",
    run_started_payload: { phase: "booting" },
    model_client: {
      model_proxy_provider: "openai_compatible",
      api_key: "token",
      base_url: undefined,
      default_headers: { "X-Test": "1" },
    },
  });
});

test("decodeOpencodeHarnessHostRequestBase64 rejects invalid model_client payloads", () => {
  assert.throws(
    () =>
      decodeOpencodeHarnessHostRequestBase64(
        encode({
          workspace_id: "workspace-1",
          workspace_dir: "/tmp/workspace-1",
          session_id: "session-1",
          input_id: "input-1",
          instruction: "Do the thing",
          provider_id: "openai",
          model_id: "gpt-5.1",
          mode: "code",
          opencode_base_url: "http://127.0.0.1:4096",
          timeout_seconds: 30,
          system_prompt: "system",
          tools: {},
          workspace_tool_ids: [],
          workspace_skill_ids: [],
          mcp_servers: [],
          workspace_config_checksum: "checksum-1",
          run_started_payload: {},
          model_client: "bad",
        })
      ),
    /model_client must be an object/
  );
});

test("decodeOpencodeRuntimeConfigCliRequestBase64 defaults optional arrays and objects", () => {
  const request = decodeOpencodeRuntimeConfigCliRequestBase64(
    encode({
      session_id: "session-1",
      workspace_id: "workspace-1",
      input_id: "input-1",
      default_provider_id: "openai",
      session_mode: "code",
      workspace_config_checksum: "checksum-1",
      general_type: "single",
      single_agent: {
        id: "agent-1",
        model: "openai/gpt-5.1",
        prompt: "system",
      },
    })
  );

  assert.deepEqual(request, {
    session_id: "session-1",
    workspace_id: "workspace-1",
    input_id: "input-1",
    runtime_exec_model_proxy_api_key: undefined,
    runtime_exec_sandbox_id: undefined,
    runtime_exec_run_id: undefined,
    selected_model: undefined,
    default_provider_id: "openai",
    session_mode: "code",
    workspace_config_checksum: "checksum-1",
    workspace_skill_ids: [],
    default_tools: [],
    extra_tools: [],
    tool_server_id_map: null,
    resolved_mcp_tool_refs: [],
    resolved_output_schemas: {},
    general_type: "single",
    single_agent: {
      id: "agent-1",
      model: "openai/gpt-5.1",
      prompt: "system",
      role: undefined,
    },
    coordinator: undefined,
    members: [],
  });
});

test("decodeHarnessHostOpencodeRequestBase64 preserves the legacy request shape", () => {
  const request = decodeHarnessHostOpencodeRequestBase64(
    encode({
      workspace_id: "workspace-1",
      workspace_dir: "/tmp/workspace-1",
      session_id: "session-1",
      input_id: "input-1",
      instruction: "Do the thing",
      provider_id: "openai",
      model_id: "gpt-5.1",
      mode: "code",
      opencode_base_url: "http://127.0.0.1:4096",
      timeout_seconds: 30,
      system_prompt: "system",
      tools: { read: true },
      workspace_tool_ids: [],
      workspace_skill_ids: [],
      mcp_servers: [],
      workspace_config_checksum: "checksum-1",
      run_started_payload: {},
      model_client: {
        model_proxy_provider: "openai_compatible",
        api_key: "token",
      },
    })
  );

  assert.equal(request.provider_id, "openai");
});

test("decode additional harness CLI request payloads", () => {
  assert.deepEqual(
    decodeWorkspaceMcpSidecarCliRequestBase64(
      encode({
        workspace_dir: "/tmp/workspace-1",
        physical_server_id: "workspace",
        expected_fingerprint: "fingerprint-1",
        timeout_ms: 15000,
        readiness_timeout_s: 10.5,
        catalog_json_base64: "eyJ0ZXN0Ijp0cnVlfQ==",
      })
    ),
    {
      workspace_dir: "/tmp/workspace-1",
      physical_server_id: "workspace",
      expected_fingerprint: "fingerprint-1",
      timeout_ms: 15000,
      readiness_timeout_s: 10.5,
      catalog_json_base64: "eyJ0ZXN0Ijp0cnVlfQ==",
    }
  );

  assert.deepEqual(
    decodeOpencodeSidecarCliRequestBase64(
      encode({
        workspace_root: "/tmp/workspace-1",
        workspace_id: "workspace-1",
        config_fingerprint: "fingerprint-1",
        allow_reuse_existing: true,
        host: "127.0.0.1",
        port: 4096,
        readiness_url: "http://127.0.0.1:4096/ready",
        ready_timeout_s: 30,
      })
    ),
    {
      workspace_root: "/tmp/workspace-1",
      workspace_id: "workspace-1",
      config_fingerprint: "fingerprint-1",
      allow_reuse_existing: true,
      host: "127.0.0.1",
      port: 4096,
      readiness_url: "http://127.0.0.1:4096/ready",
      ready_timeout_s: 30,
    }
  );

  assert.deepEqual(
    decodeOpencodeConfigCliRequestBase64(
      encode({
        workspace_root: "/tmp/workspace-1",
        provider_id: "openai",
        model_id: "gpt-5.1",
        model_client: {
          model_proxy_provider: "openai_compatible",
          api_key: "token",
        },
      })
    ),
    {
      workspace_root: "/tmp/workspace-1",
      provider_id: "openai",
      model_id: "gpt-5.1",
      model_client: {
        model_proxy_provider: "openai_compatible",
        api_key: "token",
        base_url: undefined,
        default_headers: null,
      },
    }
  );

  assert.deepEqual(
    decodeOpencodeSkillsCliRequestBase64(
      encode({
        workspace_dir: "/tmp/workspace-1",
        runtime_root: "/tmp/runtime",
      })
    ),
    {
      workspace_dir: "/tmp/workspace-1",
      runtime_root: "/tmp/runtime",
    }
  );

  assert.deepEqual(
    decodeOpencodeCommandsCliRequestBase64(
      encode({
        workspace_dir: "/tmp/workspace-1",
      })
    ),
    {
      workspace_dir: "/tmp/workspace-1",
    }
  );
});
