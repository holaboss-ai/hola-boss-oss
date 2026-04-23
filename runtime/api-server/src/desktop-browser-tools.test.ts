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
            page_facts: {
              canonical_url: "https://example.com/canonical",
              page_title: "Example Page",
              site_name: "Example",
              meta_description: "Example page description",
              published_time: null,
              main_heading: "Example heading",
              scope_selector: null,
              scope_applied: false,
              headings: [{ level: 1, text: "Example heading", tag_name: "h1" }],
              visible_claims: [{ text: "Example claim about the current page.", tag_name: "p" }],
              quoted_text: [],
              visible_links: [{ href: "https://example.com/more", label: "More information", text: "More information" }],
              numeric_facts: [{ value_text: "1280", context_text: "viewport 1280 width" }],
            },
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
    assert.equal(result.ok, true);
    assert.deepEqual(result.page, {
      tabId: "tab-1",
      url: "https://example.com",
      title: "Example",
    });
    assert.deepEqual(result.state, {
      url: "https://example.com",
      title: "Example",
      scope_selector: null,
      scope_applied: false,
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0 },
      elements_offset: 0,
      elements_limit: 40,
      elements_total: 1,
      elements_has_more: false,
      next_elements_offset: null,
      media_offset: 0,
      media_limit: 20,
      media_total: 1,
      media_has_more: false,
      next_media_offset: null,
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
    });
    assert.deepEqual(result.page_facts, {
      canonical_url: "https://example.com/canonical",
      page_title: "Example Page",
      site_name: "Example",
      meta_description: "Example page description",
      published_time: null,
      main_heading: "Example heading",
      scope_selector: null,
      scope_applied: false,
      headings: [{ level: 1, text: "Example heading", tag_name: "h1" }],
      visible_claims: [{ text: "Example claim about the current page.", tag_name: "p" }],
      quoted_text: [],
      visible_links: [{ href: "https://example.com/more", label: "More information", text: "More information" }],
      numeric_facts: [{ value_text: "1280", context_text: "viewport 1280 width" }],
    });
    assert.equal(typeof result.page_facts_fingerprint, "string");
    assert.equal((result.page_facts_fingerprint as string).length, 64);
    assert.equal(typeof result.state_fingerprint, "string");
    assert.equal((result.state_fingerprint as string).length, 64);
    assert.deepEqual(result.trust_boundary, {
      browser_content_untrusted: true,
      source_origin: "https://example.com",
      page_text_untrusted: false,
      page_facts_unverified: true,
    });
    assert.deepEqual(result.screenshot, {
      tabId: "tab-1",
      mimeType: "image/png",
      width: 1280,
      height: 720,
      base64: "cG5n"
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

test("desktop browser tool service exposes compact semantic facts without returning full state", async () => {
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
    if (request.url === "/api/v1/browser/page") {
      response.end(JSON.stringify({ tabId: "tab-1", url: "https://example.com/post", title: "Example Post" }));
      return;
    }
    if (request.url === "/api/v1/browser/evaluate") {
      response.end(
        JSON.stringify({
          tabId: "tab-1",
          result: {
            url: "https://example.com/post",
            title: "Example Post",
            viewport: { width: 1280, height: 720 },
            scroll: { x: 0, y: 64 },
            elements: [],
            media: [],
            page_facts: {
              canonical_url: "https://example.com/post",
              page_title: "Example Post",
              site_name: "Example",
              meta_description: "Compact page summary",
              published_time: "2026-04-23T00:00:00Z",
              main_heading: "Thin Harnesses",
              scope_selector: "#main",
              scope_applied: true,
              headings: [{ level: 1, text: "Thin Harnesses", tag_name: "h1" }],
              visible_claims: [{ text: "Thin harnesses work best when the heavy reasoning is explicit.", tag_name: "p" }],
              quoted_text: [{ text: "\"Do less orchestration, more explicit state.\"", tag_name: "blockquote" }],
              visible_links: [{ href: "https://example.com/details", label: "Details", text: "Details" }],
              numeric_facts: [{ value_text: "40k", context_text: "Posts with 40k views" }],
            },
          },
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
        loadedFromFile: true,
      }),
    });

    const result = await service.execute(
      "browser_extract_facts",
      { scope_selector: "#main" },
      { workspaceId: "workspace-1", sessionId: "session-1" }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.page, {
      tabId: "tab-1",
      url: "https://example.com/post",
      title: "Example Post",
    });
    assert.deepEqual(result.page_facts, {
      canonical_url: "https://example.com/post",
      page_title: "Example Post",
      site_name: "Example",
      meta_description: "Compact page summary",
      published_time: "2026-04-23T00:00:00Z",
      main_heading: "Thin Harnesses",
      scope_selector: "#main",
      scope_applied: true,
      headings: [{ level: 1, text: "Thin Harnesses", tag_name: "h1" }],
      visible_claims: [{ text: "Thin harnesses work best when the heavy reasoning is explicit.", tag_name: "p" }],
      quoted_text: [{ text: "\"Do less orchestration, more explicit state.\"", tag_name: "blockquote" }],
      visible_links: [{ href: "https://example.com/details", label: "Details", text: "Details" }],
      numeric_facts: [{ value_text: "40k", context_text: "Posts with 40k views" }],
    });
    assert.equal("state" in result, false);
    assert.equal(typeof result.page_facts_fingerprint, "string");
    assert.equal(typeof result.state_fingerprint, "string");
    assert.deepEqual(result.trust_boundary, {
      browser_content_untrusted: true,
      source_origin: "https://example.com",
      page_facts_unverified: true,
    });
    const evaluatePayload = JSON.parse(requests[1]?.body ?? "{}") as { expression?: string };
    assert.match(String(evaluatePayload.expression ?? ""), /const scopeSelector = "#main";/);
  } finally {
    await browserServer.close();
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

    const text = String((result.state as { text?: string }).text ?? "");
    assert.match(text, /HOLABOSS_UNTRUSTED_PAGE_CONTENT/);
    assert.match(text, /origin=https:\/\/example\.com/);
    assert.match(text, /Example Domain/);
    assert.equal(
      (result.trust_boundary as { page_text_boundary?: Record<string, unknown> })?.page_text_boundary?.origin,
      "https://example.com",
    );
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service forwards browser_get_state scope and pagination params", async () => {
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
            scope_selector: "#sidebar",
            scope_applied: true,
            viewport: { width: 1280, height: 720 },
            scroll: { x: 0, y: 0 },
            elements_offset: 20,
            elements_limit: 10,
            elements_total: 82,
            elements_has_more: true,
            next_elements_offset: 30,
            media_offset: 4,
            media_limit: 3,
            media_total: 12,
            media_has_more: true,
            next_media_offset: 7,
            elements: [{ index: 21, tag_name: "button", label: "Next page", text: "Next page" }],
            media: [],
          },
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
        loadedFromFile: true,
      }),
    });

    const result = await service.execute(
      "browser_get_state",
      {
        scope_selector: "#sidebar",
        element_offset: 20,
        element_limit: 10,
        media_offset: 4,
        media_limit: 3,
      },
      { workspaceId: "workspace-1", sessionId: "session-1" }
    );

    assert.equal(result.ok, true);
    assert.equal((result.state as { scope_selector?: string }).scope_selector, "#sidebar");
    assert.equal((result.state as { elements_offset?: number }).elements_offset, 20);
    assert.equal((result.state as { elements_limit?: number }).elements_limit, 10);
    assert.equal((result.state as { media_offset?: number }).media_offset, 4);
    assert.equal((result.state as { media_limit?: number }).media_limit, 3);
    const evaluatePayload = JSON.parse(requests[1]?.body ?? "{}") as { expression?: string };
    const expression = evaluatePayload.expression ?? "";
    assert.match(expression, /const scopeSelector = "#sidebar";/);
    assert.match(expression, /const elementOffset = 20;/);
    assert.match(expression, /const elementLimit = 10;/);
    assert.match(expression, /const mediaOffset = 4;/);
    assert.match(expression, /const mediaLimit = 3;/);
    assert.match(expression, /collectDocumentEntries/);
    assert.match(expression, /frame_path/);
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service waits for selector readiness", async () => {
  let evaluateCalls = 0;
  const browserServer = await startBrowserServer(async (request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/api/v1/browser/evaluate") {
      evaluateCalls += 1;
      response.end(
        JSON.stringify({
          tabId: "tab-1",
          result: {
            selector: "#ready",
            expected_state: "visible",
            matched: evaluateCalls > 1,
            present_count: evaluateCalls > 1 ? 1 : 0,
            visible_count: evaluateCalls > 1 ? 1 : 0,
            frame_count: 1,
            inaccessible_frame_count: 0,
          },
        }),
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

    const result = await service.execute("browser_wait_for_selector", {
      selector: "#ready",
      timeout_ms: 1000,
      interval_ms: 1,
    });
    assert.equal(result.ok, true);
    assert.equal(result.waited_for, "selector");
    assert.equal(evaluateCalls >= 2, true);
  } finally {
    await browserServer.close();
  }
});

