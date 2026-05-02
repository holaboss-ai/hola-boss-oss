---
title: Composio Triggers — Inbound Event Pipeline
date: 2026-05-01
updated: 2026-05-02
status: draft
phase: foundation
related:
  - 2026-04-30-workspace-data-layer-tier2.md
  - 2026-03-31-composio-app-runtime-design.md
---

> **Update 2026-05-02:** revised after verifying Composio's official V3 docs.
> Three substantive changes: V3 payload echoes `metadata.user_id`, so we don't
> need a connection→user reverse lookup on the hot path; `triggers.create()`
> doesn't accept a callback URL (it's webhook-subscription-level); Gmail
> `labelIds` is a single string, not an array. Fixed throughout below.

# Composio Triggers — Inbound Event Pipeline

## 1. Why this exists

Modules today are **outbound-only** with respect to third-party platforms. Apollo, Gmail, LinkedIn, Reddit, etc. all proxy *outbound* HTTP through `@holaboss/bridge → broker → Composio → upstream`. Anything that requires reacting to an *inbound* event (a new email, a GitHub push, a HubSpot deal moving stages, a Slack DM) currently has only one tool: **mirror sync polling**. PR #8 shipped that pattern for apollo / instantly / gmail / attio / hubspot — a 15-minute scheduler hitting the upstream API and writing into workspace `data.db`.

That works for "the agent reviews changes once an hour" but it doesn't work for "the moment a warm lead replies, surface it." The product story behind the morning-briefing dashboard implies *push* not *pull*: the agent should know within seconds that Sarah Chen replied, not on the next 15-min tick.

Composio already has the right primitive: **triggers**. They normalize platform webhooks (GitHub, Slack) and platform polling (Gmail, Calendar) into a single signed `POST` to a configured callback URL. We don't subscribe to platforms — we subscribe to Composio. The integration is uniform across providers.

The cost: Composio offers **one project-level webhook URL** (one webhook subscription per Composio project), not per-tenant. Fan-out to the right user's sandbox is on us. The V3 payload format helps — Composio echoes back `metadata.user_id` (the same user_id we passed when creating the connection), so the fan-out lookup is just `payload.metadata.user_id` once HMAC is verified.

## 2. Goals (Phase 1 scope)

1. **Hono webhook endpoint** at `apps/server/src/api/webhooks/composio.ts` that verifies Composio HMAC (Standard Webhooks / Svix algorithm), deduplicates by `webhook-id`, extracts `user_id` directly from the V3 `metadata`, and forwards to the Python ingest endpoint within ~1s.
2. **`ComposioConnection` Prisma model** for account management and cascade-cleanup on user delete. **Not** used as a hot-path lookup — the V3 payload's `metadata.user_id` (HMAC-verified) is the routing key. The table exists so we can list a user's connected toolkits in the UI and tear down associated triggers when the user disconnects.
3. **Python ingest endpoint** at `POST /api/v1/triggers/dispatch` (service-key auth) that enqueues a `trigger_event` job onto the existing session-worker queue.
4. **Session worker support** for `trigger_event` jobs — claims, resolves the user's sandbox, calls the in-sandbox runtime.
5. **In-sandbox runtime endpoint** `POST /api/v1/triggers/incoming` that routes to the module declared as the trigger handler.
6. **Declarative `triggers:` block** in `app.runtime.yaml` (mirrors the Tier 2 `data_schema:` block) — at app install, runtime calls Composio's `triggers.create({ slug, user_id, trigger_config })`; at app uninstall, calls `triggers.delete(trigger_id)`. The webhook URL is **not** set per trigger — it's project-wide, configured once via the Webhook Subscriptions API.
7. **One-time webhook subscription setup** — call `POST /api/v3/webhook_subscriptions` once per environment (preview / prod) with our Hono URL. Persist the returned signing `secret` as `COMPOSIO_WEBHOOK_SECRET`.
8. **Pilot:** Gmail `GMAIL_NEW_GMAIL_MESSAGE` end-to-end. Chosen over HubSpot because (a) the morning-briefing dashboard story is already gmail-shaped, (b) Composio's Gmail trigger has the richest config surface (`labelIds`, `query`) so we exercise the trigger config plumbing properly even on the pilot, (c) it's a polling-backed trigger which is the harder path of the two (native-webhook providers like HubSpot are simpler — once polling works, native webhook is a no-op).

