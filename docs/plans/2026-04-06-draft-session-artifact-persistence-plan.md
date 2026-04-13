# Draft Session Artifact Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist draft-creation tool results as session-linked app artifacts so desktop chat renders artifact chips under the assistant turn.

**Architecture:** Pass the active Holaboss workspace/session/input context from the runtime into module-app MCP requests, then have draft creation tools publish through `POST /api/v1/agent-sessions/:sessionId/artifacts` instead of the generic `/outputs` API. Keep app routing in artifact metadata via `presentation.path` and `presentation.view` so desktop can reopen the correct app surface.

**Tech Stack:** TypeScript, Fastify runtime API, MCP SDK, SQLite module apps, Vitest

### Task 1: Pass turn context into app MCP requests

**Files:**
- Modify: `holaOS/runtime/api-server/src/ts-runner.ts`
- Test: `holaOS/runtime/api-server/src/ts-runner.test.ts`

**Step 1: Write the failing test**

Assert that `defaultBootstrapApplications()` includes Holaboss session/input/workspace headers on the remote MCP server config it returns for resolved applications.

**Step 2: Run test to verify it fails**

Run: `bun run test holaOS/runtime/api-server/src/ts-runner.test.ts`

Expected: existing app bootstrap test only sees `X-Workspace-Id`.

**Step 3: Write minimal implementation**

Update the resolved-application MCP headers to include:

- `X-Holaboss-Workspace-Id`
- `X-Holaboss-Session-Id`
- `X-Holaboss-Input-Id`

Keep the existing workspace header if other code still depends on it.

**Step 4: Run test to verify it passes**

Run: `bun run test holaOS/runtime/api-server/src/ts-runner.test.ts`

Expected: test passes and captured MCP headers include the active turn context.

### Task 2: Add a session-artifact publishing helper for module apps

**Files:**
- Modify: `hola-boss-apps/gmail/src/server/holaboss-bridge.ts`
- Modify: `hola-boss-apps/twitter/src/server/holaboss-bridge.ts`
- Modify: `hola-boss-apps/linkedin/src/server/holaboss-bridge.ts`
- Modify: `hola-boss-apps/reddit/src/server/holaboss-bridge.ts`
- Test: `hola-boss-apps/gmail/test/app-outputs.test.ts`
- Create or modify equivalent tests in the social apps if helper tests live there

**Step 1: Write the failing test**

Cover a helper that, given request headers containing workspace/session/input ids, posts to:

- `/api/v1/agent-sessions/:sessionId/artifacts`

and includes:

- `workspace_id`
- `input_id`
- `artifact_type`
- `external_id`
- `title`
- `platform`
- `module_id`
- `module_resource_id`
- `metadata`

**Step 2: Run test to verify it fails**

Run the relevant app Vitest suite.

**Step 3: Write minimal implementation**

Add a helper such as `createSessionArtifact()` that:

- reads Holaboss headers from MCP `extra.requestInfo.headers`
- no-ops outside workspace/runtime execution
- posts to the session artifacts endpoint
- returns the created artifact or `null`

Do not remove the generic `/outputs` helper yet; other non-chat output flows may still rely on it.

**Step 4: Run test to verify it passes**

Run the updated helper tests and confirm the request is sent to the artifacts endpoint with the turn context.

### Task 3: Switch draft-creation tools to publish session artifacts

**Files:**
- Modify: `hola-boss-apps/gmail/src/server/mcp.ts`
- Modify: `hola-boss-apps/gmail/src/server/app-outputs.ts`
- Modify: `hola-boss-apps/twitter/src/server/mcp.ts`
- Modify: `hola-boss-apps/linkedin/src/server/mcp.ts`
- Modify: `hola-boss-apps/reddit/src/server/mcp.ts`
- Create helpers if needed:
  - `hola-boss-apps/twitter/src/server/app-outputs.ts`
  - `hola-boss-apps/linkedin/src/server/app-outputs.ts`
  - `hola-boss-apps/reddit/src/server/app-outputs.ts`

**Step 1: Write the failing test**

At minimum, add coverage for one successful draft creation path that verifies:

- the module draft record is created
- artifact persistence is called once
- artifact metadata contains an app presentation path
- `module_id` and `module_resource_id` are stable

**Step 2: Run test to verify it fails**

Run the targeted app test file.

**Step 3: Write minimal implementation**

Update tool handlers to accept the MCP `extra` argument and publish artifacts after successful inserts:

- Gmail: replace draft-chat persistence from `/outputs` with session artifact publishing for `gmail_draft_reply`
- Twitter: publish a `draft` artifact for `twitter_create_post`
- LinkedIn: publish a `draft` artifact for `linkedin_create_post`
- Reddit: publish a `draft` artifact for `reddit_create_post`

Artifact metadata should include app presentation info:

- Gmail: `view: "drafts"`, `path: "/drafts/<id>"`
- Twitter/LinkedIn/Reddit: `view: "posts"`, `path: "/posts/<id>"`

Use the local post/draft id as both `external_id` and `module_resource_id` unless a better app-local identifier already exists.

**Step 4: Run test to verify it passes**

Run each targeted app test file and confirm artifact publishing is invoked only on successful draft creation.

### Task 4: Verify runtime and desktop behavior end-to-end

**Files:**
- Modify: `holaOS/runtime/api-server/src/app.test.ts`
- Optionally modify desktop/runtime integration tests if a turn-level artifact assertion already exists

**Step 1: Write the failing test**

Add or extend a runtime API test that proves an app-origin artifact persisted through the session artifacts endpoint is attached to the current `input_id` and exposed through artifact listing.

**Step 2: Run test to verify it fails**

Run the runtime API test file.

**Step 3: Write minimal implementation**

Only add code here if the tests reveal a missing normalization step. Prefer not to widen scope unless runtime listing/navigation actually fails.

**Step 4: Run test to verify it passes**

Run:

- `bun run test holaOS/runtime/api-server/src/app.test.ts`
- app-level test files for Gmail/Twitter/LinkedIn/Reddit

Expected:

- artifact rows have `origin_type: "app"`
- artifact rows are associated with the active `session_id + input_id`
- desktop navigation can resolve the app route from metadata presentation

### Task 5: Verification and rollout

**Files:**
- No code changes required beyond the files above

**Step 1: Run focused verification**

Run the targeted Vitest commands from Tasks 1-4.

**Step 2: Run manual repro**

1. Create a Gmail or social post draft through chat.
2. Confirm the assistant response shows an artifact chip.
3. Click the chip.
4. Confirm desktop opens the correct app route.

**Step 3: Commit**

```bash
git add holaOS/runtime/api-server/src/ts-runner.ts \
  holaOS/runtime/api-server/src/ts-runner.test.ts \
  holaOS/runtime/api-server/src/app.test.ts \
  hola-boss-apps/gmail/src/server/holaboss-bridge.ts \
  hola-boss-apps/gmail/src/server/app-outputs.ts \
  hola-boss-apps/gmail/src/server/mcp.ts \
  hola-boss-apps/gmail/test/app-outputs.test.ts \
  hola-boss-apps/twitter/src/server/holaboss-bridge.ts \
  hola-boss-apps/twitter/src/server/mcp.ts \
  hola-boss-apps/linkedin/src/server/holaboss-bridge.ts \
  hola-boss-apps/linkedin/src/server/mcp.ts \
  hola-boss-apps/reddit/src/server/holaboss-bridge.ts \
  hola-boss-apps/reddit/src/server/mcp.ts \
  holaOS/docs/plans/2026-04-06-draft-session-artifact-persistence-plan.md
git commit -m "fix: persist draft app artifacts on session turns"
```
