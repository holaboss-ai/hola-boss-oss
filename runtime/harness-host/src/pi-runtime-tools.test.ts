import http from "node:http";
import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { RUNTIME_AGENT_TOOL_IDS } from "../../harnesses/src/runtime-agent-tools.js";
import { resolvePiRuntimeToolDefinitions } from "./pi-runtime-tools.js";

test("resolvePiRuntimeToolDefinitions returns empty when runtime api url is unavailable", async () => {
  const tools = await resolvePiRuntimeToolDefinitions({
    runtimeApiBaseUrl: "",
  });

  assert.deepEqual(tools, []);
});

test("resolvePiRuntimeToolDefinitions returns empty when runtime tools capability is unavailable", async () => {
  const tools = await resolvePiRuntimeToolDefinitions({
    runtimeApiBaseUrl: "http://127.0.0.1:5060",
    fetchImpl: async () =>
      new Response(JSON.stringify({ available: false }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
  });

  assert.deepEqual(tools, []);
});

test("Pi runtime tools execute through the local runtime capability API", async () => {
  const requests: Array<{
    method: string;
    url: string;
    workspaceId: string;
    sessionId: string;
    selectedModel: string;
    body: string;
  }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v1/capabilities/runtime-tools")) {
      return new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const body = init?.body ? String(init.body) : "";
    requests.push({
      method: String(init?.method ?? "GET"),
      url,
      workspaceId: String((init?.headers as Record<string, string> | undefined)?.["x-holaboss-workspace-id"] ?? ""),
      sessionId: String((init?.headers as Record<string, string> | undefined)?.["x-holaboss-session-id"] ?? ""),
      selectedModel: String(
        (init?.headers as Record<string, string> | undefined)?.["x-holaboss-selected-model"] ?? ""
      ),
      body,
    });

    if (url.endsWith("/api/v1/capabilities/runtime-tools/onboarding/complete")) {
      return new Response(JSON.stringify({ onboarding_status: "completed" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const tools = await resolvePiRuntimeToolDefinitions({
    runtimeApiBaseUrl: "http://127.0.0.1:5060",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    selectedModel: "openai/gpt-5.4",
    fetchImpl,
  });

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [...RUNTIME_AGENT_TOOL_IDS]
  );

  const completeTool = tools.find((tool) => tool.name === "holaboss_onboarding_complete");
  assert.ok(completeTool);
  const result = await completeTool.execute(
    "call-1",
    { summary: "ready to work", requested_by: "workspace_agent" },
    undefined,
    undefined,
    {} as never
  );

  assert.deepEqual(requests, [
    {
      method: "POST",
      url: "http://127.0.0.1:5060/api/v1/capabilities/runtime-tools/onboarding/complete",
      workspaceId: "workspace-1",
      sessionId: "session-main",
      selectedModel: "openai/gpt-5.4",
      body: JSON.stringify({ summary: "ready to work", requested_by: "workspace_agent" }),
    },
  ]);
  assert.equal(result.content[0]?.type, "text");
  assert.equal(result.content[0]?.text, JSON.stringify({ onboarding_status: "completed" }, null, 2));
  assert.deepEqual(result.details, { tool_id: "holaboss_onboarding_complete" });
});

test("Pi runtime cronjob tools send instruction separately from description", async () => {
  const requests: Array<{
    method: string;
    url: string;
    workspaceId: string;
    sessionId: string;
    selectedModel: string;
    body: string;
  }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v1/capabilities/runtime-tools")) {
      return new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const body = init?.body ? String(init.body) : "";
    requests.push({
      method: String(init?.method ?? "GET"),
      url,
      workspaceId: String((init?.headers as Record<string, string> | undefined)?.["x-holaboss-workspace-id"] ?? ""),
      sessionId: String((init?.headers as Record<string, string> | undefined)?.["x-holaboss-session-id"] ?? ""),
      selectedModel: String(
        (init?.headers as Record<string, string> | undefined)?.["x-holaboss-selected-model"] ?? ""
      ),
      body,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };

  const tools = await resolvePiRuntimeToolDefinitions({
    runtimeApiBaseUrl: "http://127.0.0.1:5060",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    selectedModel: "openai/gpt-5.4",
    fetchImpl,
  });

  const createTool = tools.find((tool) => tool.name === "holaboss_cronjobs_create");
  assert.ok(createTool);

  await createTool.execute(
    "call-1",
    {
      cron: "*/5 * * * *",
      description: "Say hello every 5 minutes.",
      instruction: "Say hello.",
      delivery_channel: "session_run",
    },
    undefined,
    undefined,
    {} as never
  );

  assert.deepEqual(requests, [
    {
      method: "POST",
      url: "http://127.0.0.1:5060/api/v1/capabilities/runtime-tools/cronjobs",
      workspaceId: "workspace-1",
      sessionId: "session-main",
      selectedModel: "openai/gpt-5.4",
      body: JSON.stringify({
        cron: "*/5 * * * *",
        description: "Say hello every 5 minutes.",
        instruction: "Say hello.",
        delivery: { channel: "session_run" },
      }),
    },
  ]);
});

test("Pi runtime tools fall back to node http when no fetch implementation is provided", async () => {
  const requests: Array<{
    method: string;
    url: string;
    workspaceId: string;
    sessionId: string;
    selectedModel: string;
    body: string;
  }> = [];
  const server = http.createServer((request, response) => {
    const url = request.url ?? "";
    if (request.method === "GET" && url === "/api/v1/capabilities/runtime-tools") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ available: true }));
      return;
    }

    if (request.method === "POST" && url === "/api/v1/capabilities/runtime-tools/onboarding/complete") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push({
          method: request.method ?? "GET",
          url,
          workspaceId: String(request.headers["x-holaboss-workspace-id"] ?? ""),
          sessionId: String(request.headers["x-holaboss-session-id"] ?? ""),
          selectedModel: String(request.headers["x-holaboss-selected-model"] ?? ""),
          body,
        });
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ onboarding_status: "completed" }));
      });
      return;
    }

    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ detail: "not found" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const runtimeApiBaseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const tools = await resolvePiRuntimeToolDefinitions({
      runtimeApiBaseUrl,
      workspaceId: "workspace-1",
      sessionId: "session-main",
      selectedModel: "openai/gpt-5.4",
    });
    const completeTool = tools.find((tool) => tool.name === "holaboss_onboarding_complete");
    assert.ok(completeTool);

    const result = await completeTool.execute(
      "call-1",
      { summary: "ready to work" },
      undefined,
      undefined,
      {} as never
    );

    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "/api/v1/capabilities/runtime-tools/onboarding/complete",
        workspaceId: "workspace-1",
        sessionId: "session-main",
        selectedModel: "openai/gpt-5.4",
        body: JSON.stringify({ summary: "ready to work" }),
      },
    ]);
    assert.equal(result.content[0]?.type, "text");
    assert.equal(result.content[0]?.text, JSON.stringify({ onboarding_status: "completed" }, null, 2));
    assert.deepEqual(result.details, { tool_id: "holaboss_onboarding_complete" });
  } finally {
    server.close();
    await once(server, "close");
  }
});