## 3. Non-goals (deferred to Phase 2+)

- **Agent rules** — `workspace.yaml`-level "when this trigger fires, run this prompt template" — phase 2.
- **Composio-doesn't-support-this-platform fallback polling** — apollo / instantly / attio / cal.com / zoominfo stay on mirror-sync. Out of scope.
- **Replay buffer / DLQ** — phase 3.
- **Trigger health dashboard** — phase 3 (drop-in `.dashboard` file).
- **Migrating mirror-sync apps to triggers** — even where Composio supports them, mirror-sync is fine for the existing use cases. Triggers are additive, not a replacement.
- **Per-environment webhook URLs** (staging vs prod) — Composio gives one project; we'll create a separate Composio project per environment if needed.

## 4. System shape

```
                                                                ┌── retries via Composio
                                                                │
 Third party platform                                            ▼
   ─── poll/webhook ──→  Composio  ─── HMAC POST ───→  Hono /api/webhooks/composio
                                                                │
                                                                │ verify HMAC (Standard Webhooks)
                                                                │ dedupe by webhook-id (KV)
                                                                │ user_id = payload.metadata.user_id
                                                                │ (HMAC has already authenticated this)
                                                                │
                                                                ▼
                                              POST  Python /api/v1/triggers/dispatch
                                              (X-Service-Key auth)
                                                                │
                                                                │ enqueue trigger_event job
                                                                ▼
                                                  Session Worker (existing)
                                                                │
                                                                │ resolve user → sandbox
                                                                │ via sandbox-runtime provider
                                                                ▼
                                              POST  in-sandbox runtime :8080
                                              /api/v1/triggers/incoming
                                                                │
                                                                │ load workspace.yaml
                                                                │ resolve trigger_slug → app + handler path
                                                                ▼
                                              POST  module's declared handler
                                              e.g.  http://app:18080/api/triggers/new-message
```

Three new HTTP endpoints, one new Prisma table (account-management only, off the hot path), one new queue job type, one new YAML block. Everything else reuses existing pipes.

### V3 payload shape (verified 2026-05-02)

```json
{
  "id": "msg_abc123",
  "type": "composio.trigger.message",
  "timestamp": "2026-05-02T10:30:00Z",
  "metadata": {
    "log_id": "log_abc123",
    "trigger_slug": "GMAIL_NEW_GMAIL_MESSAGE",
    "trigger_id": "ti_xyz789",
    "connected_account_id": "ca_def456",
    "auth_config_id": "ac_xyz789",
    "user_id": "<echoed back from connection creation>"
  },
  "data": { ...toolkit-specific... }
}
```

Critical: `metadata.user_id` is whatever string we passed as `user_id` when creating the Composio `connectedAccount`. **Pass our Holaboss user_id at connect time** and we get free routing here.

Also: V3 renames the V2 `connection_id` field to `connected_account_id` in `metadata`. Use `connected_account_id` consistently.

## 5. Pieces to build

### 5.1 Hono — webhook receiver

**File:** `apps/server/src/api/webhooks/composio.ts` (new), mirrors the structure of `apps/server/src/api/webhooks.ts` (Stripe).

**Behavior:**

