# 2026-04-26 — manifest-driven integration routing

Status: draft, awaiting alignment with `hola-boss-apps` maintainers.

## Problem

The desktop currently routes integration metadata through hand-maintained tables in 5 places:

| File | Symbol | Purpose |
|---|---|---|
| `desktop/src/lib/workspaceDesktop.tsx:739` | `APP_TO_PROVIDER` | gate install behind active connection; auto-bind after install |
| `desktop/src/components/marketplace/AppsGallery.tsx:37` | `PROVIDER_DISPLAY` | install-confirm modal copy |
| `desktop/src/components/panes/MarketplacePane.tsx:14` | `PROVIDER_DISPLAY_NAMES` | marketplace UI labels |
| `desktop/src/components/onboarding/constants.ts:3` | `PROVIDER_DISPLAY_NAMES` | onboarding copy + `composioFinalize` `account_label` |
| `desktop/src/components/panes/IntegrationsPane.tsx:1271,1285` | `PROVIDER_CATEGORY_GROUPS` / `PROVIDER_TOOLKIT_PREFERENCE` | Integrations page grouping + preferred toolkit slug |

Until the 2026-04-26 hotfix (option A), these tables only listed consumer providers (google, github, reddit, twitter, linkedin). Installing a B2B app like `hubspot` silently succeeded, no binding was written, and the agent later got `BrokerError("integration_not_bound", 404, …)` with no context.

Option A patched the tables to include `hubspot / attio / calcom / apollo / instantly / zoominfo`. But:

- The connect modal calls `composioConnect`, which assumes Composio managed auth (single redirect URL). HubSpot et al. need user-supplied API keys — there is no UI to collect them.
- Adding a new B2B app still requires touching 5 desktop files.

The 2026-03-30 / 2026-03-31 design docs (`integrations-engineering-design.md`, `composio-app-runtime-design.md`) already specified the `auth_mode = "managed" | "oauth_app" | "manual_token" | "composio"` model and the Catalog → Connection → Binding → Broker layers. **What's missing is the desktop-side wiring for `manual_token` / `oauth_app` and the manifest field for credential prompts.** This doc fills that gap.

> Note on line numbers: re-grep before review. Recent desktop changes (admin AppLogo, install-error scrollable Remove) may shift these by a few lines. The symbol names are stable.

## Goal

Adding a new integration-bound app should require only changes inside the app's own directory plus its `marketplace.json` entry:

1. add the app's directory + write `app.runtime.yaml` with the runtime config (lifecycle / port / mcp tools),
2. add the app's entry to `marketplace.json` with the new `integration` block,
3. publish the archive.

Desktop (and runtime UI) should pick up provider name, category, auth mode, and credential prompt automatically. Adding a new app **under one of the existing auth modes** should require no PR to `holaOS`. (New auth modes still require holaOS code by definition.)

## Source of truth: `marketplace.json`, not `app.runtime.yaml`

`hola-boss-apps/CLAUDE.md` explicitly designates `marketplace.json` as the single source of truth for the `/admin/apps` registry. The earlier draft of this doc placed `integration` metadata in `app.runtime.yaml` and proposed having the marketplace catalog endpoint unpack tarballs to read it. That design has three problems:

