import assert from "node:assert/strict";
import { test } from "node:test";

import { ALLOWED_DELIVERY_CHANNELS, main, runHb, workflowBackend } from "./hb.js";
import type { MemoryServiceLike } from "./memory.js";
import type { ProductRuntimeConfig } from "./runtime-config.js";

function makeConfig(overrides: Partial<ProductRuntimeConfig> = {}): ProductRuntimeConfig {
  return {
    authToken: "",
    userId: "",
    sandboxId: "",
    modelProxyBaseUrl: "",
    defaultModel: "openai/gpt-5.1",
    runtimeMode: "oss",
    defaultProvider: "",
    holabossEnabled: false,
    desktopBrowserEnabled: false,
    desktopBrowserUrl: "",
    desktopBrowserAuthToken: "",
    configPath: "/holaboss/state/runtime-config.json",
    loadedFromFile: false,
    ...overrides
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeMemoryService(overrides: Partial<MemoryServiceLike> = {}): MemoryServiceLike {
  return {
    async search(payload) {
      return {
        workspace_id: payload.workspace_id,
        query: payload.query,
        hits: []
      };
    },
    async get(payload) {
      return {
        path: payload.path,
        text: ""
      };
    },
    async upsert(payload) {
      return {
        path: payload.path,
        text: payload.content
      };
    },
    async status(payload) {
      return {
        workspace_id: payload.workspace_id,
        provider: "filesystem"
      };
    },
    async sync(payload) {
      return {
        workspace_id: payload.workspace_id,
        reason: payload.reason ?? "manual",
        success: true
      };
    },
    ...overrides
  };
}

test("runHb normalizes cronjobs list payloads", async () => {
  let requestedUrl = "";

  const payload = await runHb(["cronjobs", "list", "--workspace-id", "workspace-1"], {
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return jsonResponse([{ id: "job-1" }, { id: "job-2" }]);
    }
  });

  assert.deepEqual(payload, {
    jobs: [{ id: "job-1" }, { id: "job-2" }],
    count: 2
  });
  assert.match(requestedUrl, /workspace_id=workspace-1/);
  assert.match(requestedUrl, /enabled_only=false/);
});

test("runHb cronjobs create injects user metadata and preserves delivery contract", async () => {
  let requestBody = "";

  const payload = await runHb(
    [
      "cronjobs",
      "create",
      "--workspace-id",
      "workspace-1",
      "--cron",
      "0 9 * * *",
      "--description",
      "Daily check"
    ],
    {
      resolveConfig: () => makeConfig({ userId: "user-1" }),
      fetchImpl: async (_, init) => {
        requestBody = String(init?.body ?? "");
        return jsonResponse({ id: "job-1" });
      }
    }
  );

  assert.deepEqual(payload, { id: "job-1" });
  assert.deepEqual(JSON.parse(requestBody), {
    workspace_id: "workspace-1",
    initiated_by: "workspace_agent",
    cron: "0 9 * * *",
    description: "Daily check",
    enabled: true,
    delivery: {
      mode: "announce",
      channel: "session_run",
      to: null
    },
    metadata: {
      holaboss_user_id: "user-1"
    }
  });
});

test("runHb rejects legacy cronjob delivery channels", async () => {
  await assert.rejects(
    runHb([
      "cronjobs",
      "create",
      "--workspace-id",
      "workspace-1",
      "--cron",
      "0 * * * *",
      "--description",
      "Drink water",
      "--delivery-channel",
      "proactive_event"
    ]),
    /delivery channel must be one of/
  );
});

test("runHb onboarding status uses product base url aliases and auth headers", async () => {
  let requestedUrl = "";
  let requestedHeaders: Record<string, string> = {};

  const payload = await runHb(["onboarding", "status", "--workspace-id", "workspace-1"], {
    resolveConfig: () =>
      makeConfig({
        authToken: "token-1",
        userId: "user-1",
        sandboxId: "sandbox-1",
        modelProxyBaseUrl: "https://runtime.example/api/v1/model-proxy"
      }),
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return jsonResponse({ workspace_id: "workspace-1", onboarding_status: "pending" });
    }
  });

  assert.deepEqual(payload, {
    workspace_id: "workspace-1",
    onboarding_status: "pending"
  });
  assert.equal(requestedUrl, "https://runtime.example/api/v1/sandbox/onboarding/workspaces/workspace-1/status");
  assert.deepEqual(requestedHeaders, {
    "x-api-key": "token-1",
    "x-holaboss-sandbox-id": "sandbox-1",
    "x-holaboss-user-id": "user-1"
  });
});

test("runHb runtime info preserves workflow backend alias handling", async () => {
  process.env.HOLABOSS_RUNTIME_WORKFLOW_BACKEND = "local_sqlite";
  try {
    const payload = await runHb(["runtime", "info"], {
      resolveConfig: () => makeConfig()
    });
    assert.deepEqual(payload, {
      runtime_mode: "oss",
      holaboss_features_enabled: false,
      default_harness: "opencode",
      workflow_backend: "local_sqlite",
      runtime_config_path: "/holaboss/state/runtime-config.json",
      runtime_config_loaded: false
    });
    assert.equal(workflowBackend(), "local_sqlite");
  } finally {
    delete process.env.HOLABOSS_RUNTIME_WORKFLOW_BACKEND;
  }
});

test("runHb memory upsert preserves local filesystem payloads", async () => {
  let capturedPayload: Record<string, unknown> | undefined;
  const memoryService = makeMemoryService({
    async upsert(payload) {
      capturedPayload = payload;
      return {
        path: payload.path,
        text: payload.content
      };
    }
  });

  const payload = await runHb(
    [
      "memory",
      "upsert",
      "--workspace-id",
      "workspace-1",
      "--path",
      "workspace/workspace-1/state.md",
      "--content",
      "hello"
    ],
    { memoryService }
  );

  assert.deepEqual(payload, {
    path: "workspace/workspace-1/state.md",
    text: "hello"
  });
  assert.deepEqual(capturedPayload, {
    workspace_id: "workspace-1",
    path: "workspace/workspace-1/state.md",
    content: "hello",
    append: false
  });
});

test("runHb memory status delegates to the local TS memory service", async () => {
  const payload = await runHb(["memory", "status", "--workspace-id", "workspace-1"], {
    memoryService: makeMemoryService()
  });

  assert.deepEqual(payload, {
    workspace_id: "workspace-1",
    provider: "filesystem"
  });
});

test("main returns json error payloads on failure", async () => {
  let stdout = "";
  let stderr = "";

  const exitCode = await main(["cronjobs", "list"], {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
          return true;
        }
      } as NodeJS.WritableStream,
      stderr: {
        write(chunk: string) {
          stderr += chunk;
          return true;
        }
      } as NodeJS.WritableStream
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /"--workspace-id is required"|--workspace-id is required/);
});

test("delivery channels stay aligned with the API contract", () => {
  assert.deepEqual(new Set(["system_notification", "session_run"]), ALLOWED_DELIVERY_CHANNELS);
});
