import assert from "node:assert/strict";
import test from "node:test";

import {
  ComposioService,
  type ComposioConfig
} from "./composio-service.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
  });
}

function createService(fetchImpl: typeof fetch, overrides: Partial<ComposioConfig> = {}): ComposioService {
  return new ComposioService({
    apiKey: "test-key",
    fetchImpl,
    ...overrides
  });
}

test("createConnectLink finds existing auth config and creates link", async () => {
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

  const service = createService(fetchImpl);
  const result = await service.createConnectLink({
    toolkitSlug: "gmail",
    userId: "user-1",
    callbackUrl: "https://example.com/callback"
  });

  assert.deepEqual(result, {
    authConfigId: "authcfg_existing",
    authConfigCreated: false,
    connectedAccountId: "ca_123",
    redirectUrl: "https://auth.composio.dev/connect?token=lt_123",
    expiresAt: "2026-04-01T00:00:00.000Z"
  });
  assert.equal(calls.length, 2);
  assert.match(String(calls[0]?.input), /toolkit_slug=gmail/);
  assert.match(String(calls[0]?.input), /is_composio_managed=true/);
  assert.equal(calls[1]?.init?.method, "POST");
});

test("createConnectLink creates auth config when none exists", async () => {
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
          redirect_url: "https://auth.composio.dev/connect?token=lt_456",
          expires_at: null,
          connected_account_id: "ca_456"
        },
        { status: 201 }
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  const service = createService(fetchImpl);
  const result = await service.createConnectLink({
    toolkitSlug: "gmail",
    userId: "user-2"
  });

  assert.equal(result.authConfigId, "authcfg_created");
  assert.equal(result.authConfigCreated, true);
  assert.equal(result.connectedAccountId, "ca_456");
  assert.equal(result.expiresAt, null);
  assert.equal(calls.length, 3);
});

test("getConnectedAccount returns normalized status, toolkit slug, etc.", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    assert.match(url, /\/api\/v3\/connected_accounts\/ca_100$/);
    return jsonResponse({
      id: "ca_100",
      status: "ACTIVE",
      auth_config: { id: "authcfg_1" },
      toolkit: { slug: "gmail" },
      user_id: "user-1"
    });
  };

  const service = createService(fetchImpl);
  const account = await service.getConnectedAccount("ca_100");

  assert.deepEqual(account, {
    id: "ca_100",
    status: "ACTIVE",
    authConfigId: "authcfg_1",
    toolkitSlug: "gmail",
    userId: "user-1"
  });
});

test("getConnectedAccount normalizes status to uppercase", async () => {
  const fetchImpl: typeof fetch = async () => {
    return jsonResponse({
      id: "ca_101",
      status: "initiated",
      auth_config: null,
      toolkit: null,
      user_id: null
    });
  };

  const service = createService(fetchImpl);
  const account = await service.getConnectedAccount("ca_101");

  assert.equal(account.status, "INITIATED");
  assert.equal(account.authConfigId, null);
  assert.equal(account.toolkitSlug, null);
  assert.equal(account.userId, null);
});

test("proxyRequest returns envelope with data, status, headers", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return jsonResponse({
      data: { emailAddress: "test@gmail.com", messagesTotal: 42 },
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const service = createService(fetchImpl);
  const result = await service.proxyRequest<{ emailAddress: string; messagesTotal: number }>({
    connectedAccountId: "ca_500",
    method: "GET",
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile"
  });

  assert.equal(result.status, 200);
  assert.equal(result.data?.emailAddress, "test@gmail.com");
  assert.equal(result.data?.messagesTotal, 42);
  assert.equal(result.headers["content-type"], "application/json");

  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.input), /\/api\/v3\/tools\/execute\/proxy$/);
  assert.equal(calls[0]?.init?.method, "POST");

  const body = JSON.parse(calls[0]?.init?.body as string);
  assert.equal(body.connected_account_id, "ca_500");
  assert.equal(body.method, "GET");
  assert.equal(body.endpoint, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
  assert.equal(body.body, undefined);
});

