import assert from "node:assert/strict";
import test from "node:test";

import { ComposioService, type ComposioServiceConfig } from "./composio-service.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
  });
}

function createService(fetchImpl: typeof fetch, overrides: Partial<ComposioServiceConfig> = {}): ComposioService {
  return new ComposioService({
    honoBaseUrl: "https://app.holaboss.test/",
    authCookie: "hb_session=abc123",
    fetchImpl,
    ...overrides
  });
}

test("proxyRequest forwards the Hono session cookie and returns the envelope payload", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return jsonResponse({
      data: { emailAddress: "test@gmail.com", messagesTotal: 42 },
      status: 201,
      headers: { "content-type": "application/json" }
    });
  };

  const service = createService(fetchImpl);
  const result = await service.proxyRequest<{ emailAddress: string; messagesTotal: number }>({
    connectedAccountId: "ca_500",
    method: "GET",
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile"
  });

  assert.equal(calls.length, 1);
  assert.equal(String(calls[0]?.input), "https://app.holaboss.test/api/composio/proxy");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal((calls[0]?.init?.headers as Record<string, string>)?.Cookie, "hb_session=abc123");

  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.deepEqual(body, {
    connected_account_id: "ca_500",
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    method: "GET"
  });

  assert.equal(result.status, 201);
  assert.equal(result.data?.emailAddress, "test@gmail.com");
  assert.equal(result.data?.messagesTotal, 42);
  assert.equal(result.headers["content-type"], "application/json");
});

test("proxyRequest includes the optional request body for mutating calls", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return jsonResponse({
      data: { id: "msg_123" },
      status: 200,
      headers: {}
    });
  };

  const service = createService(fetchImpl, { honoBaseUrl: "https://edge.holaboss.test" });
  const result = await service.proxyRequest<{ id: string }>({
    connectedAccountId: "ca_600",
    method: "POST",
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    body: { raw: "base64encodedmessage" }
  });

  assert.equal(result.data?.id, "msg_123");
  assert.deepEqual(capturedBody, {
    connected_account_id: "ca_600",
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    method: "POST",
    body: { raw: "base64encodedmessage" }
  });
});

test("proxyRequest falls back to the HTTP status when the Hono payload omits status", async () => {
  const fetchImpl: typeof fetch = async () => {
    return jsonResponse(
      {
        data: { ok: true },
        headers: { "x-test": "1" }
      },
      { status: 202 }
    );
  };

  const service = createService(fetchImpl);
  const result = await service.proxyRequest<{ ok: boolean }>({
    connectedAccountId: "ca_700",
    method: "DELETE",
    endpoint: "https://api.github.com/user/installations/123"
  });

  assert.equal(result.status, 202);
  assert.equal(result.data?.ok, true);
  assert.equal(result.headers["x-test"], "1");
});

test("proxyRequest throws a descriptive error when the Hono proxy call fails", async () => {
  const fetchImpl: typeof fetch = async () => {
    return new Response("rate limited", { status: 429 });
  };

  const service = createService(fetchImpl);
  await assert.rejects(
    () =>
      service.proxyRequest({
        connectedAccountId: "ca_800",
        method: "GET",
        endpoint: "https://api.github.com/user"
      }),
    (error: Error) => {
      assert.match(error.message, /Composio proxy via Hono failed: 429/);
      return true;
    }
  );
});
