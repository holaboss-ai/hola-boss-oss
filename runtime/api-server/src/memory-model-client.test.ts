import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  queryMemoryModelEmbedding,
  queryMemoryModelJson,
} from "./memory-model-client.js";

const ORIGINAL_FETCH = globalThis.fetch;
type RecordedCall = { url: string; headers: HeadersInit | undefined; body: Record<string, unknown> | null };

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test("queryMemoryModelJson uses OpenAI-compatible chat completions", async () => {
  let call: RecordedCall | null = null;
  globalThis.fetch = (async (input, init) => {
    call = {
      url: String(input),
      headers: init?.headers,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ ok: true }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const payload = await queryMemoryModelJson(
    {
      baseUrl: "https://runtime.example/api/v1/model-proxy/openai/v1",
      apiKey: "token-1",
      modelId: "gpt-5.4-mini",
      apiStyle: "openai_compatible",
    },
    {
      systemPrompt: "Return JSON.",
      userPrompt: "Hello",
    },
  );

  assert.deepEqual(payload, { ok: true });
  assert.ok(call);
  const recordedCall = call as RecordedCall;
  assert.equal(recordedCall.url, "https://runtime.example/api/v1/model-proxy/openai/v1/chat/completions");
  assert.equal((recordedCall.headers as Record<string, string>).Authorization, "Bearer token-1");
  assert.equal(recordedCall.body?.model, "gpt-5.4-mini");
  assert.deepEqual(recordedCall.body?.response_format, { type: "json_object" });
});

test("queryMemoryModelJson treats dedicated Google proxy routes as OpenAI-compatible chat completions", async () => {
  let call: RecordedCall | null = null;
  globalThis.fetch = (async (input, init) => {
    call = {
      url: String(input),
      headers: init?.headers,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ provider: "google" }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const payload = await queryMemoryModelJson(
    {
      baseUrl: "https://runtime.example/api/v1/model-proxy/google/v1",
      apiKey: "token-google",
      modelId: "gemini-2.5-flash",
    },
    {
      systemPrompt: "Return JSON.",
      userPrompt: "Hello",
    },
  );

  assert.deepEqual(payload, { provider: "google" });
  assert.ok(call);
  const recordedCall = call as RecordedCall;
  assert.equal(recordedCall.url, "https://runtime.example/api/v1/model-proxy/google/v1/chat/completions");
  assert.equal((recordedCall.headers as Record<string, string>).Authorization, "Bearer token-google");
  assert.equal(recordedCall.body?.model, "gemini-2.5-flash");
});

test("queryMemoryModelJson uses Anthropic native messages with strict JSON prompting", async () => {
  let call: RecordedCall | null = null;
  globalThis.fetch = (async (input, init) => {
    call = {
      url: String(input),
      headers: init?.headers,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: '{"stage":"ok"}',
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const payload = await queryMemoryModelJson(
    {
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      modelId: "claude-sonnet-4-6",
      apiStyle: "anthropic_native",
    },
    {
      systemPrompt: "Return JSON.",
      userPrompt: "Hello",
    },
  );

  assert.deepEqual(payload, { stage: "ok" });
  assert.ok(call);
  const recordedCall = call as RecordedCall;
  assert.equal(recordedCall.url, "https://api.anthropic.com/v1/messages");
  assert.equal((recordedCall.headers as Record<string, string>)["x-api-key"], "sk-ant-test");
  assert.equal((recordedCall.headers as Record<string, string>)["anthropic-version"], "2023-06-01");
  assert.equal(recordedCall.body?.model, "claude-sonnet-4-6");
  assert.equal(recordedCall.body?.system, "Return JSON.");
  assert.deepEqual(recordedCall.body?.messages, [{ role: "user", content: "Hello" }]);
});

test("queryMemoryModelEmbedding uses OpenAI-compatible embeddings", async () => {
  let call: RecordedCall | null = null;
  globalThis.fetch = (async (input, init) => {
    call = {
      url: String(input),
      headers: init?.headers,
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null,
    };
    return new Response(
      JSON.stringify({
        data: [
          {
            embedding: [0.25, 0.5, 0.75],
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const embedding = await queryMemoryModelEmbedding(
    {
      baseUrl: "https://runtime.example/api/v1/model-proxy/openai/v1",
      apiKey: "token-embedding",
      modelId: "text-embedding-3-small",
      apiStyle: "openai_compatible",
    },
    {
      input: "Remember this workspace fact.",
    },
  );

  assert.ok(embedding);
  assert.deepEqual(Array.from(embedding ?? []), [0.25, 0.5, 0.75]);
  assert.ok(call);
  const recordedCall = call as RecordedCall;
  assert.equal(
    recordedCall.url,
    "https://runtime.example/api/v1/model-proxy/openai/v1/embeddings",
  );
  assert.equal(
    (recordedCall.headers as Record<string, string>).Authorization,
    "Bearer token-embedding",
  );
  assert.deepEqual(recordedCall.body, {
    model: "text-embedding-3-small",
    input: "Remember this workspace fact.",
    encoding_format: "float",
  });
});

test("queryMemoryModelEmbedding captures redacted Sentry diagnostics on upstream failure", async () => {
  const captures: Array<Record<string, unknown>> = [];
  const embeddingInput =
    "remember authorization=Bearer secret-token and workspace facts";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: "upstream failed",
        api_key: "sk-secret",
      }),
      {
        status: 502,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  const embedding = await queryMemoryModelEmbedding(
    {
      baseUrl: "https://runtime.example/api/v1/model-proxy/openai/v1",
      apiKey: "token-embedding",
      modelId: "text-embedding-3-small",
      apiStyle: "openai_compatible",
      defaultHeaders: {
        "X-API-Key": "proxy-secret",
        "X-Holaboss-User-Id": "user-1",
        "X-Holaboss-Sandbox-Id": "desktop:sandbox-1",
        "X-Holaboss-Session-Id": "session-1",
        "X-Holaboss-Workspace-Id": "workspace-1",
        "X-Holaboss-Input-Id": "input-1",
      },
    },
    {
      input: embeddingInput,
    },
    {
      captureException(capture) {
        captures.push(capture as unknown as Record<string, unknown>);
      },
    },
  );

  assert.equal(embedding, null);
  assert.equal(captures.length, 1);
  const capture = captures[0] as {
    tags?: Record<string, unknown>;
    contexts?: Record<string, Record<string, unknown>>;
    attachments?: Array<{ filename: string; data: string | Uint8Array }>;
  };
  assert.equal(capture.tags?.surface, "memory_model_embedding");
  assert.equal(capture.tags?.failure_kind, "upstream_non_ok");
  assert.equal(capture.tags?.response_status, 502);
  assert.equal(
    capture.contexts?.memory_model_embedding_request?.workspace_id,
    "workspace-1",
  );
  assert.equal(
    capture.contexts?.memory_model_embedding_request?.session_id,
    "session-1",
  );
  assert.equal(
    capture.contexts?.memory_model_embedding_request?.input_id,
    "input-1",
  );
  assert.equal(
    capture.contexts?.memory_model_embedding_request?.model,
    "text-embedding-3-small",
  );
  assert.equal(
    capture.contexts?.memory_model_embedding_response?.status,
    502,
  );
  const requestAttachment = capture.attachments?.find(
    (attachment) => attachment.filename === "embedding-request.json",
  );
  const responseAttachment = capture.attachments?.find(
    (attachment) => attachment.filename === "embedding-response.json",
  );
  assert.ok(requestAttachment);
  assert.ok(responseAttachment);
  const requestPayload = JSON.parse(String(requestAttachment?.data)) as Record<
    string,
    unknown
  >;
  const responsePayload = JSON.parse(String(responseAttachment?.data)) as Record<
    string,
    unknown
  >;
  assert.equal(requestPayload.endpoint, "https://runtime.example/api/v1/model-proxy/openai/v1/embeddings");
  assert.deepEqual(requestPayload.headers, {
    "Content-Type": "application/json",
    "X-Holaboss-Input-Id": "input-1",
    "X-Holaboss-Sandbox-Id": "desktop:sandbox-1",
    "X-Holaboss-Session-Id": "session-1",
    "X-Holaboss-User-Id": "user-1",
    "X-Holaboss-Workspace-Id": "workspace-1",
  });
  assert.equal(
    (requestPayload.body as Record<string, unknown>).model,
    "text-embedding-3-small",
  );
  assert.equal(
    (requestPayload.body as Record<string, unknown>).encoding_format,
    "float",
  );
  assert.equal(
    (requestPayload.body as Record<string, unknown>).input_length,
    embeddingInput.length,
  );
  assert.match(
    String((requestPayload.body as Record<string, unknown>).input_preview),
    /\[REDACTED\]/,
  );
  assert.equal(responsePayload.status, 502);
  assert.equal(responsePayload.content_type, "application/json");
  assert.doesNotMatch(
    String(responsePayload.body_preview),
    /sk-secret/,
  );
  assert.match(String(responsePayload.body_preview), /\[REDACTED\]/);
});
