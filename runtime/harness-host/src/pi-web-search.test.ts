import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolvePiWebSearchToolDefinitions } from "./pi-web-search.js";

test("Pi web search tool proxies Exa hosted MCP and returns the raw text block", async () => {
  const requests: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const tools = await resolvePiWebSearchToolDefinitions({
    providerKind: "exa_hosted_mcp",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        [
          "event: message",
          'data: {"result":{"content":[{"type":"text","text":"Title: Alpha Result\\nURL: https://example.com/alpha\\nPublished: 2026-04-03T10:00:00.000Z\\nAuthor: Jeffrey\\nHighlights:\\nAlpha summary"}]},"jsonrpc":"2.0","id":1}',
          "",
        ].join("\n"),
        {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        }
      );
    },
  });

  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, "web_search");
  assert.match(tools[0]?.description ?? "", /discover and summarize information across multiple sources/i);
  assert.match(tools[0]?.description ?? "", /exact live values, platform-native rankings or filters, UI-only state/i);
  assert.match(tools[0]?.description ?? "", /escalate to browser tools or another more direct capability/i);

  const result = await tools[0]!.execute(
    "call-1",
    {
      query: "latest alpha 2026",
      num_results: 3,
      livecrawl: "preferred",
      type: "deep",
      context_max_characters: 12000,
    },
    undefined,
    undefined,
    {} as never
  );

  assert.equal(result.content[0]?.type, "text");
  assert.equal(
    result.content[0]?.type === "text" ? result.content[0].text : "",
    "Title: Alpha Result\nURL: https://example.com/alpha\nPublished: 2026-04-03T10:00:00.000Z\nAuthor: Jeffrey\nHighlights:\nAlpha summary"
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://mcp.exa.ai/mcp");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(requests[0]?.init?.headers, {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "web_search_exa",
      arguments: {
        query: "latest alpha 2026",
        numResults: 3,
        livecrawl: "preferred",
        type: "deep",
        contextMaxCharacters: 12000,
      },
    },
  });
  assert.deepEqual(result.details, {
    tool_id: "web_search",
    provider: "exa_hosted_mcp",
  });
});

test("Pi web search tool supports max_results as a compatibility alias for num_results", async () => {
  let requestBody = "";
  const tools = await resolvePiWebSearchToolDefinitions({
    providerKind: "exa_hosted_mcp",
    fetchImpl: async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(
        'event: message\ndata: {"result":{"content":[{"type":"text","text":"ok"}]},"jsonrpc":"2.0","id":1}\n',
        {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        }
      );
    },
  });

  const result = await tools[0]!.execute(
    "call-1",
    { query: "latest alpha 2026", max_results: 2 },
    undefined,
    undefined,
    {} as never
  );

  assert.equal(result.content[0]?.type === "text" ? result.content[0].text : "", "ok");
  assert.equal(JSON.parse(requestBody).params.arguments.numResults, 2);
});

test("Pi web search tool can use a configured Holaboss search provider", async () => {
  const requests: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const tools = await resolvePiWebSearchToolDefinitions({
    providerId: "holaboss_search",
    providerKind: "holaboss_search",
    baseUrl: "https://api.holaboss.test/api/v1/search/web",
    apiKey: "hb-search-key",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ text: "holaboss result" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    },
  });

  const result = await tools[0]!.execute(
    "call-1",
    { query: "latest alpha 2026", max_results: 2 },
    undefined,
    undefined,
    {} as never
  );

  assert.equal(result.content[0]?.type === "text" ? result.content[0].text : "", "holaboss result");
  assert.equal(requests[0]?.url, "https://api.holaboss.test/api/v1/search/web");
  assert.deepEqual(result.details, {
    tool_id: "web_search",
    provider: "holaboss_search",
  });
});

