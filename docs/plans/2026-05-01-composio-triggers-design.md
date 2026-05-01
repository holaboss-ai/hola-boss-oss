---
title: Composio Triggers — Inbound Event Pipeline
date: 2026-05-01
status: draft
phase: foundation
related:
  - 2026-04-30-workspace-data-layer-tier2.md
  - 2026-03-31-composio-app-runtime-design.md
---

# Composio Triggers — Inbound Event Pipeline

## 1. Why this exists

Modules today are **outbound-only** with respect to third-party platforms. Apollo, Gmail, LinkedIn, Reddit, etc. all proxy *outbound* HTTP through `@holaboss/bridge → broker → Composio → upstream`. Anything that requires reacting to an *inbound* event (a new email, a GitHub push, a HubSpot deal moving stages, a Slack DM) currently has only one tool: **mirror sync polling**. PR #8 shipped that pattern for apollo / instantly / gmail / attio / hubspot — a 15-minute scheduler hitting the upstream API and writing into workspace `data.db`.

That works for "the agent reviews changes once an hour" but it doesn't work for "the moment a warm lead replies, surface it." The product story behind the morning-briefing dashboard implies *push* not *pull*: the agent should know within seconds that Sarah Chen replied, not on the next 15-min tick.

Composio already has the right primitive: **triggers**. They normalize platform webhooks (GitHub, Slack) and platform polling (Gmail, Calendar) into a single signed `POST` to a configured callback URL. We don't subscribe to platforms — we subscribe to Composio. The integration is uniform across providers.

The cost: Composio offers **one project-level webhook URL**, not per-tenant. Fan-out to the right user's sandbox is on us. This doc designs that fan-out plus the in-sandbox dispatch story.

## 2. Goals (Phase 1 scope)

1. **Hono webhook endpoint** at `apps/server/src/api/webhooks/composio.ts` that verifies Composio HMAC, deduplicates by `webhook-id`, and forwards to the Python ingest endpoint within ~1s.
2. **Persistent `connection_id → user_id` mapping** so we can route a webhook payload to the correct user without round-tripping Composio. New `ComposioConnection` Prisma model.
3. **Python ingest endpoint** at `POST /api/v1/triggers/dispatch` (service-key auth) that enqueues a `trigger_event` job onto the existing session-worker queue.
4. **Session worker support** for `trigger_event` jobs — claims, resolves the user's sandbox, calls the in-sandbox runtime.
5. **In-sandbox runtime endpoint** `POST /api/v1/triggers/incoming` that routes to the module declared as the trigger handler.
6. **Declarative `triggers:` block** in `app.runtime.yaml` (mirrors the Tier 2 `data_schema:` block) — at app install, runtime calls Composio's `triggers.create()` with the user's connection; at app uninstall, calls `triggers.delete()`.
7. **Pilot:** Gmail `GMAIL_NEW_GMAIL_MESSAGE` end-to-end. Chosen over HubSpot because (a) the morning-briefing dashboard story is already gmail-shaped, (b) Composio's Gmail trigger has the richest config surface (`labelIds`, `query`) so we exercise the trigger config plumbing properly even on the pilot, (c) it's a polling-backed trigger which is the harder path of the two (native-webhook providers like HubSpot are simpler — once polling works, native webhook is a no-op).

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
                                                                │ verify HMAC + dedupe (KV)
                                                                │ lookup user_id from connection_id
                                                                │ (Prisma: ComposioConnection)
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

Three new HTTP endpoints, one new Prisma table, one new queue job type, one new YAML block. Everything else reuses existing pipes.

## 5. Pieces to build

### 5.1 Hono — webhook receiver

**File:** `apps/server/src/api/webhooks/composio.ts` (new), mirrors the structure of `apps/server/src/api/webhooks.ts` (Stripe).

**Behavior:**

