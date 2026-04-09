import http from "node:http";
import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { DESKTOP_BROWSER_TOOL_IDS } from "../../harnesses/src/desktop-browser-tools.js";
import { resolvePiDesktopBrowserToolDefinitions } from "./pi-browser-tools.js";

test("resolvePiDesktopBrowserToolDefinitions returns an empty tool list when runtime api url is unavailable", async () => {
  const tools = await resolvePiDesktopBrowserToolDefinitions({
    runtimeApiBaseUrl: "",
  });

  assert.deepEqual(tools, []);
});

test("resolvePiDesktopBrowserToolDefinitions returns an empty tool list when browser capability is unavailable", async () => {
  const tools = await resolvePiDesktopBrowserToolDefinitions({
    runtimeApiBaseUrl: "http://127.0.0.1:5060",
    fetchImpl: async () =>
      new Response(JSON.stringify({ available: false }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
  });

  assert.deepEqual(tools, []);
});

test("Pi desktop browser tools execute through the runtime capability API", async () => {
  const requests: Array<{ method: string; url: string; workspaceId: string; body: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v1/capabilities/browser")) {
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
      body,
    });
    if (url.endsWith("/api/v1/capabilities/browser/tools/browser_get_state")) {
      return new Response(JSON.stringify({ ok: true, title: "Example" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const tools = await resolvePiDesktopBrowserToolDefinitions({
    runtimeApiBaseUrl: "http://127.0.0.1:5060",
    workspaceId: "workspace-1",
    fetchImpl,
  });

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [...DESKTOP_BROWSER_TOOL_IDS]
  );

  const getStateTool = tools.find((tool) => tool.name === "browser_get_state");
  assert.ok(getStateTool);
  assert.match(getStateTool.description ?? "", /live page state, exact values, filters, rankings, thresholds/i);
  assert.match(getStateTool.description ?? "", /search results cannot fully verify/i);
  const result = await getStateTool.execute("call-1", { include_screenshot: true }, undefined, undefined, {} as never);

  assert.deepEqual(requests, [
      {
        method: "POST",
        url: "http://127.0.0.1:5060/api/v1/capabilities/browser/tools/browser_get_state",
        workspaceId: "workspace-1",
        body: JSON.stringify({ include_screenshot: true }),
      },
    ]);
  assert.equal(result.content[0]?.type, "text");
  assert.equal(result.content[0]?.text, JSON.stringify({ ok: true, title: "Example" }, null, 2));
  assert.deepEqual(result.details, { tool_id: "browser_get_state" });
});

test("Pi desktop browser tools fall back to node http when no fetch implementation is provided", async () => {
  const requests: Array<{ method: string; url: string; workspaceId: string; body: string }> = [];
  const server = http.createServer((request, response) => {
    const url = request.url ?? "";
    if (request.method === "GET" && url === "/api/v1/capabilities/browser") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ available: true }));
      return;
    }

    if (request.method === "POST" && url === "/api/v1/capabilities/browser/tools/browser_get_state") {
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
          body,
        });
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, title: "Example via http" }));
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
    const tools = await resolvePiDesktopBrowserToolDefinitions({
      runtimeApiBaseUrl,
      workspaceId: "workspace-1",
    });

    const getStateTool = tools.find((tool) => tool.name === "browser_get_state");
    assert.ok(getStateTool);
    assert.match(getStateTool.description ?? "", /live page state, exact values, filters, rankings, thresholds/i);
    const result = await getStateTool.execute("call-1", { include_screenshot: false }, undefined, undefined, {} as never);

    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "/api/v1/capabilities/browser/tools/browser_get_state",
        workspaceId: "workspace-1",
        body: JSON.stringify({ include_screenshot: false }),
      },
    ]);
    assert.equal(result.content[0]?.type, "text");
    assert.equal(result.content[0]?.text, JSON.stringify({ ok: true, title: "Example via http" }, null, 2));
    assert.deepEqual(result.details, { tool_id: "browser_get_state" });
  } finally {
    server.close();
    await once(server, "close");
  }
});
