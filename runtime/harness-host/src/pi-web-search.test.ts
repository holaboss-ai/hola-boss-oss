import assert from "node:assert/strict";
import test from "node:test";

import { resolvePiWebSearchToolDefinitions } from "./pi-web-search.js";

test("Pi web search tool proxies Exa hosted MCP and returns the raw text block", async () => {
  const requests: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const tools = await resolvePiWebSearchToolDefinitions({
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

test("Pi web search tool requires a non-empty query", async () => {
  const tools = await resolvePiWebSearchToolDefinitions();
  await assert.rejects(
    async () => await tools[0]!.execute("call-1", { query: "   " }, undefined, undefined, {} as never),
    /query is required/
  );
});

test("Pi web search tool surfaces HTTP errors from the hosted MCP endpoint", async () => {
  const tools = await resolvePiWebSearchToolDefinitions({
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