1. `await c.req.text()` — raw body for HMAC verify.
2. Parse `webhook-signature` (`v1,<base64>`), `webhook-id`, `webhook-timestamp`.
3. Verify against `COMPOSIO_WEBHOOK_SECRET` (new env var; add to `wrangler.jsonc` and `.env`).
4. Reject if `now - timestamp > 300` (Composio default tolerance).
5. KV-dedup by `webhook-id` with TTL 24h (same pattern as Stripe at `webhooks.ts:78–99`).
6. Parse the V3 payload, extract `connection_id`, `trigger_slug`, `data`.
7. `prisma.composioConnection.findUnique({ where: { connectionId } })` → `userId`. If absent → 200 + log warning (race with new-connect; not a fatal error).
8. POST to Python `/api/v1/triggers/dispatch` with `X-Service-Key` header — fire-and-forget with a 2s timeout. Don't block the 200 to Composio on Python's response (Composio retries are unforgiving).
9. Return 200.

**Mounted at:** `apps/server/src/index.ts` next to existing webhook routes.

### 5.2 Prisma — `ComposioConnection`

**File:** `packages/db/prisma/schema.prisma`

```prisma
model ComposioConnection {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  toolkit      String                  // "gmail", "github", "hubspot", ...
  connectionId String   @unique        // Composio's connection_id
  status       String                  // "active" / "revoked" / "error"
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  deletedAt    DateTime?

  @@index([userId, toolkit])
}
```

**Write path:** populated on the existing Composio connect-success flow in `apps/server/src/api/composio.ts`. Today the route reads connections back via the Composio API on demand; we add an `upsert` after a successful connection callback. Existing `composioHeaders()` helper stays as-is.

**Backfill:** for existing connected accounts, run a one-shot script that lists Composio connections per user (`GET /composio/connections`) and seeds the table. Lives in `apps/server/scripts/backfill-composio-connections.ts`.

### 5.3 Python — `/api/v1/triggers/dispatch`

**Service:** `holaboss-projects` (`backend/src/api/v1/triggers/`). New router.

**Auth:** `X-Service-Key` header, validated against `INTERNAL_SERVICE_KEY` env var. The existing `Hono → Python` gateway proxy already shapes this pattern (`AGENT_SERVICE_API_KEY`); we add a separate key for the trigger dispatch path so a Hono compromise doesn't grant queue-enqueue rights generally.

**Body:**
```json
{
  "user_id": "u_abc",
  "connection_id": "c_xyz",
  "toolkit": "gmail",
  "trigger_slug": "GMAIL_NEW_GMAIL_MESSAGE",
  "trigger_id": "ti_123",
  "webhook_id": "wh_..." ,
  "received_at": "2026-05-01T...",
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
      labelIds: ["INBOX"]
      interval: 1
  - slug: GMAIL_EMAIL_SENT_TRIGGER
    handler: /api/triggers/email-sent
    config: {}
```

**Lifecycle hooks** (new in `runtime/api-server/src/apply-app-triggers.ts`):

- **Install:** for each declared trigger, call broker `triggers.create({ slug, config, connectedAccountId, callbackUrl })` and persist the returned `trigger_id` to a new `_app_trigger_subscriptions` table in `data.db` (mirrors `_app_schema_versions`).
- **Uninstall:** read `_app_trigger_subscriptions` for this app, call broker `triggers.delete(trigger_id)` for each.
- **App version bump:** diff declared triggers against subscribed → reconcile (create new, delete removed).

**Handler authoring (module side):** implementing a handler is just adding a TanStack Start route at `src/routes/api/triggers/<name>.ts` and writing whatever logic. Module decides whether to (a) write to `data.db`, (b) enqueue an internal job, (c) call back into the agent — out of scope for the runtime.

## 6. Security

- **HMAC verification** at the Hono edge using `composio.triggers.verifyWebhook()` semantics (manual verify is fine — algorithm is straightforward Standard Webhooks / Svix). Don't trust anything that doesn't pass verification.
- **Replay tolerance:** 300s. Reject older.
- **Idempotency:** `webhook-id` deduped in KV at Hono and again as the queue idempotency key.
- **Trust boundary:** Hono → Python is an internal call protected by `INTERNAL_SERVICE_KEY` (service-to-service, distinct from `AGENT_SERVICE_API_KEY`). Python → sandbox is the existing trusted path.
- **Connection-account binding:** the `connection_id → user_id` lookup is the security-critical step. A wrong mapping leaks one user's email to another user's sandbox. Backfill carefully; add a unit test that asserts every payload's `connection_id` resolves to the same user across the full pipeline.

## 7. Operational concerns

