import assert from "node:assert/strict";
import test from "node:test";

import {
  nativeWebSearchPayload,
  searchPublicWeb,
  webSearchDescription,
} from "./native-web-search.js";

test("searchPublicWeb proxies hosted Exa MCP and returns the raw text block", async () => {
  const requests: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const result = await searchPublicWeb({
    query: "latest alpha 2026",
    numResults: 3,
    livecrawl: "preferred",
    type: "deep",
    contextMaxCharacters: 12000,
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

  assert.equal(result.text, "Title: Alpha Result\nURL: https://example.com/alpha\nPublished: 2026-04-03T10:00:00.000Z\nAuthor: Jeffrey\nHighlights:\nAlpha summary");
  assert.equal(result.providerId, "exa_hosted_mcp");
  assert.equal(requests[0]?.url, "https://mcp.exa.ai/mcp");
  assert.equal(requests[0]?.init?.method, "POST");
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
});

test("nativeWebSearchPayload normalizes compatibility aliases and optional fields", () => {
  assert.deepEqual(
    nativeWebSearchPayload({
      query: "latest alpha 2026",
      max_results: 2,
      livecrawl: "preferred",
      type: "fast",
      context_max_characters: 9000,
    }),
    {
      query: "latest alpha 2026",
      numResults: 2,
      livecrawl: "preferred",
      type: "fast",
      contextMaxCharacters: 9000,
    }
  );
});

test("searchPublicWeb requires a non-empty query", async () => {
  await assert.rejects(async () => await searchPublicWeb({ query: "   " }), /query is required/);
});

test("searchPublicWeb surfaces HTTP errors from the hosted MCP endpoint", async () => {
  await assert.rejects(
    async () =>
      await searchPublicWeb({
        query: "alpha 2026",
        fetchImpl: async () =>
          new Response("upstream unavailable", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
      }),
    /web_search failed with status 503: upstream unavailable/
  );
});

test("webSearchDescription includes the current year guidance", () => {
  assert.match(webSearchDescription("Search the web."), new RegExp(String(new Date().getFullYear())));
});