1. `await c.req.text()` — raw body for HMAC verify.
2. Parse `webhook-signature` (`v1,<base64>`), `webhook-id`, `webhook-timestamp`.
3. Verify HMAC: signing string = `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 with `COMPOSIO_WEBHOOK_SECRET`, base64-encode, `timingSafeEqual` against the `v1,<base64>` portion of `webhook-signature`. (`COMPOSIO_WEBHOOK_SECRET` is the secret returned once when we create the webhook subscription — see §5.7.)
4. Reject if `now - timestamp > 300` (Standard Webhooks default tolerance).
5. KV-dedup by `webhook-id` with TTL 24h (same pattern as Stripe at `webhooks.ts:78–99`).
6. Parse the V3 payload. Extract from `metadata`: `trigger_slug`, `trigger_id`, `connected_account_id`, `user_id`. Extract `data`.
7. **`user_id` is taken directly from `payload.metadata.user_id`.** HMAC verification + Composio's at-source authentication mean the payload is trusted; the user_id is the same value we passed when creating the Composio connectedAccount, so no DB lookup is needed for routing.
8. POST to Python `/api/v1/triggers/dispatch` with `X-Service-Key` header — fire-and-forget with a 2s timeout. Don't block the 200 to Composio on Python's response (Composio retries are unforgiving).
9. Return 200.

**Mounted at:** `apps/server/src/index.ts` next to existing webhook routes.

**Why no `ComposioConnection` lookup on the hot path:** with V2 payloads, `connection_id` was the only useful field — you had to map it to a user. V3 fixed this by echoing `metadata.user_id` (whatever we passed at connect time). We still keep a `ComposioConnection` table (§5.2), but only for account management surfaces, not for routing.

### 5.2 Prisma — `ComposioConnection`

**File:** `packages/db/prisma/schema.prisma`

**Purpose:** account-management metadata only. Lets us list a user's connected toolkits in the UI, drive an "active triggers" view, and cascade Composio cleanup when a user disconnects or deletes their account. **Not on the webhook hot path** — V3 `metadata.user_id` is the routing key.

```prisma
model ComposioConnection {
  id                  String   @id @default(cuid())
  userId              String
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  toolkit             String                       // "gmail", "github", "hubspot", ...
  connectedAccountId  String   @unique             // Composio's connected_account_id (V3)
  status              String                       // "active" / "revoked" / "error"
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  deletedAt           DateTime?

  @@index([userId, toolkit])
}
```

**Write path:** populated on the existing Composio connect-success flow in `apps/server/src/api/composio.ts`. Today the route reads connections back via the Composio API on demand; we add an `upsert` after a successful connection callback. Existing `composioHeaders()` helper stays as-is.

**Critical invariant:** when we create a Composio connection, we must pass our Holaboss `userId` as the Composio `user_id`. That single contract is what makes V3 webhook routing safe without a DB lookup. Verify the existing `composio.ts` connect flow does this — if it generates a synthetic Composio user_id instead, fix that **first**.

**Backfill not required for routing.** A one-shot reconcile script can seed the table for the UI surface, but it's not blocking — the hot path doesn't read it.

### 5.3 Python — `/api/v1/triggers/dispatch`

**Service:** `holaboss-projects` (`backend/src/api/v1/triggers/`). New router.

**Auth:** `X-Service-Key` header, validated against `INTERNAL_SERVICE_KEY` env var. The existing `Hono → Python` gateway proxy already shapes this pattern (`AGENT_SERVICE_API_KEY`); we add a separate key for the trigger dispatch path so a Hono compromise doesn't grant queue-enqueue rights generally.

**Body:**
```json
{
  "user_id": "u_abc",
  "connected_account_id": "ca_xyz",
  "toolkit": "gmail",
  "trigger_slug": "GMAIL_NEW_GMAIL_MESSAGE",
  "trigger_id": "ti_123",
  "webhook_id": "wh_...",
  "received_at": "2026-05-02T...",
  "data": { ... toolkit-specific ... }
}
```

**Behavior:** enqueue a `trigger_event` job onto the session-worker queue (same Redis/Postgres queue chat messages use today). Idempotency key = `webhook_id` so re-dispatches dedupe at the queue level too.

### 5.4 Session worker — `trigger_event` job type

**File:** `backend/src/services/session_worker/`. Add a `trigger_event` claim handler alongside the existing chat-claim path.

**Behavior:**

1. Resolve the user's sandbox via `sandbox-runtime` (existing `_sandbox_agent_json_request` infrastructure).
2. POST to `http://<sandbox>:8080/api/v1/triggers/incoming` with the dispatch payload.
3. Log outcome (`success` / `not_found` / `handler_error` / `timeout`) with structured fields. Idempotency by `webhook_id`.
4. **Backoff and retry on transient failure** (sandbox not ready, runtime returns 503) — bounded retries (3 with exponential backoff). Permanent failures (no handler registered, 4xx) drop the job.

