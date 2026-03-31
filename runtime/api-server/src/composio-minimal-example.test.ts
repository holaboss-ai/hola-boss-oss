import assert from "node:assert/strict";
import test from "node:test";

import { createManagedConnectLink } from "./composio-minimal-example.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
  });
}

test("createManagedConnectLink reuses an enabled managed auth config before creating a link", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    const url = String(input);
    if (url.includes("/api/v3/auth_configs?")) {
      return jsonResponse({
        items: [
          {
            id: "authcfg_existing",
            status: "ENABLED",
            is_composio_managed: true,
            toolkit: { slug: "gmail" }
          }
        ]
      });
    }
    if (url.endsWith("/api/v3/connected_accounts/link")) {
      return jsonResponse(
        {
          link_token: "lt_123",
          redirect_url: "https://auth.composio.dev/connect?token=lt_123",
          expires_at: "2026-04-01T00:00:00.000Z",
          connected_account_id: "ca_123"
        },
        { status: 201 }
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  const result = await createManagedConnectLink({
    apiKey: "test-key",
    toolkitSlug: "gmail",
    userId: "user-1",
    callbackUrl: "https://example.com/callback",
    fetchImpl
  });

  assert.deepEqual(result, {
    authConfigId: "authcfg_existing",
    authConfigCreated: false,
    connectedAccountId: "ca_123",
    redirectUrl: "https://auth.composio.dev/connect?token=lt_123",
    expiresAt: "2026-04-01T00:00:00.000Z",
    userId: "user-1"
  });
  assert.equal(calls.length, 2);
  assert.match(String(calls[0]?.input), /toolkit_slug=gmail/);
  assert.match(String(calls[0]?.input), /is_composio_managed=true/);
  assert.equal(calls[1]?.init?.method, "POST");
});

test("createManagedConnectLink creates a managed auth config when none exists", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    const url = String(input);
    if (url.includes("/api/v3/auth_configs?")) {
      return jsonResponse({ items: [] });
    }
    if (url.endsWith("/api/v3/auth_configs")) {
      return jsonResponse(
        {
          toolkit: { slug: "gmail" },
          auth_config: {
            id: "authcfg_created",
            auth_scheme: "OAUTH2",
            is_composio_managed: true
          }
        },
        { status: 201 }
      );
    }
    if (url.endsWith("/api/v3/connected_accounts/link")) {
      return jsonResponse(
        {
          link_token: "lt_456",
          redirect_url: "https://auth.composio.dev/connect?token=lt_456",
          expires_at: "2026-04-01T00:00:00.000Z",
          connected_account_id: "ca_456"
        },
        { status: 201 }
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  const result = await createManagedConnectLink({
    apiKey: "test-key",
    toolkitSlug: "gmail",
    userId: "user-2",
    fetchImpl
  });

  assert.equal(result.authConfigId, "authcfg_created");
  assert.equal(result.authConfigCreated, true);
  assert.equal(result.connectedAccountId, "ca_456");
  assert.equal(calls.length, 3);
  assert.equal(calls[1]?.init?.method, "POST");
  assert.equal(calls[2]?.init?.method, "POST");
});