- the marketplace listing endpoint becomes archive-coupled (slow first-load, can't list a registered app until its archive is built),
- the manifest and the yaml inevitably drift,
- admins can't override per-environment via the existing `/admin/apps` CRUD without re-publishing.

**Decision**: every field a desktop UI / install flow needs lives in `marketplace.json`. The DB-backed `app_registry` adds the corresponding columns. Hono `/app-templates` returns the `integration` block on every entry. Archives carry only what the in-sandbox runtime needs at startup (lifecycle, mcp tools list, env_contract).

`app.runtime.yaml` keeps a thin compatibility section for fields the runtime reads at start time (`destination`, `holaboss_user_id_required`, `credential_source`). The runtime never reads `auth.mode` / `auth.fields` / `display_name` / `category` from yaml — those are catalog concerns.

### Cross-source consistency

`yaml.integration.destination` and `marketplace.json.provider_id` are two declarations of the same identifier. They MUST be equal; divergence is the exact silent-drift class this design is supposed to eliminate.

The sync endpoint (`POST /admin/apps/sync`) enforces this on the manifest-side: every app's manifest entry is matched against the published archive's `app.runtime.yaml`, and the sync **fails (4xx)** if `provider_id` doesn't equal `integration.destination`. The check runs in dry-run too so the diff dialog surfaces it as a validation error before the admin clicks Apply.

The check is symmetric: hola-boss-apps CI (the same workflow that builds release tarballs) lints every app's `app.runtime.yaml` against the manifest entry as part of pre-publish, so divergence can't reach a release in the first place.

## Schema additions to `marketplace.json` (per app entry)

Existing per-app shape:

```json
{
  "name": "hubspot",
  "description": "...",
  "category": "crm",
  "tags": ["crm", "sales", ...],
  "icon": "hubspot",
  "provider_id": "hubspot",
  "credential_source": "platform",
  "path": "hubspot",
  "default_ref": null
}
```

Proposed additions (additive — old manifests stay valid):

```json
{
  "name": "hubspot",
  "display_name": "HubSpot",
  "category": "crm",
  "provider_id": "hubspot",
  "toolkit_slug": "hubspot",
  "auth": {
    "mode": "manual_token",
    "fields": [
      {
        "name": "api_key",
        "label": "HubSpot Private App Token",
        "type": "secret",
        "required": true,
        "help_url": "https://developers.hubspot.com/docs/api/private-apps"
      }
    ]
  }
}
```

`auth.mode` is one of:

- `managed` — Composio-managed OAuth, single redirect; no credential prompt.
- `manual_token` — user pastes API key / private app token. `auth.fields` required.
- `oauth_app` — user supplies their own OAuth client (id/secret/redirect). `auth.fields` required. Not used by any current shipping app; schema reserved for future use.

`type` per field is `secret | text | url`. `secret` means the renderer never persists or echoes the value — the form submit is the only place it leaves React state, and IPC pushes it straight to main → Composio.

### Examples

```json
// twitter — managed Composio OAuth
{
  "name": "twitter",
  "display_name": "Twitter / X",
  "category": "social",
  "provider_id": "twitter",
  "auth": { "mode": "managed" }
}

// hubspot — manual API token
{
  "name": "hubspot",
  "display_name": "HubSpot",
  "category": "crm",
  "provider_id": "hubspot",
  "auth": {
    "mode": "manual_token",
    "fields": [
      { "name": "api_key", "label": "HubSpot Private App Token",
        "type": "secret", "required": true,
        "help_url": "https://developers.hubspot.com/docs/api/private-apps" }
    ]
  }
}

// (future) self-hosted oauth_app variant
{
  "name": "github-oauth",
  "display_name": "GitHub (self-hosted OAuth app)",
  "category": "developer",
  "provider_id": "github",
  "auth": {
    "mode": "oauth_app",
    "fields": [
      { "name": "client_id", "label": "OAuth Client ID", "type": "text", "required": true },
      { "name": "client_secret", "label": "OAuth Client Secret", "type": "secret", "required": true },
      { "name": "redirect_uri", "label": "Redirect URI", "type": "url", "required": true }
    ]
  }
}
```

### Field-level decisions

- `auth.mode` is the single source of truth. Drop `credential_source` from new manifest entries once all 12 apps are migrated; keep parsing it for now.
- `auth.fields[].name` MUST be the Composio field name (no per-field translation in v1). If Composio renames a field, the manifest updates. Acceptable cost given how rarely Composio renames.
- All schema fields are optional from the parser's perspective so already-shipping manifests stay valid; the resolver supplies defaults (`display_name = titleCase(name)`, `auth = { mode: "managed" }` when absent).

## Decisions required BEFORE Phase 1

These three need agreement on the chat thread before yaml/manifest work starts. Locking them in afterward causes Phase 1 rework.

### D1 — `auth_config_id` provisioning for `manual_token`

Composio requires an auth config per toolkit. Two viable paths:

- **(a) shared byo-creds auth_config per toolkit** — Holaboss provisions one auth_config with `use_custom_auth: true` for each `manual_token` toolkit. Every user's connection points to the same auth_config; their credentials live in the per-connection `connected_account` record on Composio.
- **(b) per-tenant auth_config** — first time anyone in a workspace connects, Holaboss creates a fresh auth_config; subsequent users in the same workspace reuse it.

**Proposal: (a)**. Reasoning: keeps Holaboss out of the credential rotation business, simpler operational model, scales cleanly. (b) only matters if we ever want per-tenant Composio billing isolation, which isn't a current product requirement.

### D2 — schema field naming

Naming: `credential_schema` vs `credentials_schema` vs `auth_config_inputs`. The 2026-03-30 design didn't pick one.

**Proposal: nest under `auth`** (this doc's choice). Reads as `auth.mode` + `auth.fields` rather than two top-level keys. Future fields like `auth.scopes` / `auth.redirect_uri` slot in cleanly without a third top-level key.

### D3 — category taxonomy

Current `PROVIDER_CATEGORY_GROUPS`: `social / productivity / developer / community / crm / sales`.
Composio's `toolkit.categories`: includes `marketing / productivity / crm / support` and others.

**Proposal**: declare the manifest taxonomy authoritative; document a fixed mapping from Composio's categories to ours; Holaboss UI groups by manifest category, not Composio's. Composio's category is fallback only when an installed app has no manifest entry.

## Plumbing changes

### 1. `hola-boss-apps`

- `marketplace.schema.json`: extend per-app entry schema with `display_name` (string, optional) / `auth` (object, optional). When `auth.mode != "managed"`, JSON-Schema `if/then` makes `auth.fields` (array, length ≥ 1) required.
- `marketplace.json`: add `display_name` + `auth` block to all 12 apps. Consumer apps (twitter / linkedin / reddit / gmail / github / sheets) get `auth: { mode: "managed" }`. B2B apps get `auth: { mode: "manual_token", fields: [...] }`.
- `_template/` + `create-hola-app`: extend the scaffolding CLI so `create-hola-app <name>` emits a starter `marketplace.entry.json` (the manifest fragment for the new app) into the new app's directory. README comments rot; a CLI artifact lands in the new author's working directory and is hard to miss. The existing `marketplace.json` editor / sync flow already accepts a manifest fragment, so the author's only step is "copy this entry into root marketplace.json" once they're ready to publish.

### 2. Backend (`marketplace` service)

- Migration: extend `app_registry` table with `display_name TEXT`, `auth_mode TEXT`, `auth_fields JSONB`. Optional / nullable for backward compat.
- `AppManifestSyncPayload` + `AppManifestEntry` parsers: read the new fields; `admin_apps_router` write paths persist them.
- `/admin/apps` and `/app-templates` responses: surface `display_name` + `auth` on every entry. `auth` defaults to `{ mode: "managed" }` when absent in DB so old rows don't break clients.
- Tests: extend `test_admin_apps.py` sync round-trip (already covers create/update/orphan) to include the new fields.

### 3. Hono BFF + SDK

- `apps/server/src/api/marketplace.ts` `appTemplateMetadataSchema`: add `display_name` + `auth` to the zod shape.
- `bun run generate` regenerates `@holaboss/app-sdk` types; commit the regenerated types in the same PR. **This step is mandatory in Phase 1** — both desktop AND `frontend/apps/web` consume the SDK and won't compile against the new fields without the regen. The PR description should explicitly call out that two downstream surfaces are affected so reviewers don't merge a half-regen.

### 4. Runtime (`holaOS/runtime/api-server`)

- New endpoint `POST /api/v1/integrations/connect-with-credentials`:
  - body: `{ provider_id, toolkit_slug, owner_user_id, credentials: Record<string, string>, account_label?: string }`
  - calls Composio `/api/v3/connected_accounts` with `use_custom_auth: true` against the shared toolkit auth_config (per D1.a). Maps `credentials` to Composio's expected shape.
  - persists an `IntegrationConnection` with `auth_mode = "manual_token"`, `account_external_id = <composio connected_account_id>`, `status = "active"`.
  - returns the `IntegrationConnection`.
- `resolved-app-bootstrap-shared.ts`: parse the new `integration.*` fields **only if** they exist in `app.runtime.yaml` for runtime-only purposes (none today; reserved). Catalog UI does NOT read from yaml — it reads from the catalog response.
- `installed_apps` / sandbox state: store the resolved `auth.mode` + `provider_id` from catalog at install time so the sandbox can decline to start an app whose required binding has been deleted.

### 5. Desktop

For each consumer of the 5 hand-maintained tables, replace lookups with a catalog accessor:

- `installAppFromCatalog` (`workspaceDesktop.tsx`): replace `APP_TO_PROVIDER[appId]` with `catalog[appId]?.provider_id`. If `auth.mode === "managed"`, route to existing `connectAndInstallApp`. If `auth.mode === "manual_token" | "oauth_app"`, open `<CredentialsModal>`.
- `<CredentialsModal>`: dynamic form built from `catalog[appId].auth.fields`, secret fields use `<input type="password" autocomplete="off">`, submit dispatches `composioConnectWithCredentials` IPC, then runs the existing post-connect binding-write.
- Marketplace + Onboarding copy: derive `display_name` and category from `catalog[appId]` rather than hardcoded maps.
- IntegrationsPane: build the provider list from `(catalogProviders + installedAppsIntegrations + composioToolkits)`, with category coming from manifest when present, falling back to Composio's toolkit category.

The 5 tables get deleted in Phase 4.

## CredentialsModal — UX wireframe

```
┌─────────────────────────────────────────────────────┐
│ Connect HubSpot                                  ×  │
├─────────────────────────────────────────────────────┤
│ HubSpot needs a Private App Token to access your    │
│ contacts, companies, and deals.                     │
│                                                     │
│ HubSpot Private App Token  ⓘ How to create one →    │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ••••••••••••••••••••••••••••••••••••           │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ⚠ The token couldn't authenticate. Check that it    │
│   has the required scopes and try again.            │
│                                                     │
├─────────────────────────────────────────────────────┤
│                       [Cancel]  [Test & connect →]  │
└─────────────────────────────────────────────────────┘
```

Required behaviors:

- **Test & connect** runs `composioConnectWithCredentials` then immediately calls the app's connection-status MCP tool (e.g. `hubspot_get_connection_status`). On 200 + `connected: true`, write the binding; on anything else, surface the error inline (red banner above the buttons) and keep the modal open.
- **Field validation** — `required` fields with empty value disable the submit button; `type: "url"` validates with `URL()` constructor on blur.
- **a11y** — first input gets `autoFocus`, Tab cycles fields → Cancel → Test, Esc closes (with confirmation if the form is dirty), `aria-describedby` pairs each field with its `help_url` link.
- **Error display** — never echo the secret back in error messages. Show Composio's error code + a generic "the token couldn't authenticate" string; full diagnostics go to logs.
- **Multi-account** — if an active connection of the same `provider_id` already exists, prepend a "Use existing connection / Create new connection" radio above the form. Default to existing.

## Phased rollout

The goal is **no breakage at any phase boundary** — each phase ships independently and is reversible.

### Phase 0 — Composio byo-creds spike (gates Phase 1 schema)

Phase 1 locks `auth.fields[].name` values into the manifest schema. If Composio rejects those field names per-toolkit (e.g. wants `accessToken` instead of `api_key` for hubspot), Phase 1 has to redo schema + DB migration + SDK regen. So spike first.

- `hola-boss-apps/scripts/composio-spike-byo-creds.ts` calls Composio's real API with `use_custom_auth: true` for `hubspot` + `calcom` (the two D1 reference toolkits). It provisions the shared byo-creds auth_config, creates a connected_account, polls until ACTIVE, and runs a per-toolkit verify probe (e.g. `GET /crm/v3/owners?limit=1` for hubspot).
- The script prints a structured report capturing: which credential field names Composio actually accepted, end-to-end latency per step, account status, and the verify probe's HTTP response. Output is intended to be pasted directly into this doc and Phase 1's PR description.
- Run by a human with a real `COMPOSIO_API_KEY` and real toolkit credentials. The output **gates** Phase 1 — if either toolkit needs a non-trivial workaround, manifest schema gets a corresponding adjustment before Phase 1 work starts.

```bash
COMPOSIO_API_KEY=cmp_xxx pnpm composio:spike-byo-creds hubspot --api-key hubspot_xxx
COMPOSIO_API_KEY=cmp_xxx pnpm composio:spike-byo-creds calcom  --api-key calcom_xxx
```

Acceptance: both reports come back PASS (account ACTIVE + verify probe 2xx) AND every credential field name in the report matches what the manifest will declare. Any mismatch gets resolved by editing the planned manifest entry before Phase 1 lands.

### Phase 1 — manifest schema + DB columns + SDK regen (no UX change)

- `hola-boss-apps`: extend `marketplace.schema.json`; add `display_name` + `auth` to all 12 manifest entries; bump release tag.
- `holaboss-backend`: migration adds nullable columns; sync endpoint reads the new fields; `app-templates` returns them with safe defaults.
- `holaboss-frontend`: zod schema + SDK regen; PR is essentially a generated-files diff.
- Acceptance: `GET /api/marketplace/app-templates` returns `auth.mode: "manual_token"` + `auth.fields` for hubspot. Desktop unchanged, still works via the option-A hardcoded tables.

### Phase 2A — catalog accessor with dual-source fallback

- Land a single helper `resolveAppIntegration(appId, catalog) → { provider_id, display_name, category, auth }` that consults catalog first, falls back to the hardcoded map.
- All 5 hand-maintained tables stay in place; every consumer is rewritten to call the helper.
- Unit-test each fallback branch. **No entries are removed from the hardcoded maps in this phase.**
- Acceptance: behavior is byte-identical to the option-A hotfix; this is purely a refactor with the new code path proven to be a no-op.

### Phase 2B — flip apps to catalog-only, with reconciliation per cutover

Per-app cutover (in this order: hubspot → calcom → attio → apollo → instantly → zoominfo → twitter → linkedin → reddit → gmail → github → sheets):

1. Delete the app's entry from all 5 hardcoded maps. Helper now only resolves it via catalog.
2. The reconciler (shipped as a no-op in Phase 2A and described below) starts surfacing badges for this app, since stored `auth.mode` (whatever option-A wrote) now diverges from catalog's `auth.mode` for any user who installed before the flip.
3. Acceptance per app: fresh install + reinstall-from-badge + onboarding + IntegrationsPane category render all work end-to-end.

The reconciler itself ships as code in Phase 2A:

- `installed_apps` rows include the `provider_id` / `auth.mode` they were installed under. Reconciler compares each row against catalog at desktop launch.
- In Phase 2A this is a no-op because every row was option-A-written and catalog still serves option-A-equivalent values.
- As Phase 2B flips apps one by one, the reconciler starts flagging mismatches for those apps and shows "App configuration changed — reinstall recommended" on the affected tiles.
- No automatic destructive action — the user clicks a button to remove + reinstall through the new flow.

Phase 2 is the highest-risk hop. The 2A / 2B split isolates the refactor from the cutover; folding the reconciler into 2A as a no-op (and into 2B per-app as the surfacing trigger) avoids ever shipping a state where stored data and live UI logic disagree without a user-facing escape hatch.

### Phase 3 — credentials modal + connect-with-credentials endpoint

- Implement `<CredentialsModal>` per the wireframe above.
- Implement runtime `POST /integrations/connect-with-credentials`.
- Wire `installAppFromCatalog` to choose between OAuth redirect and credentials modal based on `auth.mode`.
- Post-connect verify uses each app's `<provider>_get_connection_status` MCP tool.
- Acceptance: clean install of hubspot on a fresh machine: prompt → enter API key → install completes → agent can use hubspot tools.

### Phase 4 — cleanup

- Delete the 5 hand-maintained tables.
- IntegrationsPane stops importing from `onboarding/constants.ts`.
- Update CLAUDE.md (both repos) to point at `marketplace.json` as the source of truth for catalog metadata; `app.runtime.yaml` documents only the runtime-startup fields.

## Risks / open questions

1. **Composio field-name drift.** `auth.fields[].name` ties the manifest to Composio's request shape. If Composio renames `api_key` to `access_token`, every affected manifest entry needs a bump. Decision: skip the indirection for v1; treat field names as part of each app's contract. Cost is ~3 PRs/year worst case.
2. **Telemetry on credential failures.** `manual_token` creds fail in different ways than OAuth (revoked vs scoped-out vs typo). Phase 3 should normalize these into the existing `BrokerErrorCode` enum (likely add `credentials_invalid` and `credentials_expired`).
3. **Concurrent installs of the same provider.** If two workspaces in the same desktop session install `hubspot` simultaneously, the second's CredentialsModal could collide with the first's pending connect. Phase 3 should serialize via the existing install queue.
4. **`oauth_app` mode** is in scope for the schema but not for any current shipping app. Implementation can be deferred to a future phase. Phase 1 only ships parser + zod support; no UI.

## Items requiring cross-team alignment before Phase 1

The three D1–D3 decisions above. Once locked, Phase 1 is mechanical.

`display_name` ownership: manifest declares it, Composio's toolkit metadata also has a `name`. If they conflict, manifest wins (per "manifest is source of truth"); UI falls back to Composio's name only for any provider that has no manifest entry (i.e. surfaced via Composio toolkits but never installed as an app).