test("Pi web search tool defaults to managed Holaboss search when runtime binding is present", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "holaboss-web-search-"));
  const previousConfigPath = process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  const configPath = path.join(tempDir, "runtime-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      control_plane_base_url: "https://api.holaboss.test",
      integrations: {
        holaboss: {
          auth_token: "hb-search-key",
          user_id: "user-1",
          sandbox_id: "desktop:sandbox-1",
        },
      },
    })
  );
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;

  try {
    const requests: Array<{
      url: string;
      init?: RequestInit;
    }> = [];
    const tools = await resolvePiWebSearchToolDefinitions({
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify({ text: "managed result" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    });

    const result = await tools[0]!.execute(
      "call-1",
      { query: "latest alpha 2026", max_results: 2 },
      undefined,
      undefined,
      {} as never
    );

    assert.equal(result.content[0]?.type === "text" ? result.content[0].text : "", "managed result");
    assert.equal(requests[0]?.url, "https://api.holaboss.test/api/v1/search/web");
    assert.deepEqual(requests[0]?.init?.headers, {
      accept: "application/json",
      "content-type": "application/json",
      authorization: "Bearer hb-search-key",
      "x-api-key": "hb-search-key",
      "X-Holaboss-User-Id": "user-1",
      "X-Holaboss-Sandbox-Id": "desktop:sandbox-1",
      "X-Holaboss-Tool-Call-Id": "call-1",
    });
    assert.deepEqual(result.details, {
      tool_id: "web_search",
      provider: "holaboss_search",
    });
  } finally {
    if (previousConfigPath === undefined) {
      delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
    } else {
      process.env.HOLABOSS_RUNTIME_CONFIG_PATH = previousConfigPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Pi web search tool preserves sandbox gateway prefixes when deriving Holaboss search URL from control plane config", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "holaboss-web-search-"));
  const previousConfigPath = process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  const configPath = path.join(tempDir, "runtime-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      control_plane_base_url: "https://api.imerchstaging.com/gateway/sandbox",
      integrations: {
        holaboss: {
          auth_token: "hb-search-key",
          user_id: "user-1",
          sandbox_id: "desktop:sandbox-1",
        },
      },
    }),
  );
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;

  try {
    const requests: Array<{
      url: string;
      init?: RequestInit;
    }> = [];
    const tools = await resolvePiWebSearchToolDefinitions({
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify({ text: "managed result" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    });

    const result = await tools[0]!.execute(
      "call-1",
      { query: "latest alpha 2026", max_results: 2 },
      undefined,
      undefined,
      {} as never,
    );

    assert.equal(
      result.content[0]?.type === "text" ? result.content[0].text : "",
      "managed result",
    );
    assert.equal(
      requests[0]?.url,
      "https://api.imerchstaging.com/gateway/sandbox/api/v1/search/web",
    );
  } finally {
    if (previousConfigPath === undefined) {
      delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
    } else {
      process.env.HOLABOSS_RUNTIME_CONFIG_PATH = previousConfigPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Pi web search tool derives local Holaboss search URL from model proxy config", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "holaboss-web-search-"));
  const previousConfigPath = process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  const configPath = path.join(tempDir, "runtime-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      model_proxy_base_url: "http://127.0.0.1:3060/api/v1/model-proxy",
      integrations: {
        holaboss: {
          auth_token: "hb-search-key",
          user_id: "user-1",
          sandbox_id: "desktop:sandbox-1",
        },
      },
      web_search: {
        provider: "holaboss_search",
        providers: {
          holaboss_search: {
            kind: "holaboss_search",
          },
        },
      },
    })
  );
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;

  try {
    const requests: Array<{
      url: string;
      init?: RequestInit;
    }> = [];
    const tools = await resolvePiWebSearchToolDefinitions({
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify({ text: "managed result" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    });

    const result = await tools[0]!.execute(
      "call-1",
      { query: "latest alpha 2026", max_results: 2 },
      undefined,
      undefined,
      {} as never
    );

    assert.equal(result.content[0]?.type === "text" ? result.content[0].text : "", "managed result");
    assert.equal(requests[0]?.url, "http://127.0.0.1:3060/api/v1/search/web");
    assert.deepEqual(requests[0]?.init?.headers, {
      accept: "application/json",
      "content-type": "application/json",
      authorization: "Bearer hb-search-key",
      "x-api-key": "hb-search-key",
      "X-Holaboss-User-Id": "user-1",
      "X-Holaboss-Sandbox-Id": "desktop:sandbox-1",
      "X-Holaboss-Tool-Call-Id": "call-1",
    });
    assert.deepEqual(result.details, {
      tool_id: "web_search",
      provider: "holaboss_search",
    });
  } finally {
    if (previousConfigPath === undefined) {
      delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
    } else {
      process.env.HOLABOSS_RUNTIME_CONFIG_PATH = previousConfigPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Pi web search tool preserves sandbox gateway prefixes when deriving Holaboss search URL from model proxy config", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "holaboss-web-search-"));
  const previousConfigPath = process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  const configPath = path.join(tempDir, "runtime-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      model_proxy_base_url:
        "https://api.imerchstaging.com/gateway/sandbox/api/v1/model-proxy",
      integrations: {
        holaboss: {
          auth_token: "hb-search-key",
          user_id: "user-1",
          sandbox_id: "desktop:sandbox-1",
        },
      },
      web_search: {
        provider: "holaboss_search",
        providers: {
          holaboss_search: {
            kind: "holaboss_search",
          },
        },
      },
    })
  );
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;

  try {
    const requests: Array<{
      url: string;
      init?: RequestInit;
    }> = [];
    const tools = await resolvePiWebSearchToolDefinitions({
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify({ text: "managed result" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    });

    const result = await tools[0]!.execute(
      "call-1",
      { query: "latest alpha 2026", max_results: 2 },
      undefined,
      undefined,
      {} as never
    );

    assert.equal(
      result.content[0]?.type === "text" ? result.content[0].text : "",
      "managed result"
    );
    assert.equal(
      requests[0]?.url,
      "https://api.imerchstaging.com/gateway/sandbox/api/v1/search/web"
    );
  } finally {
    if (previousConfigPath === undefined) {
      delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
    } else {
      process.env.HOLABOSS_RUNTIME_CONFIG_PATH = previousConfigPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Pi web search tool falls back to Exa when stale Holaboss search config has no managed binding", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "holaboss-web-search-"));
  const previousConfigPath = process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  const configPath = path.join(tempDir, "runtime-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      control_plane_base_url: "https://api.imerchstaging.com/gateway/sandbox",
      web_search: {
        provider: "holaboss_search",
        providers: {
          holaboss_search: {
            kind: "holaboss_search",
          },
          exa: {
            kind: "exa_hosted_mcp",
          },
        },
      },
    }),
  );
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;

  try {
    const requests: Array<{
      url: string;
      init?: RequestInit;
    }> = [];
    const tools = await resolvePiWebSearchToolDefinitions({
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(
          'event: message\ndata: {"result":{"content":[{"type":"text","text":"exa fallback result"}]},"jsonrpc":"2.0","id":1}\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          },
        );
      },
    });

    const result = await tools[0]!.execute(
      "call-1",
      { query: "latest alpha 2026", max_results: 2 },
      undefined,
      undefined,
      {} as never,
    );

    assert.equal(
      result.content[0]?.type === "text" ? result.content[0].text : "",
      "exa fallback result",
    );
    assert.equal(requests[0]?.url, "https://mcp.exa.ai/mcp");
    assert.deepEqual(result.details, {
      tool_id: "web_search",
      provider: "exa_hosted_mcp",
    });
  } finally {
    if (previousConfigPath === undefined) {
      delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
    } else {
      process.env.HOLABOSS_RUNTIME_CONFIG_PATH = previousConfigPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Pi web search tool requires a non-empty query", async () => {
  const tools = await resolvePiWebSearchToolDefinitions({
    providerKind: "exa_hosted_mcp",
  });
  await assert.rejects(
    async () => await tools[0]!.execute("call-1", { query: "   " }, undefined, undefined, {} as never),
    /query is required/
  );
});

test("Pi web search tool surfaces HTTP errors from the hosted MCP endpoint", async () => {
  const tools = await resolvePiWebSearchToolDefinitions({
    providerKind: "exa_hosted_mcp",
    fetchImpl: async () =>
      new Response("upstream unavailable", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
  });

  await assert.rejects(
    async () => await tools[0]!.execute("call-1", { query: "alpha 2026" }, undefined, undefined, {} as never),
    /web_search failed with status 503: upstream unavailable/
  );
});