- **Composio retry behavior unspecified.** Treat delivery as at-least-once with no SLA. KV dedup at Hono + queue idempotency at Python = effective once.
- **Polling triggers consume the user's third-party quota** (Gmail in particular). Default `interval: 1` (minute) for Gmail — don't go lower without thinking.
- **Single project-level webhook URL** in Composio dashboard. Set this to `https://api.holaboss.ai/api/webhooks/composio` for prod, `https://api-preview.imerchstaging.com/...` for preview, separate Composio project for each. Document this in the runbook.
- **Webhook secret** is project-level; rotate via Composio dashboard, redeploy with new `COMPOSIO_WEBHOOK_SECRET`.

## 8. Open questions

1. **Where does the agent fit in?** Phase 1 stops at "module handler runs." Should the module call back into the agent (e.g. via in-sandbox runtime's chat queue), or should triggers also have a separate fast path to the agent for "agent rules"? Leaning toward: module is the event sink; "agent rule" is a thin module that's nothing but a handler that re-prompts the agent. That keeps the contract uniform.
2. **`callbackUrl` per-trigger or global?** Composio allows specifying `callback_url` on `triggers.create()` (sometimes). If we set per-trigger to `https://api.holaboss.ai/.../<trigger_id>`, Hono can route on path instead of `connection_id`. Pro: resilient to lost mapping. Con: thousands of paths. Per-project URL is simpler. Stick with simpler unless there's a concrete reason.
3. **Trigger config update semantics.** If `app.runtime.yaml` changes a trigger's `config` block, do we (a) call `triggers.update()` if Composio offers it, (b) delete + recreate, (c) require a manual reset? Cheapest correct path: delete + recreate. Adds a hiccup window with no events.
4. **Multiple users in the same workspace.** Today: 1 user → 1 workspace. If that ever changes, the `ComposioConnection.userId` model needs revisiting.
5. **What if Composio doesn't expose a trigger we want?** Out of scope — but worth a paragraph in a follow-up doc on "trigger gap fallback patterns" (mirror sync, manual webhook, etc.).

## 9. Phased plan

### Phase 1 — pilot end-to-end (1 sprint)

- [ ] `ComposioConnection` Prisma model + migration + write on connect callback.
- [ ] One-shot backfill script for existing connections.
- [ ] Hono `/api/webhooks/composio` route + `COMPOSIO_WEBHOOK_SECRET` env wiring.
- [ ] Python `/api/v1/triggers/dispatch` router + `INTERNAL_SERVICE_KEY` env.
- [ ] Session worker `trigger_event` claim handler.
- [ ] In-sandbox runtime `/api/v1/triggers/incoming` + workspace.yaml lookup.
- [ ] `app.runtime.yaml` parser extension for `triggers:` block.
- [ ] Runtime install/uninstall lifecycle hooks for `triggers.create()` / `triggers.delete()`.
- [ ] Pilot: gmail `GMAIL_NEW_GMAIL_MESSAGE` → handler writes a row into a new `gmail_inbound_events` table.
- [ ] Smoke test: send self an email; row appears in workspace `data.db` within 60s.

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
├── apps/server/src/api/composio.ts                         (extend: write ComposioConnection on connect)
├── apps/server/scripts/backfill-composio-connections.ts    (new, one-shot)
├── apps/server/wrangler.jsonc                              (add COMPOSIO_WEBHOOK_SECRET, INTERNAL_SERVICE_KEY)
└── packages/db/prisma/schema.prisma                        (add ComposioConnection)

backend/
├── src/api/v1/triggers/                                    (new router)
├── src/services/session_worker/                            (extend: trigger_event handler)

holaOS/
├── runtime/api-server/src/triggers.ts                      (new: incoming dispatch endpoint)
├── runtime/api-server/src/apply-app-triggers.ts            (new: install/uninstall lifecycle)
├── runtime/api-server/src/app-lifecycle-worker.ts          (extend: call apply-app-triggers)

hola-boss-apps/
├── gmail/app.runtime.yaml                                  (add triggers: block — pilot)
├── gmail/src/routes/api/triggers/new-message.ts            (new handler — pilot)
├── gmail/app.runtime.yaml                                  (add data_schema for gmail_inbound_events)
```