test("proxyRequest includes body for POST requests", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return jsonResponse({
      data: { id: "msg_123" },
      status: 200,
      headers: {}
    });
  };

  const service = createService(fetchImpl);
  const result = await service.proxyRequest<{ id: string }>({
    connectedAccountId: "ca_600",
    method: "POST",
    endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    body: { raw: "base64encodedmessage" }
  });

  assert.equal(result.data?.id, "msg_123");
  assert.equal(result.status, 200);

  const body = JSON.parse(calls[0]?.init?.body as string);
  assert.equal(body.method, "POST");
  assert.deepEqual(body.body, { raw: "base64encodedmessage" });
});

test("getAccessToken extracts token from proxy response for google provider", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    // First call: getConnectedAccount
    if (url.includes("/api/v3/connected_accounts/ca_token")) {
      return jsonResponse({
        id: "ca_token",
        status: "ACTIVE",
        auth_config: { id: "authcfg_1" },
        toolkit: { slug: "google" },
        user_id: "user-1"
      });
    }
    // Second call: proxy request to tokeninfo
    if (url.includes("/api/v3/tools/execute/proxy")) {
      return jsonResponse({
        data: { access_token: "ya29.actual-google-token", expires_in: 3600 },
        status: 200,
        headers: {}
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  const service = createService(fetchImpl);
  const result = await service.getAccessToken({
    connectedAccountId: "ca_token",
    provider: "google"
  });

  assert.equal(result.accessToken, "ya29.actual-google-token");
  assert.equal(result.provider, "google");
  assert.equal(result.connectedAccountId, "ca_token");
});

test("getAccessToken extracts token from proxy response for github provider", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/v3/connected_accounts/ca_gh")) {
      return jsonResponse({
        id: "ca_gh",
        status: "ACTIVE",
        auth_config: { id: "authcfg_2" },
        toolkit: { slug: "github" },
        user_id: "user-2"
      });
    }
    if (url.includes("/api/v3/tools/execute/proxy")) {
      return jsonResponse({
        data: { login: "octocat", id: 1 },
        status: 200,
        headers: { authorization: "token ghp_real-github-token" }
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  const service = createService(fetchImpl);
  const result = await service.getAccessToken({
    connectedAccountId: "ca_gh",
    provider: "github"
  });

  assert.equal(result.accessToken, "ghp_real-github-token");
  assert.equal(result.provider, "github");
  assert.equal(result.connectedAccountId, "ca_gh");
});

test("getAccessToken throws when account is not ACTIVE", async () => {
  const fetchImpl: typeof fetch = async () => {
    return jsonResponse({
      id: "ca_inactive",
      status: "INITIATED",
      auth_config: { id: "authcfg_3" },
      toolkit: { slug: "google" },
      user_id: "user-3"
    });
  };

  const service = createService(fetchImpl);
  await assert.rejects(
    () =>
      service.getAccessToken({
        connectedAccountId: "ca_inactive",
        provider: "google"
      }),
    (error: Error) => {
      assert.match(error.message, /not ACTIVE/i);
      return true;
    }
  );
});

test("getAccessToken throws for unsupported provider", async () => {
  const fetchImpl: typeof fetch = async () => {
    return jsonResponse({
      id: "ca_unknown",
      status: "ACTIVE",
      auth_config: { id: "authcfg_4" },
      toolkit: { slug: "unknown" },
      user_id: "user-4"
    });
  };

  const service = createService(fetchImpl);
  await assert.rejects(
    () =>
      service.getAccessToken({
        connectedAccountId: "ca_unknown",
        provider: "unsupported_provider"
      }),
    (error: Error) => {
      assert.match(error.message, /unsupported provider/i);
      return true;
    }
  );
});
