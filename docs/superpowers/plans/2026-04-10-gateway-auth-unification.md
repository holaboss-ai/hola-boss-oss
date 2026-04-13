# Gateway Auth Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Desktop → Gateway authentication via Better Auth session cookies, replacing the insecure `holaboss_user_id` body-field pattern with a trusted `X-Holaboss-User-Id` header injected by the Gateway after session validation.

**Architecture:** The Hono Gateway already resolves Better Auth sessions for RPC routes but explicitly skips `/gateway/*`. We remove that skip, resolve sessions on all gateway routes, and split behavior into public (no session required) and authenticated (session required, user ID extracted and forwarded). The Desktop sends its existing Better Auth cookie; the Backend trusts the gateway-injected header.

**Tech Stack:** Hono (Cloudflare Worker), Better Auth, Electron main process `fetch()`

---

## Public vs Authenticated Endpoint Classification

### Desktop-Used Endpoints (via `requestControlPlaneJson` or direct `fetch`)

**PUBLIC — no user identity needed:**

| Method | Path | Desktop Function |
|--------|------|------------------|
| GET | `/api/v1/marketplace/templates` | `listMarketplaceTemplates()` |
| GET | `/api/v1/marketplace/app-templates` | `listAppTemplatesViaControlPlane()` |
| POST | `/api/v1/marketplace/generate-template-content` | `workspace:generateTemplateContent` IPC |

**AUTHENTICATED — user identity required:**

| Method | Path | Desktop Function | Currently passes user via |
|--------|------|------------------|--------------------------|
| POST | `/api/v1/marketplace/templates/materialize` | `materializeMarketplaceTemplate()` | `holaboss_user_id` in body |
| POST | `/api/v1/marketplace/submissions/create` | `workspace:createSubmission` IPC | `holaboss_user_id` in body |
| POST | `/api/v1/marketplace/submissions/{id}/finalize` | `workspace:finalizeSubmission` IPC | `holaboss_user_id` in body |
| GET | `/api/v1/marketplace/submissions` | `workspace:listSubmissions` IPC | `author_id` in query |
| DELETE | `/api/v1/marketplace/submissions/{id}` | `workspace:deleteSubmission` IPC | `author_id` in query |
| POST | `/api/v1/proactive/ingest` | `ingestWorkspaceHeartbeat()` | `holaboss_user_id` in event payload |
| POST | `/api/v1/proactive/preferences/task-proposals` | `setProactiveTaskProposalPreference()` | `holaboss_user_id` in body |
| GET | `/api/v1/proactive/preferences/task-proposals` | `getProactiveTaskProposalPreference()` | `holaboss_user_id` in query |
| POST | `/api/v1/proactive/heartbeat-cronjobs/current/workspaces/sync` | heartbeat sync | `holaboss_user_id` in body |
| POST | `/api/v1/proactive/heartbeat-cronjobs/current` | heartbeat config update | `holaboss_user_id` in body |
| POST | `/api/v1/proactive/heartbeat-cronjobs/current/workspaces/{id}` | workspace heartbeat update | `holaboss_user_id` in body |

### Backend-Only Endpoints (not called by Desktop, but routed through Gateway from web frontend)

These also benefit from the auth change but are not in scope for Desktop-side modifications:

- `DELETE /api/v1/projects/workspaces/{id}` — currently called by Desktop but with no user identity
- All `/api/v1/agent-sessions/*` — called by web frontend via gateway
- All `/api/v1/task-proposals/*`, `/api/v1/cronjobs/*`, `/api/v1/outputs/*` — web frontend

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/apps/server/src/api/gateway.ts` | Modify | Add session resolution middleware, public path allowlist, inject `X-Holaboss-User-Id` header |
| `frontend/apps/server/src/index.ts` | Modify | Remove the gateway skip in auth middleware (lines 83-88) |
| `holaOS/desktop/electron/main.ts` | Modify | Send cookie in `controlPlaneHeaders()`, remove manual `holaboss_user_id` from request bodies |

**Not in scope (Phase 2):** Backend Python services reading `X-Holaboss-User-Id` header instead of body params. For now, the Desktop still sends `holaboss_user_id` in bodies as a fallback while the Backend is migrated.

---

### Task 1: Gateway — Add public path allowlist and auth middleware

**Files:**
- Modify: `frontend/apps/server/src/api/gateway.ts`
- Modify: `frontend/apps/server/src/index.ts`

- [ ] **Step 1: Remove the gateway auth skip in index.ts**

In `frontend/apps/server/src/index.ts`, replace the gateway skip block:

```typescript
// Before (lines 82-88):
app.use("*", async (c, next) => {
  // Skip auth session resolution for gateway proxy requests — they use x-api-key, not cookies
  if (c.req.path.startsWith("/gateway/")) {
    c.set("user", null);
    c.set("session", null);
    return next();
  }

  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  // ...
});

