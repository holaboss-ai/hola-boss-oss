import assert from "node:assert/strict";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

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
      defaultModel: "openai/gpt-5.4",
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

test("desktop browser tool service forwards workspace and session context to the desktop browser service", async () => {
  const requests: Array<{ path: string; token: string; workspaceId: string; sessionId: string; body: string }> = [];
  const browserServer = await startBrowserServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      path: request.url ?? "",
      token: String(request.headers["x-holaboss-desktop-token"] ?? ""),
      workspaceId: String(request.headers["x-holaboss-workspace-id"] ?? ""),
      sessionId: String(request.headers["x-holaboss-session-id"] ?? ""),
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
            viewport: { width: 1280, height: 720 },
            scroll: { x: 0, y: 0 },
            elements: [{ index: 1, tag_name: "a", label: "More information", text: "More information" }],
            media: [{
              index: 1,
              media_type: "image",
              tag_name: "img",
              label: "Hero image",
              alt: "Hero image",
              text: "",
              src: "/hero.png",
              current_src: "https://example.com/hero.png",
              link_href: "",
              bounding_box: { x: 24, y: 48, width: 320, height: 180 }
            }]
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
        defaultModel: "openai/gpt-5.4",
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

    const result = await service.execute(
      "browser_get_state",
      { include_screenshot: true },
      { workspaceId: "workspace-1", sessionId: "session-1" }
    );
    assert.deepEqual(result, {
      ok: true,
      page: { tabId: "tab-1", url: "https://example.com", title: "Example" },
      state: {
        url: "https://example.com",
        title: "Example",
        viewport: { width: 1280, height: 720 },
        scroll: { x: 0, y: 0 },
        elements: [{ index: 1, tag_name: "a", label: "More information", text: "More information" }],
        media: [{
          index: 1,
          media_type: "image",
          tag_name: "img",
          label: "Hero image",
          alt: "Hero image",
          text: "",
          src: "/hero.png",
          current_src: "https://example.com/hero.png",
          link_href: "",
          bounding_box: { x: 24, y: 48, width: 320, height: 180 }
        }]
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
      requests.map((entry) => [entry.path, entry.token, entry.workspaceId, entry.sessionId]),
      [
        ["/api/v1/browser/page", "browser-token", "workspace-1", "session-1"],
        ["/api/v1/browser/evaluate", "browser-token", "workspace-1", "session-1"],
        ["/api/v1/browser/screenshot", "browser-token", "workspace-1", "session-1"]
      ]
    );
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service stores screenshots as output artifacts when available", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hb-browser-screenshot-artifacts-"));
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot,
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });

  const browserServer = await startBrowserServer(async (request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
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
            viewport: { width: 1280, height: 720 },
            scroll: { x: 0, y: 0 },
            elements: [],
            media: [],
          },
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
          base64: "cG5n",
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  try {
    const service = new DesktopBrowserToolService({
      artifactStore: store,
      resolveConfig: () => ({
        authToken: "",
        userId: "",
        sandboxId: "",
        modelProxyBaseUrl: "",
        defaultModel: "openai/gpt-5.4",
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

    const result = await service.execute(
      "browser_get_state",
      { include_screenshot: true },
      { workspaceId: "workspace-1", sessionId: "session-1", inputId: "input-1" }
    );
    const screenshot = result.screenshot as {
      artifact_id?: string;
      output_id?: string;
      file_path?: string;
      mime_type?: string;
      size_bytes?: number;
      width?: number;
      height?: number;
      inline_base64?: boolean;
      base64?: string;
    };

    assert.equal(screenshot.base64, undefined);
    assert.equal(screenshot.inline_base64, false);
    assert.equal(screenshot.mime_type, "image/png");
    assert.equal(screenshot.size_bytes, 3);
    assert.equal(screenshot.width, 1280);
    assert.equal(screenshot.height, 720);
    assert.ok(typeof screenshot.artifact_id === "string" && screenshot.artifact_id.length > 0);
    assert.ok(typeof screenshot.output_id === "string" && screenshot.output_id.length > 0);
    assert.match(String(screenshot.file_path ?? ""), /^outputs\/browser-screenshots\/session-1\//);
    assert.equal(
      fs.readFileSync(path.join(workspaceRoot, "workspace-1", screenshot.file_path ?? ""), "utf8"),
      "png",
    );

    const outputs = store.listOutputs({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      inputId: "input-1",
      limit: 20,
      offset: 0,
    });
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].id, screenshot.output_id);
    assert.equal(outputs[0].artifactId, screenshot.artifact_id);
    assert.equal(outputs[0].filePath, screenshot.file_path);
    assert.equal(outputs[0].metadata.artifact_type, "browser_screenshot");
    assert.equal(outputs[0].metadata.origin_type, "browser_tool");
    assert.equal(outputs[0].metadata.tool_id, "browser_get_state");
    assert.equal(outputs[0].metadata.inline_base64, false);
  } finally {
    await browserServer.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("desktop browser tool service retries browser_get_state when the first snapshot is still loading or 0x0", async () => {
  const requests: string[] = [];
  let pageCalls = 0;
  let evaluateCalls = 0;
  let screenshotCalls = 0;
  const browserServer = await startBrowserServer(async (request, response) => {
    requests.push(request.url ?? "");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/api/v1/browser/page") {
      pageCalls += 1;
      response.end(
        JSON.stringify(
          pageCalls === 1
            ? {
                tabId: "tab-1",
                url: "https://example.com",
                title: "Example",
                loading: true,
                initialized: false,
              }
            : {
                tabId: "tab-1",
                url: "https://example.com",
                title: "Example",
                loading: false,
                initialized: true,
              },
        ),
      );
      return;
    }
    if (request.url === "/api/v1/browser/evaluate") {
      evaluateCalls += 1;
      response.end(
        JSON.stringify({
          tabId: "tab-1",
          result:
            evaluateCalls === 1
              ? {
                  url: "https://example.com",
                  title: "Example",
                  viewport: { width: 0, height: 0 },
                  scroll: { x: 0, y: 0 },
                  elements: [],
                  media: [],
                }
              : {
                  url: "https://example.com",
                  title: "Example",
                  viewport: { width: 1280, height: 720 },
                  scroll: { x: 0, y: 0 },
                  elements: [],
                  media: [
                    {
                      index: 1,
                      media_type: "image",
                      tag_name: "img",
                      label: "Hero image",
                      alt: "Hero image",
                      text: "",
                      src: "/hero.png",
                      current_src: "https://example.com/hero.png",
                      link_href: "",
                      bounding_box: { x: 24, y: 48, width: 320, height: 180 },
                    },
                  ],
                },
        }),
      );
      return;
    }
    if (request.url === "/api/v1/browser/screenshot") {
      screenshotCalls += 1;
      response.end(
        JSON.stringify(
          screenshotCalls === 1
            ? {
                tabId: "tab-1",
                mimeType: "image/png",
                width: 0,
                height: 0,
                base64: "",
              }
            : {
                tabId: "tab-1",
                mimeType: "image/png",
                width: 1280,
                height: 720,
                base64: "cG5n",
              },
        ),
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
        defaultModel: "openai/gpt-5.4",
        runtimeMode: "oss",
        defaultProvider: "",
        holabossEnabled: false,
        desktopBrowserEnabled: true,
        desktopBrowserUrl: browserServer.url,
        desktopBrowserAuthToken: "browser-token",
        configPath: "/tmp/runtime-config.json",
        loadedFromFile: true,
      }),
    });

    const result = await service.execute(
      "browser_get_state",
      { include_screenshot: true },
      { workspaceId: "workspace-1", sessionId: "session-1" },
    );

    assert.deepEqual((result.page as { loading?: boolean; initialized?: boolean }), {
      tabId: "tab-1",
      url: "https://example.com",
      title: "Example",
      loading: false,
      initialized: true,
    });
    assert.deepEqual((result.state as { viewport?: unknown; media?: unknown[] }).viewport, {
      width: 1280,
      height: 720,
    });
    assert.equal(
      ((result.state as { media?: Array<{ current_src?: string }> }).media ?? [])[0]?.current_src,
      "https://example.com/hero.png",
    );
    assert.deepEqual((result.screenshot as { width?: number; height?: number }), {
      tabId: "tab-1",
      mimeType: "image/png",
      width: 1280,
      height: 720,
      base64: "cG5n",
    });
    assert.equal("warnings" in result, false);
    assert.deepEqual(requests, [
      "/api/v1/browser/page",
      "/api/v1/browser/evaluate",
      "/api/v1/browser/screenshot",
      "/api/v1/browser/page",
      "/api/v1/browser/evaluate",
      "/api/v1/browser/screenshot",
    ]);
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service opens a native context menu for media targets", async () => {
  const requests: Array<{ path: string; body: string }> = [];
  const browserServer = await startBrowserServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    requests.push({
      path: request.url ?? "",
      body: Buffer.concat(chunks).toString("utf8"),
    });
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/api/v1/browser/evaluate") {
      response.end(
        JSON.stringify({
          tabId: "tab-1",
          result: {
            ok: true,
            target_kind: "media",
            index: 1,
            x: 184,
            y: 138,
            tag_name: "img",
            label: "Hero image",
            text: "",
          },
        })
      );
      return;
    }
    if (request.url === "/api/v1/browser/context-click") {
      response.end(JSON.stringify({ ok: true, tabId: "tab-1", x: 184, y: 138 }));
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
        defaultModel: "openai/gpt-5.4",
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

    const result = await service.execute(
      "browser_context_click",
      { target: "media", index: 1 },
      { workspaceId: "workspace-1", sessionId: "session-1" }
    );

    assert.deepEqual(result, {
      ok: true,
      action: {
        ok: true,
        target_kind: "media",
        index: 1,
        x: 184,
        y: 138,
        tag_name: "img",
        label: "Hero image",
        text: "",
      },
      context_menu: {
        ok: true,
        tabId: "tab-1",
        x: 184,
        y: 138,
      }
    });
    assert.deepEqual(
      requests.map((entry) => entry.path),
      ["/api/v1/browser/evaluate", "/api/v1/browser/context-click"],
    );
    assert.equal(requests[1]?.body, JSON.stringify({ x: 184, y: 138 }));
    assert.match(requests[0]?.body ?? "", /mediaSelector/);
    assert.match(requests[0]?.body ?? "", /const targetKind = \\"media\\";/);
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service includes page text only when explicitly requested", async () => {
  const browserServer = await startBrowserServer(async (request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
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
        defaultModel: "openai/gpt-5.4",
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

    const result = await service.execute(
      "browser_get_state",
      { include_page_text: true },
      { workspaceId: "workspace-1", sessionId: "session-1" }
    );

    assert.equal((result.state as { text?: string }).text, "Example Domain");
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service accepts scoped browser_get_state controls", async () => {
  const evaluateBodies: string[] = [];
  const browserServer = await startBrowserServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/api/v1/browser/page") {
      response.end(JSON.stringify({ tabId: "tab-1", url: "https://example.com", title: "Example" }));
      return;
    }
    if (request.url === "/api/v1/browser/evaluate") {
      evaluateBodies.push(Buffer.concat(chunks).toString("utf8"));
      response.end(
        JSON.stringify({
          tabId: "tab-1",
          result: {
            url: "https://example.com",
            title: "Example",
            text: "Visible viewport text",
            viewport: { width: 1280, height: 720 },
            scroll: { x: 0, y: 0 },
            elements: [],
            media: [],
            metadata: {
              schema_version: 1,
              mode: "text",
              scope: "dialog",
              max_nodes: 2,
              include_page_text: true,
              include_screenshot: false,
              lists_included: false,
              returned: { elements: 0, media: 0 },
              totals: { elements: 4, media: 1 },
              full_page_totals: { elements: 10, media: 2 },
              truncated: false,
            },
          },
        })
      );
      return;
    }
    if (request.url === "/api/v1/browser/screenshot") {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "screenshot should not be requested" }));
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
        defaultModel: "openai/gpt-5.4",
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

    const result = await service.execute(
      "browser_get_state",
      { mode: "text", scope: "active_dialog", max_nodes: 2 },
      { workspaceId: "workspace-1", sessionId: "session-1" }
    );

    assert.equal((result.state as { text?: string }).text, "Visible viewport text");
    assert.deepEqual((result.state as { metadata?: unknown }).metadata, {
      schema_version: 1,
      mode: "text",
      scope: "dialog",
      max_nodes: 2,
      include_page_text: true,
      include_screenshot: false,
      lists_included: false,
      returned: { elements: 0, media: 0 },
      totals: { elements: 4, media: 1 },
      full_page_totals: { elements: 10, media: 2 },
      truncated: false,
    });
    assert.equal("screenshot" in result, false);
    assert.equal(evaluateBodies.length, 1);
    assert.match(evaluateBodies[0] ?? "", /const mode = \\"text\\";/);
    assert.match(evaluateBodies[0] ?? "", /const scope = \\"dialog\\";/);
    assert.match(evaluateBodies[0] ?? "", /const maxNodes = 2;/);
    assert.match(evaluateBodies[0] ?? "", /const includeMetadata = true;/);
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service exposes general find, act, wait, evaluate, and debug primitives", async () => {
  const evaluateBodies: string[] = [];
  const mouseBodies: string[] = [];
  const keyboardBodies: string[] = [];
  let waitPredicateCalls = 0;
  const browserServer = await startBrowserServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf8");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/api/v1/browser/page") {
      response.end(JSON.stringify({ tabId: "tab-1", url: "https://example.com/app", title: "Example App" }));
      return;
    }
    if (request.url === "/api/v1/browser/mouse") {
      mouseBodies.push(body);
      response.end(JSON.stringify({ ok: true, tabId: "tab-1", action: "click", x: 370, y: 104 }));
      return;
    }
    if (request.url === "/api/v1/browser/keyboard") {
      keyboardBodies.push(body);
      response.end(JSON.stringify({ ok: true, tabId: "tab-1", action: "insert_text", text_length: 14, clear: true, submit: false }));
      return;
    }
    if (request.url === "/api/v1/browser/evaluate") {
      evaluateBodies.push(body);
      const expression = String((JSON.parse(body) as { expression?: string }).expression ?? "");
      if (expression.includes("const maxResults = 10")) {
        response.end(
          JSON.stringify({
            tabId: "tab-1",
            result: {
              ok: true,
              count: 1,
              truncated: false,
              matches: [
                {
                  ref: "css:#new-button",
                  action_ref: "css:#new-button",
                  tag_name: "div",
                  role: "button",
                  text: "New",
                  label: "New",
                  visible: true,
                  bounding_box: { x: 292, y: 72, width: 156, height: 64 },
                },
              ],
            },
          }),
        );
        return;
      }
      if (expression.includes('const action = "click"')) {
        response.end(
          JSON.stringify({
            tabId: "tab-1",
            result: {
              ok: true,
              action: "click",
              target: { ref: "css:#new-button", text: "New" },
              result: { x: 370, y: 104 },
            },
          }),
        );
        return;
      }
      if (expression.includes('const action = "fill"')) {
        response.end(
          JSON.stringify({
            tabId: "tab-1",
            result: {
              ok: true,
              action: "fill",
              target: { ref: "css:#editor", text: "" },
              action_target: { ref: "css:#editor", role: "textbox", editable: true },
              result: { focused: true },
            },
          }),
        );
        return;
      }
      if (expression.includes('const condition = "element"')) {
        waitPredicateCalls += 1;
        response.end(
          JSON.stringify({
            tabId: "tab-1",
            result: {
              ok: true,
              matched: waitPredicateCalls >= 2,
              condition: "element",
              match_count: waitPredicateCalls >= 2 ? 1 : 0,
            },
          }),
        );
        return;
      }
      if (expression.includes('const condition = "dom_change"')) {
        response.end(
          JSON.stringify({
            tabId: "tab-1",
            result: {
              ok: true,
              matched: true,
              condition: "dom_change",
              match_count: null,
            },
          }),
        );
        return;
      }
      if (expression.includes("element_count: document.querySelectorAll")) {
        response.end(
          JSON.stringify({
            tabId: "tab-1",
            result: {
              url: "https://example.com/app",
              title: "Example App",
              ready_state: "complete",
              text_length: 12,
              element_count: 4,
              active_tag: "body",
            },
          }),
        );
        return;
      }
      if (expression.includes("elementFromPoint")) {
        response.end(
          JSON.stringify({
            tabId: "tab-1",
            result: {
              ok: true,
              url: "https://example.com/app",
              title: "Example App",
              ready_state: "complete",
              hit_test: { x: 20, y: 30, element: { tag_name: "button", text: "New" } },
            },
          }),
        );
        return;
      }
      if (expression.includes("document.title")) {
        response.end(JSON.stringify({ tabId: "tab-1", result: { ok: true, result: "Example App" } }));
        return;
      }
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "unexpected expression" }));
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
        defaultModel: "openai/gpt-5.4",
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

    const findResult = await service.execute("browser_find", {
      text: "New",
      role: "button",
      scope: "viewport",
      max_results: 10,
    });
    assert.equal((findResult.find as { count?: number }).count, 1);
    assert.equal(
      (((findResult.find as { matches?: Array<{ ref?: string }> }).matches ?? [])[0]?.ref),
      "css:#new-button",
    );

    const actResult = await service.execute("browser_act", {
      action: "click",
      text: "New",
      role: "button",
      exact: true,
    });
    assert.equal((actResult.action as { action?: string }).action, "click");
    const nativeInput =
      ((actResult.action as { result?: Record<string, unknown> }).result ?? {}).native_input;
    assert.deepEqual(
      nativeInput,
      { ok: true, tabId: "tab-1", action: "click", x: 370, y: 104 },
    );
    assert.deepEqual(actResult.page, { tabId: "tab-1", url: "https://example.com/app", title: "Example App" });
    assert.deepEqual(mouseBodies, [JSON.stringify({ action: "click", x: 370, y: 104 })]);

    const fillResult = await service.execute("browser_act", {
      action: "fill",
      selector: "#editor",
      value: "Robotics notes",
      clear: true,
    });
    assert.equal((fillResult.action as { action?: string }).action, "fill");
    assert.deepEqual(
      (((fillResult.action as { result?: Record<string, unknown> }).result ?? {}).native_input),
      { ok: true, tabId: "tab-1", action: "insert_text", text_length: 14, clear: true, submit: false },
    );
    assert.deepEqual(keyboardBodies, [
      JSON.stringify({ action: "insert_text", text: "Robotics notes", clear: true, submit: false }),
    ]);

    const waitResult = await service.execute("browser_wait", {
      condition: "element",
      text: "Created",
      timeout_ms: 1000,
    });
    assert.equal((waitResult.wait as { matched?: boolean }).matched, true);
    assert.equal((waitResult.wait as { attempts?: number }).attempts, 2);

    const changeWaitResult = await service.execute("browser_wait", {
      condition: "change",
      timeout_ms: 1000,
    });
    assert.equal((changeWaitResult.wait as { matched?: boolean }).matched, true);
    assert.equal((changeWaitResult.wait as { condition?: string }).condition, "dom_change");

    const evaluateResult = await service.execute("browser_evaluate", {
      expression: "document.title",
      timeout_ms: 1000,
    });
    assert.equal((evaluateResult.evaluation as { result?: string }).result, "Example App");

    const debugResult = await service.execute("browser_debug", { x: 20, y: 30 });
    assert.deepEqual(debugResult.page, { tabId: "tab-1", url: "https://example.com/app", title: "Example App" });
    assert.equal((debugResult.debug as { ready_state?: string }).ready_state, "complete");

    const expressions = evaluateBodies.map((body) => String((JSON.parse(body) as { expression?: string }).expression ?? ""));
    const findExpression = expressions.find((expression) => expression.includes('"text":"New"')) ?? "";
    assert.match(findExpression, /"role":"button"/);
    assert.ok(expressions.some((expression) => /const action = "click"/.test(expression)));
    assert.ok(expressions.some((expression) => /const action = "fill"/.test(expression)));
    assert.ok(expressions.some((expression) => /const condition = "element"/.test(expression)));
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service avoids refetching page summaries for browser_type", async () => {
  const requests: string[] = [];
  const bodies: string[] = [];
  const browserServer = await startBrowserServer(async (request, response) => {
    requests.push(request.url ?? "");
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    bodies.push(Buffer.concat(chunks).toString("utf8"));
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/api/v1/browser/evaluate") {
      response.end(
        JSON.stringify({
          tabId: "tab-1",
          result: { ok: true, index: 1, tag_name: "div", role: "textbox", editable: true }
        })
      );
      return;
    }
    if (request.url === "/api/v1/browser/keyboard") {
      response.end(
        JSON.stringify({
          ok: true,
          tabId: "tab-1",
          action: "insert_text",
          text_length: 12,
          clear: true,
          submit: false,
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
        defaultModel: "openai/gpt-5.4",
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

    const result = await service.execute(
      "browser_type",
      { index: 1, text: "search terms" },
      { workspaceId: "workspace-1", sessionId: "session-1" }
    );

    assert.deepEqual(result, {
      ok: true,
      action: {
        ok: true,
        index: 1,
        tag_name: "div",
        role: "textbox",
        editable: true,
        result: {
          value: "search terms",
          native_input: {
            ok: true,
            tabId: "tab-1",
            action: "insert_text",
            text_length: 12,
            clear: true,
            submit: false,
          },
        },
      }
    });
    assert.deepEqual(requests, ["/api/v1/browser/evaluate", "/api/v1/browser/keyboard"]);
    assert.equal(bodies[1], JSON.stringify({ action: "insert_text", text: "search terms", clear: true, submit: false }));
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service executes browser_open_tab against the desktop browser service", async () => {
  const requests: Array<{ path: string; token: string; workspaceId: string; sessionId: string; body: string }> = [];
  const browserServer = await startBrowserServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      path: request.url ?? "",
      token: String(request.headers["x-holaboss-desktop-token"] ?? ""),
      workspaceId: String(request.headers["x-holaboss-workspace-id"] ?? ""),
      sessionId: String(request.headers["x-holaboss-session-id"] ?? ""),
      body
    });
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/api/v1/browser/tabs") {
      response.end(
        JSON.stringify({
          activeTabId: "tab-2",
          tabs: [
            { id: "tab-1", url: "https://example.com", title: "Example" },
            { id: "tab-2", url: "https://example.org", title: "Example Org" }
          ]
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
        defaultModel: "openai/gpt-5.4",
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

    const result = await service.execute(
      "browser_open_tab",
      { url: "https://example.org", background: true },
      { workspaceId: "workspace-1" }
    );
    assert.deepEqual(result, {
      ok: true,
      tabs: {
        activeTabId: "tab-2",
        tabs: [
          { id: "tab-1", url: "https://example.com", title: "Example" },
          { id: "tab-2", url: "https://example.org", title: "Example Org" }
        ]
      }
    });
    assert.deepEqual(requests, [
      {
        path: "/api/v1/browser/tabs",
        token: "browser-token",
        workspaceId: "workspace-1",
        sessionId: "",
        body: JSON.stringify({ url: "https://example.org", background: true })
      }
    ]);
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
      defaultModel: "openai/gpt-5.4",
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
