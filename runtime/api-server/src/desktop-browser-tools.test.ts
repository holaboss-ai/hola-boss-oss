import assert from "node:assert/strict";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { test } from "node:test";

import {
  DesktopBrowserToolService,
  DesktopBrowserToolServiceError
} from "./desktop-browser-tools.js";

async function startBrowserServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/api/v1/browser`,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}

test("desktop browser tool service reports unavailable when runtime lacks browser config", async () => {
  const service = new DesktopBrowserToolService({
    resolveConfig: () => ({
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
      configPath: "/tmp/runtime-config.json",
      loadedFromFile: false
    })
  });

  const status = await service.getStatus();
  assert.deepEqual(status, {
    available: false,
    configured: false,
    reachable: false,
    backend: null,
    tools: status.tools
  });
  assert.equal(Array.isArray(status.tools), true);
});

test("desktop browser tool service executes browser_get_state against the desktop browser service", async () => {
  const requests: Array<{ path: string; token: string; body: string }> = [];
  const browserServer = await startBrowserServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      path: request.url ?? "",
      token: String(request.headers["x-holaboss-desktop-token"] ?? ""),
      body
    });
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/api/v1/browser/health") {
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/api/v1/browser/page") {
      response.end(JSON.stringify({ tabId: "tab-1", url: "https://example.com", title: "Example" }));
      return;
    }
    if (request.url === "/api/v1/browser/evaluate") {
      response.end(
        JSON.stringify({
          tabId: "tab-1",
          result: {
            url: "https://example.com",
            title: "Example",
            text: "Example Domain",
            viewport: { width: 1280, height: 720 },
            scroll: { x: 0, y: 0 },
            elements: [{ index: 1, tag_name: "a", label: "More information", text: "More information" }]
          }
        })
      );
      return;
    }
    if (request.url === "/api/v1/browser/screenshot") {
      response.end(
        JSON.stringify({
          tabId: "tab-1",
          mimeType: "image/png",
          width: 1280,
          height: 720,
          base64: "cG5n"
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  try {
    const service = new DesktopBrowserToolService({
      resolveConfig: () => ({
        authToken: "",
        userId: "",
        sandboxId: "",
        modelProxyBaseUrl: "",
        defaultModel: "openai/gpt-5.1",
        runtimeMode: "oss",
        defaultProvider: "",
        holabossEnabled: false,
        desktopBrowserEnabled: true,
        desktopBrowserUrl: browserServer.url,
        desktopBrowserAuthToken: "browser-token",
        configPath: "/tmp/runtime-config.json",
        loadedFromFile: true
      })
    });

    const result = await service.execute("browser_get_state", { include_screenshot: true });
    assert.deepEqual(result, {
      ok: true,
      page: { tabId: "tab-1", url: "https://example.com", title: "Example" },
      state: {
        url: "https://example.com",
        title: "Example",
        text: "Example Domain",
        viewport: { width: 1280, height: 720 },
        scroll: { x: 0, y: 0 },
        elements: [{ index: 1, tag_name: "a", label: "More information", text: "More information" }]
      },
      screenshot: {
        tabId: "tab-1",
        mimeType: "image/png",
        width: 1280,
        height: 720,
        base64: "cG5n"
      }
    });
    assert.deepEqual(
      requests.map((entry) => [entry.path, entry.token]),
      [
        ["/api/v1/browser/page", "browser-token"],
        ["/api/v1/browser/evaluate", "browser-token"],
        ["/api/v1/browser/screenshot", "browser-token"]
      ]
    );
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service rejects unknown tools", async () => {
  const service = new DesktopBrowserToolService({
    resolveConfig: () => ({
      authToken: "",
      userId: "",
      sandboxId: "",
      modelProxyBaseUrl: "",
      defaultModel: "openai/gpt-5.1",
      runtimeMode: "oss",
      defaultProvider: "",
      holabossEnabled: false,
      desktopBrowserEnabled: true,
      desktopBrowserUrl: "http://127.0.0.1:9/api/v1/browser",
      desktopBrowserAuthToken: "browser-token",
      configPath: "/tmp/runtime-config.json",
      loadedFromFile: true
    })
  });

  await assert.rejects(
    service.execute("browser_not_real", {}),
    (error: unknown) =>
      error instanceof DesktopBrowserToolServiceError &&
      error.statusCode === 404 &&
      error.code === "browser_tool_unknown"
  );
});