test("desktop browser tool service enforces allowed-domain policy", async () => {
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
      desktopBrowserAllowedDomains: ["example.com"],
      configPath: "/tmp/runtime-config.json",
      loadedFromFile: true,
    }),
  });

  await assert.rejects(
    service.execute("browser_navigate", { url: "https://blocked.example.net/path" }),
    (error: unknown) =>
      error instanceof DesktopBrowserToolServiceError &&
      error.statusCode === 403 &&
      error.code === "browser_domain_blocked",
  );
});

test("desktop browser tool service enforces confirm-required action policy", async () => {
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
      desktopBrowserConfirmActions: ["interaction"],
      configPath: "/tmp/runtime-config.json",
      loadedFromFile: true,
    }),
  });

  await assert.rejects(
    service.execute("browser_click", { index: 1 }),
    (error: unknown) =>
      error instanceof DesktopBrowserToolServiceError &&
      error.statusCode === 409 &&
      error.code === "browser_action_confirmation_required",
  );
});

test("desktop browser tool service avoids refetching page summaries for browser_type", async () => {
  const requests: string[] = [];
  const browserServer = await startBrowserServer(async (request, response) => {
    requests.push(request.url ?? "");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.url === "/api/v1/browser/evaluate") {
      response.end(
        JSON.stringify({
          tabId: "tab-1",
          result: { ok: true, index: 1, value: "search terms" }
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
      action: { ok: true, index: 1, value: "search terms" }
    });
    assert.deepEqual(requests, ["/api/v1/browser/evaluate"]);
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
