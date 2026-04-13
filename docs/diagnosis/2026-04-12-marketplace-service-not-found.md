# Diagnosis: `workspace:listMarketplaceTemplates` — "Service not found"

**Date:** 2026-04-12
**Severity:** Medium (non-fatal, but blocks marketplace UI on every page load)
**Affected flow:** Marketplace template listing, app template listing

## Symptom

On desktop startup (dev or packaged), the following error repeats in the
Electron main-process console:

```
Error occurred in handler for 'workspace:listMarketplaceTemplates': Error: {"error":"Service not found"}
    at requestControlPlaneJson (…/main.cjs:4863:11)
```

The error fires multiple times because the renderer retries the IPC call.

## Root cause

When `HOLABOSS_AUTH_BASE_URL` is set (currently `https://api.holaboss.ai`),
`marketplaceBaseUrl()` resolves to `https://api.holaboss.ai/gateway/marketplace`
instead of hitting the backend host directly.

```
desktop/electron/main.ts:6388-6391

function marketplaceBaseUrl() {
  return AUTH_BASE_URL
    ? gatewayBaseUrl("marketplace")          // <-- takes this path
    : DEFAULT_MARKETPLACE_URL.replace(/\/+$/, "");
}
```

The `listMarketplaceTemplates` function (line 6815) first attempts an
unauthenticated fetch to the gateway URL. When the gateway returns a non-OK
response, it falls through to the authenticated `requestControlPlaneJson` path,
which hits the same gateway URL and receives `{"error":"Service not found"}`.

### Verification

| Endpoint | Status | Response |
|---|---|---|
| `https://api.holaboss.ai/gateway/marketplace/api/v1/marketplace/templates` | **404** | `{"error":"Service not found"}` |
| `http://35.160.37.189:3037/api/v1/marketplace/templates` (direct) | **401** | `{"detail":"Invalid or missing API key"}` |
| `http://35.160.37.189:3033` (projects, direct) | 404 | reachable |
| `http://35.160.37.189:3060` (control plane, direct) | 404 | reachable |
| `http://35.160.37.189:3032` (proactive, direct) | 404 | reachable |

The marketplace service **is running** on the backend host at port 3037, but the
API gateway at `api.holaboss.ai` does not have a `marketplace` route registered.

## URL resolution logic

`desktop/electron/main.ts` resolves the marketplace URL in this priority order
(line 2516-2520):

1. `HOLABOSS_MARKETPLACE_URL` env var (internal dev override) — **not set**
2. `packagedDesktopConfig.marketplaceUrl` — **empty**
3. `serviceBaseUrlFromControlPlane(DESKTOP_CONTROL_PLANE_BASE_URL, 3037)` — would
   resolve to `http://35.160.37.189:3037`

However, none of these are consulted at runtime because `AUTH_BASE_URL` is set,
so `marketplaceBaseUrl()` unconditionally returns the gateway URL.

The same pattern applies to `projectsBaseUrl()` and `proactiveBaseUrl()` — any
service not registered on the gateway will fail the same way.

## Recommended fixes

### Option A: Register the marketplace service on the gateway (preferred)

Add a `marketplace` route to the API gateway at `api.holaboss.ai` that proxies
to the marketplace service at `35.160.37.189:3037`. This is the intended
production architecture since `AUTH_BASE_URL` is set.

### Option B: Set an explicit marketplace URL override

Add to `desktop/.env`:

```
HOLABOSS_MARKETPLACE_URL=http://35.160.37.189:3037
```

This uses the `internalOverride` path (line 2517) and bypasses the gateway
routing. Suitable as a short-term workaround for local development.

### Option C: Fall through to direct URL when gateway returns "Service not found"

Modify `listMarketplaceTemplates()` and the gateway-aware base URL functions to
fall back to `DEFAULT_MARKETPLACE_URL` when the gateway returns a 404 with
`"Service not found"`. This adds resilience but masks gateway misconfiguration.

## Related code paths

- `marketplaceBaseUrl()` — `desktop/electron/main.ts:6388`
- `gatewayBaseUrl()` — `desktop/electron/main.ts:6378`
- `requestControlPlaneJson()` — `desktop/electron/main.ts:6505`
- `listMarketplaceTemplates()` — `desktop/electron/main.ts:6815`
- `listAppTemplatesViaControlPlane()` — `desktop/electron/main.ts:6846`
- `DEFAULT_MARKETPLACE_URL` resolution — `desktop/electron/main.ts:2516`