// After:
app.use("*", async (c, next) => {
  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    c.set("user", null);
    c.set("session", null);
    return next();
  }

  c.set("user", session.user as any);
  c.set("session", session.session as any);
  return next();
});
```

This makes session resolution run for ALL routes including gateway. Session is optional — null is fine for public endpoints.

- [ ] **Step 2: Add public path allowlist to gateway.ts**

At the top of `frontend/apps/server/src/api/gateway.ts`, add:

```typescript
/**
 * Gateway paths that do not require a Better Auth session.
 * Format: "METHOD:service/path" — matched against the gateway route params.
 * All other gateway paths require an authenticated session.
 */
const PUBLIC_GATEWAY_PATHS: Array<{ method: string; service: string; pattern: RegExp }> = [
  // Marketplace: browse templates and app templates
  { method: "GET", service: "marketplace", pattern: /^api\/v1\/marketplace\/templates$/ },
  { method: "GET", service: "marketplace", pattern: /^api\/v1\/marketplace\/app-templates$/ },
  // Marketplace: AI-generate onboarding/readme content (no user identity needed)
  { method: "POST", service: "marketplace", pattern: /^api\/v1\/marketplace\/generate-template-content$/ },
  // Health checks
  { method: "GET", service: "marketplace", pattern: /^api\/v1\/health$/ },
  { method: "GET", service: "marketplace", pattern: /^api\/v1\/marketplace\/templates$/ },
  { method: "GET", service: "projects", pattern: /^api\/v1\/health$/ },
  { method: "GET", service: "proactive", pattern: /^api\/v1\/proactive\/health$/ },
];

function isPublicGatewayPath(method: string, service: string, path: string): boolean {
  return PUBLIC_GATEWAY_PATHS.some(
    (rule) => rule.method === method && rule.service === service && rule.pattern.test(path)
  );
}
```

- [ ] **Step 3: Add auth gate to the universal proxy handler**

In the `gatewayRouter.all("/:service/:rest{.+}", ...)` handler, add the auth check before proxying:

```typescript
gatewayRouter.all("/:service/:rest{.+}", async (c) => {
  const services = getServices(c.env as any);
  const serviceName = c.req.param("service");
  const path = c.req.param("rest");

  if (!services[serviceName]) {
    logger.warn({ service: serviceName }, "Unknown service requested");
    return c.json({ error: "Service not found" }, 404);
  }

  // --- NEW: Auth gate ---
  const user = c.get("user") as { id: string } | null;
  const method = c.req.method.toUpperCase();

  if (!user && !isPublicGatewayPath(method, serviceName, path)) {
    return c.json({ error: "Authentication required" }, 401);
  }
  // --- END NEW ---

  const targetUrl = services[serviceName].url;
  const fullPath = path ? `/${path}` : "";
  const url = new URL(c.req.url);
  const queryString = url.search;
  const fullTargetUrl = `${targetUrl}${fullPath}${queryString}`;

  const appendHeaders: Record<string, string> = {};
  const serviceApiKey = c.env.AGENT_SERVICE_API_KEY;
  if (
    serviceApiKey &&
    ["tasks", "agent", "growth", "sandbox", "marketplace", "cronjobs", "projects", "proactive"].includes(serviceName)
  ) {
    appendHeaders["x-api-key"] = serviceApiKey;
  }

  // --- NEW: Inject trusted user identity header ---
  if (user) {
    appendHeaders["x-holaboss-user-id"] = user.id;
  }
  // --- END NEW ---

  return await customProxy(c, fullTargetUrl, serviceName, {
    timeoutMs: 120_000,
    retry: 1,
    keepClientHost: false,
    appendHeaders,
    onLog: (lvl, msg, meta) => {
      if (lvl === "error") logger.error(meta, msg);
      else if (lvl === "warn") logger.warn(meta, msg);
      else if (lvl === "info") logger.info(meta, msg);
      else logger.debug(meta, msg);
    },
  });
});
```

- [ ] **Step 4: Also handle the health check status endpoint**

The gateway status endpoint at `/gateway/status` and `/gateway/` should remain public. These are handled by separate routes in gateway.ts and don't go through the `/:service/:rest{.+}` handler, so they are unaffected. Verify this by checking the route order — status routes are defined before the universal proxy handler.

- [ ] **Step 5: Commit**

```bash
git add frontend/apps/server/src/index.ts frontend/apps/server/src/api/gateway.ts
git commit -m "feat(gateway): add session-based auth gate with public path allowlist