### 5.5 In-sandbox runtime — `/api/v1/triggers/incoming`

**File:** `runtime/api-server/src/triggers.ts` (new).

**Behavior:**

1. Read `workspace/<id>/workspace.yaml` to find the apps installed.
2. Look up which app declared `trigger_slug` in its `triggers:` block.
3. Resolve the app's web port from the runtime state store.
4. POST to `http://localhost:<app-port><handler-path>` with the dispatch payload's `data` field plus a small envelope (`trigger_slug`, `trigger_id`, `received_at`).
5. Module owns its handler logic; runtime just routes.

**Failure modes:**
- No app declares this slug → 200 + log + drop. (Could happen during uninstall race.)
- Handler 5xx → 503 back to session worker, which retries.
- Handler 4xx → 4xx back, no retry (user-error class).

### 5.6 Module side — declarative `triggers:` in `app.runtime.yaml`

**Pattern:** same shape as Tier 2 `data_schema:`. The runtime owns lifecycle.

```yaml
# gmail/app.runtime.yaml
triggers:
  - slug: GMAIL_NEW_GMAIL_MESSAGE
    handler: /api/triggers/new-message
    config:
      labelIds: INBOX            # single string per Composio docs
      interval: 1                # minutes
  - slug: GMAIL_EMAIL_SENT_TRIGGER
    handler: /api/triggers/email-sent
    config: {}
```

> Gmail's `labelIds` is a **single label string**, not an array. For multi-label
> filtering, use `query` (full Gmail search syntax) instead.

**Lifecycle hooks** (new in `runtime/api-server/src/apply-app-triggers.ts`):

- **Install:** for each declared trigger, call broker `triggers.create({ slug, user_id, trigger_config })`. The Composio SDK signature has no `callbackUrl` parameter — webhook delivery is project-wide, configured via webhook subscriptions (§5.7). Persist the returned `trigger_id` to a new `_app_trigger_subscriptions` table in `data.db` (mirrors `_app_schema_versions`).
- **Uninstall:** read `_app_trigger_subscriptions` for this app, call broker `triggers.delete(trigger_id)` for each.
- **App version bump:** diff declared triggers against subscribed → reconcile (create new, delete removed). Config-only changes are delete-then-recreate (Composio offers no `update`); a brief gap window is acceptable for v1.

**Handler authoring (module side):** implementing a handler is just adding a TanStack Start route at `src/routes/api/triggers/<name>.ts` and writing whatever logic. Module decides whether to (a) write to `data.db`, (b) enqueue an internal job, (c) call back into the agent — out of scope for the runtime.

### 5.7 Webhook subscription — one-time setup per environment

Composio's webhook URL is set via the **Webhook Subscriptions API**, not a dashboard:

```
POST /api/v3/webhook_subscriptions
{
  "webhook_url": "https://api.holaboss.ai/api/webhooks/composio",
  "enabled_events": ["composio.trigger.message"],
  "version": "V3"
}
```

The response includes the signing `secret` **once** — store as `COMPOSIO_WEBHOOK_SECRET` in Wrangler secrets. To rotate, call `POST /api/v3/webhook_subscriptions/{id}/rotate_secret`.