Resolve Better Auth session on all routes including /gateway/*.
Public endpoints (template browsing, health checks) pass without session.
Authenticated endpoints require a valid session; the gateway injects
X-Holaboss-User-Id header with the verified user ID before proxying."
```

---

### Task 2: Desktop — Send cookie in gateway requests

**Files:**
- Modify: `holaOS/desktop/electron/main.ts`

- [ ] **Step 1: Update controlPlaneHeaders to include auth cookie**

Find the `controlPlaneHeaders` function (around line 6155) and add cookie:

```typescript
async function controlPlaneHeaders(
  _service: "projects" | "marketplace" | "proactive",
  extraHeaders?: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  // Send Better Auth session cookie so the Hono gateway can resolve
  // the user identity. Main-process fetch is not subject to browser
  // CORS — the earlier "no Cookie" comment was about renderer-process
  // constraints that don't apply here.
  const cookie = authCookieHeader();
  if (cookie) {
    headers["Cookie"] = cookie;
  }
  return headers;
}
```

- [ ] **Step 2: Verify authCookieHeader is accessible**

Check that `authCookieHeader()` is defined and accessible from the `controlPlaneHeaders` scope. It's already used by `getAuthenticatedUser()` and `billingFetch()` in the same file. No import needed.

- [ ] **Step 3: Commit**

```bash
git add holaOS/desktop/electron/main.ts
git commit -m "feat(desktop): send Better Auth cookie in gateway requests

controlPlaneHeaders now includes the session cookie so the Hono
gateway can resolve user identity from the session instead of relying
on holaboss_user_id in request bodies."
```

---

### Task 3: Desktop — Remove manual holaboss_user_id from marketplace requests

**Files:**
- Modify: `holaOS/desktop/electron/main.ts`

Now that the gateway injects `X-Holaboss-User-Id`, the Desktop no longer needs to pass `holaboss_user_id` in request bodies. However, the Backend still reads it from bodies (migration is Phase 2), so we keep the field for backward compatibility but source it from the gateway header on the Backend side.

**For Phase 1, this task is SKIP — keep sending `holaboss_user_id` in bodies as-is.** The gateway now sends BOTH the trusted header AND the body still has the user ID. No Desktop changes needed beyond Task 2.

This is intentional: it allows the Backend to be migrated gradually (read header first, fall back to body) without a coordinated deploy.

- [ ] **Step 1: Document the migration path**

Add a comment in `controlPlaneHeaders`:

```typescript
  // TODO(phase-2): Once the Python backend reads X-Holaboss-User-Id
  // from the gateway-injected header, remove holaboss_user_id from
  // request bodies in requestControlPlaneJson callers.
```

- [ ] **Step 2: Commit**

```bash
git add holaOS/desktop/electron/main.ts
git commit -m "docs(desktop): note phase-2 migration for holaboss_user_id removal"
```

---

### Task 4: Gateway — Update custom-proxy to pass cookie through

**Files:**
- Modify: `frontend/apps/server/src/utils/custom-proxy.ts`

The `customProxy` function has a `passThroughHeaders` allowlist. Currently it includes `cookie` — verify this is the case and that the cookie from the Desktop will be forwarded to the Backend if needed.

- [ ] **Step 1: Verify cookie passthrough in custom-proxy**

Check line 52-59 of `custom-proxy.ts`:

```typescript
passThroughHeaders = [
  "authorization",
  "content-type",
  "cookie",       // ← already here
  "accept",
  "x-request-id",
],
```

`cookie` is already in the allowlist. However, for the gateway auth flow, the Backend does NOT need the cookie — it gets user identity via `X-Holaboss-User-Id` header. The cookie passthrough is harmless but not required.

- [ ] **Step 2: No changes needed — verify only**

The cookie passthrough already works. The Backend's existing `verify_api_key` middleware checks `x-api-key`, not cookies. No conflict.

- [ ] **Step 3: Commit (if any test/doc changes)**

No commit needed if no changes.

---

### Task 5: Test the full auth flow

- [ ] **Step 1: Test public endpoint without cookie**

```bash
# Should return 200 — public endpoint
curl -s -o /dev/null -w "%{http_code}" \
  "https://api.imerchstaging.com/gateway/marketplace/api/v1/marketplace/templates"
```

Expected: `200`

- [ ] **Step 2: Test authenticated endpoint without cookie**

```bash
# Should return 401 — no session
curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}' \
  "https://api.imerchstaging.com/gateway/marketplace/api/v1/marketplace/submissions/create"
```

Expected: `401`

- [ ] **Step 3: Test authenticated endpoint with cookie from Desktop**

Run the Desktop app, trigger the publish flow. The `workspace:createSubmission` IPC should now succeed because `controlPlaneHeaders` sends the cookie, the gateway resolves the session, and injects `X-Holaboss-User-Id`.

- [ ] **Step 4: Verify gateway status page still works**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "https://api.imerchstaging.com/gateway/status"
```

Expected: `200` (status routes are separate from the proxy handler)

- [ ] **Step 5: Deploy gateway to staging**

```bash
cd frontend
bun run deploy:staging
```

- [ ] **Step 6: Commit any test/fix adjustments**

```bash
git add -A
git commit -m "test: verify gateway auth flow end-to-end"
```

---

### Task 6: Desktop — Prompt sign-in on gateway 401

**Files:**
- Modify: `holaOS/desktop/electron/main.ts`

When `requestControlPlaneJson` gets a 401 from the gateway, it means the session cookie is missing or expired. Instead of throwing a generic error, we should:
1. Open the auth sign-in popup
2. Wait for authentication to complete
3. Retry the original request once

- [ ] **Step 1: Add auth-retry logic in requestControlPlaneJson**

In `requestControlPlaneJson`, after the existing `maybeRetryRuntimeBinding` block and before the final `!response.ok` throw, add a 401 handler:

```typescript
  let response = await executeRequest();
  let errorDetail = "";
  if (!response.ok) {
    errorDetail = await readControlPlaneError(response);
    const retried = await maybeRetryRuntimeBinding(
      response.status,
      errorDetail,
    ).catch(() => false);
    if (retried) {
      response = await executeRequest();
      errorDetail = "";
    }
  }

  // --- NEW: On 401, prompt sign-in and retry once ---
  if (response.status === 401 && desktopAuthClient) {
    try {
      await requireAuthClient().requestAuth();
      // Auth popup completed — retry with fresh cookie
      response = await executeRequest();
      errorDetail = "";
    } catch {
      // User dismissed sign-in or auth failed — fall through to error
    }
  }
  // --- END NEW ---

  if (!response.ok) {
    throw new Error(errorDetail || (await readControlPlaneError(response)));
  }
```

`requestAuth()` opens the Better Auth sign-in popup and returns a promise that resolves when the user completes sign-in. If the user dismisses the popup, it rejects and we fall through to the normal error.

- [ ] **Step 2: Prevent concurrent sign-in prompts**

If multiple requests fail with 401 at the same time, we don't want to open multiple sign-in popups. Add a module-level deduplication lock:

```typescript
let pendingAuthRetry: Promise<void> | null = null;

// Inside requestControlPlaneJson, replace the 401 block:
if (response.status === 401 && desktopAuthClient) {
  try {
    if (!pendingAuthRetry) {
      pendingAuthRetry = requireAuthClient().requestAuth().finally(() => {
        pendingAuthRetry = null;
      });
    }
    await pendingAuthRetry;
    response = await executeRequest();
    errorDetail = "";
  } catch {
    // User dismissed sign-in or auth failed
  }
}
```

This way, if 3 requests all get 401, only one sign-in popup opens. All three wait for it, then all three retry.

- [ ] **Step 3: Commit**

```bash
git add holaOS/desktop/electron/main.ts
git commit -m "feat(desktop): prompt sign-in and retry on gateway 401

When a gateway request returns 401 (session expired or missing),
open the Better Auth sign-in popup. Once the user completes sign-in,
retry the original request with the fresh cookie. Concurrent 401s
are deduplicated to a single sign-in prompt."
```

---

## Phase 2 (Future, Not This PR)

Once the gateway auth is live and stable:

1. **Backend**: Read `X-Holaboss-User-Id` header in Python routes, fall back to body `holaboss_user_id`
2. **Desktop**: Remove `holaboss_user_id` from all `requestControlPlaneJson` payloads
3. **Backend**: Remove body `holaboss_user_id` support entirely
4. **Env cleanup**: Consolidate `HOLABOSS_PROJECTS_URL` / `HOLABOSS_MARKETPLACE_URL` / `HOLABOSS_PROACTIVE_URL` into a single `HOLABOSS_AGENT_API_URL` since they're all the same host with different path prefixes