**Setup script:** `apps/server/scripts/setup-composio-webhook-subscription.ts` — idempotent. Lists existing subscriptions, creates if missing, prints `secret` for the operator to put into `wrangler secret put COMPOSIO_WEBHOOK_SECRET`. Run once per Composio project (preview / prod).

## 6. Security

- **HMAC verification at the Hono edge.** Standard Webhooks / Svix algorithm — signing string `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 with `COMPOSIO_WEBHOOK_SECRET`, base64. Compare with `timingSafeEqual` against the `v1,…` prefix-stripped portion of `webhook-signature`. Reject anything that doesn't pass. Composio's TS SDK has `verifyWebhook()`, but Cloudflare Workers may have issues with Node-only deps — manual verify is ~10 lines, prefer it.
- **Replay tolerance:** 300s. Reject older.
- **Idempotency:** `webhook-id` deduped in KV at Hono and again as the queue idempotency key.
- **Trust boundary:** Hono → Python is an internal call protected by `INTERNAL_SERVICE_KEY` (service-to-service, distinct from `AGENT_SERVICE_API_KEY`). Python → sandbox is the existing trusted path.
- **user_id integrity:** `payload.metadata.user_id` is what we passed at connect time. Because the entire payload is HMAC-signed, an attacker can't forge a different user_id without the secret. The single sensitive contract is the **connect-time invariant**: at the connect callback in `composio.ts`, the Composio `user_id` parameter we send must equal the Holaboss `userId`. Add a unit test pinning this. If that ever drifts, an attacker who compromises another user's Composio account could inject events into a different Holaboss user's sandbox.

## 7. Operational concerns

- **Composio retry behavior unspecified.** Treat delivery as at-least-once with no SLA. KV dedup at Hono + queue idempotency at Python = effective once.
- **Polling triggers consume the user's third-party quota** (Gmail in particular). Default `interval: 1` (minute) for Gmail — don't go lower without thinking.
- **One webhook subscription per Composio project.** Created via the Webhook Subscriptions API (§5.7), not a dashboard. Use a separate Composio project per environment (preview vs prod) so secrets don't co-mingle. Document the setup script + secret-handoff in the runbook.
- **Webhook secret rotation:** `POST /api/v3/webhook_subscriptions/{id}/rotate_secret`, then redeploy with the new `COMPOSIO_WEBHOOK_SECRET`.

## 8. Open questions

1. **Where does the agent fit in?** Phase 1 stops at "module handler runs." Should the module call back into the agent (e.g. via in-sandbox runtime's chat queue), or should triggers also have a separate fast path to the agent for "agent rules"? Leaning toward: module is the event sink; "agent rule" is a thin module that's nothing but a handler that re-prompts the agent. That keeps the contract uniform.
2. ~~**`callbackUrl` per-trigger or global?**~~ **Resolved 2026-05-02:** Composio's `triggers.create()` does **not** accept a callback URL. Webhook delivery is project-wide via webhook subscriptions. Per-trigger routing isn't an option without forking — drop the question.
3. **Trigger config update semantics.** Confirmed Composio offers no `triggers.update()`. Phase 1 does delete+recreate on any config diff. Adds a brief gap window with no events; document as a known limitation. If gap matters in practice, phase 3 can add a "drain + swap" reconciler.
4. **Multiple users in the same workspace.** Today: 1 user → 1 workspace. If that ever changes, the `ComposioConnection.userId` model needs revisiting.
5. **Sandbox-offline replay.** If a user's sandbox isn't running when an event arrives, session-worker retries 3× and drops. For Gmail this means lost emails on a long-offline desktop. Phase 1 ships the drop path; phase 3 adds a DLQ table + replay-on-sandbox-up.
6. **User-delete cleanup.** When a user deletes their account, `ComposioConnection` cascades on the Postgres side, but Composio's connections + triggers don't auto-delete. Need an explicit teardown in the user-delete flow that calls `connections.delete()` + `triggers.delete()` for each row before the cascade fires.
7. **What if Composio doesn't expose a trigger we want?** Out of scope — but worth a paragraph in a follow-up doc on "trigger gap fallback patterns" (mirror sync, manual webhook, etc.).

## 9. Phased plan

### Phase 1 — pilot end-to-end (1 sprint)

- [ ] **Connect-time invariant:** verify `apps/server/src/api/composio.ts` passes Holaboss `userId` as Composio `user_id` on connect; fix if not. Add unit test pinning the contract.
- [ ] One-time `setup-composio-webhook-subscription.ts` run for preview project; capture secret as `COMPOSIO_WEBHOOK_SECRET`.
- [ ] `ComposioConnection` Prisma model + migration + write on connect callback (account-management surface; not on hot path).
- [ ] Hono `/api/webhooks/composio` route — manual HMAC verify, KV dedupe, extract `metadata.user_id` directly, fire-and-forget to Python.
- [ ] Python `/api/v1/triggers/dispatch` router + `INTERNAL_SERVICE_KEY` env.
- [ ] Session worker `trigger_event` claim handler.
- [ ] In-sandbox runtime `/api/v1/triggers/incoming` + workspace.yaml lookup.
- [ ] `app.runtime.yaml` parser extension for `triggers:` block.
- [ ] Runtime install/uninstall lifecycle hooks for `triggers.create({ slug, user_id, trigger_config })` / `triggers.delete(trigger_id)`.
- [ ] Pilot: gmail `GMAIL_NEW_GMAIL_MESSAGE` (`labelIds: INBOX`, `interval: 1`) → handler writes a row into a new `gmail_inbound_events` table.
- [ ] Smoke test: send self an email; row appears in workspace `data.db` within ~90s (1-min poll + dispatch latency).

### Phase 2 — additional providers + agent rules

- [ ] Add HubSpot, GitHub, Slack triggers to their respective module manifests.
- [ ] Workspace-level `agent_rules:` block in `workspace.yaml`: `trigger_slug → prompt_template`.
- [ ] Runtime detects rule matches, enqueues an agent-run job in addition to the module handler.

### Phase 3 — operations

- [ ] Trigger ingestion `.dashboard` (received / dispatched / sandbox-delivered / handler success counts).
- [ ] DLQ for permanent-failure trigger events with manual replay tooling.
- [ ] Trigger config diff/reconcile on `app.runtime.yaml` change (instead of unconditional delete+recreate).
- [ ] Per-user dashboard for "things your agent reacted to today."

## 10. Files this doc implies touching

```
frontend/
├── apps/server/src/api/webhooks/composio.ts                (new)
├── apps/server/src/api/composio.ts                         (audit: confirm Holaboss userId →
│                                                             Composio user_id at connect; write
│                                                             ComposioConnection on connect)
├── apps/server/scripts/setup-composio-webhook-subscription.ts (new, idempotent, run once per env)
├── apps/server/wrangler.jsonc                              (add COMPOSIO_WEBHOOK_SECRET, INTERNAL_SERVICE_KEY)
└── packages/db/prisma/schema.prisma                        (add ComposioConnection — note V3
                                                             field `connectedAccountId`)

backend/
├── src/api/v1/triggers/                                    (new router)
├── src/services/session_worker/                            (extend: trigger_event handler)

holaOS/
├── runtime/api-server/src/triggers.ts                      (new: incoming dispatch endpoint)
├── runtime/api-server/src/apply-app-triggers.ts            (new: install/uninstall lifecycle)
├── runtime/api-server/src/app-lifecycle-worker.ts          (extend: call apply-app-triggers)

hola-boss-apps/
├── gmail/app.runtime.yaml                                  (add triggers: block + data_schema:
│                                                             for gmail_inbound_events)
└── gmail/src/routes/api/triggers/new-message.ts            (new handler — pilot)
```
