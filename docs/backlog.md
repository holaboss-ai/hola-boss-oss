# TODO Backlog

**Status**: Active


## Entry Format
- `ID`: Stable TODO identifier (for example `T-001`)
- `Date`: Date opened (`YYYY-MM-DD`)
- `Title`: Short task name
- `Background`: Why this task exists
- `TODO`: Concrete implementation tasks
- `Validation`: How we verify completion
- `Status`: `pending|in_progress|blocked|done`

## P1

### T-027 (2026-03-24): Establish phased TypeScript runtime migration plan
- `Status`: done
- `Background`:
  - This migration planning entry is now historical.
  - The runtime is now TypeScript-led across the API server, harness execution, local state, CLI helpers, and packaging/bootstrap.
  - A full rewrite in one shot would couple harness changes, persistence changes, API changes, and packaging changes into a single high-risk migration.
  - The migration sequence has been completed and the old runtime tree has been removed.
- `TODO`:
  - Preserve this entry as the historical sequencing record for the completed migration.
- `Validation`:
  - The runtime is now TS-only in code, tests, bundle assembly, and local bundle packaging.
  - Historical migration sequencing is preserved here for reference only.

### T-028 (2026-03-24): Move OpenCode harness execution into a TypeScript harness host
- `Status`: done
- `Background`:
  - OpenCode harness execution now runs through the TypeScript harness host and TS runner path.
  - This entry is kept as historical migration context.
- `TODO`:
  - Preserve this entry as the historical record of the completed harness migration.
- `Validation`:
  - OpenCode runs now execute through `runtime/harness-host` and `runtime/api-server/src/ts-runner.ts`.
  - Runtime events and harness-session persistence are covered by the current TS test suite.

### T-029 (2026-03-24): Port runtime local state and event persistence to TypeScript
- `Status`: done
- `Background`:
  - This entry is now historical.
  - Runtime-local SQLite state, session bindings, queue items, runtime state, and output persistence now run through the TS runtime path.
- `TODO`:
  - Preserve this entry as the historical record of the completed local-state migration.
- `Validation`:
  - The TS runtime reads and writes the existing runtime DB schema without a Python runtime dependency.
  - Session bindings, output events, and runtime-state transitions are covered by the current TS test suite.

### T-030 (2026-03-24): Replace FastAPI runtime endpoints with a TypeScript API service
- `Status`: done
- `Background`:
  - This entry is now historical.
  - The runtime API surface is now served by the TypeScript API server and no Python fallback remains in the runtime path.
- `TODO`:
  - Preserve this entry as the historical record of the completed API migration.
- `Validation`:
  - The desktop app talks to the TS API without a separate Python service.
  - Session queueing, output streaming, runtime status, and lifecycle flows are validated through the current TS runtime tests.

### T-031 (2026-03-24): Port runtime CLI and workflow helpers to TypeScript
- `Status`: done
- `Background`:
  - This entry is now historical.
  - The shipped `hb` runtime CLI path now comes from the TS runtime bundle and packaging flow.
- `TODO`:
  - Preserve this entry as the historical record of the completed CLI migration.
- `Validation`:
  - Runtime bundle launchers and helpers use the TS runtime CLI path.
  - Local bundle packaging starts and serves the runtime without Python CLI entrypoints.

### T-032 (2026-03-24): Replace Python-led runtime packaging and bootstrap with a TypeScript runtime bundle
- `Status`: done
- `Background`:
  - This entry is now historical.
  - Runtime bundle assembly, bootstrap startup, and release packaging now center on the TypeScript runtime bundle.
- `TODO`:
  - Preserve this entry as the historical record of the completed packaging migration.
- `Validation`:
  - Local dev, packaged desktop, and release-built runtime bundles start the TS runtime without legacy language-runtime payloads.
  - Runtime bundle assembly and local packaging no longer stage Python source or Python dependency payloads.


### T-017 (2026-03-06): Redesign proactive agent to workspace-first scanning and learning
- `Status`: pending
- `Background`:
  - The platform no longer has a strict product/integration-first model.
  - Proactive behavior should evaluate each workspace directly and propose useful tasks from current workspace state.
  - Preference adaptation should improve over time through Agno-based learning grounded in user actions.
- `TODO`:
  - Implement workspace-first proactive scan flow per workspace (`workspace.yaml`, apps, tools, runtime signals, recent outputs).
  - Replace fixed task assumptions with capability-driven proposal generation based on what the workspace can execute now.
  - Add proposal ranking with impact, executability, and user-preference fit.
  - Add feedback loop using proposal decisions (`accepted|modified|ignored`) and downstream execution outcomes.
  - Persist durable workspace-scoped preference signals and consolidate them into Agno memory safely.
  - Complete proactive naming migration from `profile_id` semantics to `workspace_id` semantics (with compatibility alias where needed).
- `Validation`:
  - Heartbeat/proactive runs produce proposals from workspace snapshot and capabilities, not legacy product/integration gates.
  - Repeated user feedback measurably changes later proposal ranking for the same workspace.
  - Zero-proposal runs are explicit and correct when no executable opportunities exist.
  - Tests cover workspace scan, ranking branches, learning updates, and id-compatibility behavior.

### T-023 (2026-03-13): Implement real cronjob `system_notification` delivery path
- `Status`: pending
- `Background`:
  - Cronjob delivery channel contract now separates `session_run` from `system_notification`.
  - Current `system_notification` branch is intentionally a no-op placeholder for minimal viability.
  - The current no-op implementation still uses the default system-notification executor placeholder in the cronjob delivery path.
  - User-visible reminders/notifications require an actual delivery integration and observability around failures.
- `TODO`:
  - Implement a real `system_notification` dispatcher for cronjobs (channel gateway / notification sink integration).
  - Define payload contract for notification content, recipient resolution, and formatting.
  - Add retry/backoff and terminal failure handling for notification delivery.
  - Add delivery metrics/logging (`start|success|error|dropped`) with cronjob/workspace identifiers.
- `Validation`:
  - End-to-end cronjob with `system_notification` emits a user-visible notification.
  - Failure modes are observable and surfaced in cronjob `last_status`/`last_error`.
  - Tests cover success, transient failure retry, and hard-failure behavior.

### T-024 (2026-03-16): Define and automate QMD embed lifecycle
- `Status`: pending
- `Background`:
  - QMD semantic search quality depends on up-to-date embeddings for memory/content files.
  - Current embedding behavior is not fully standardized across local/dev/prod workflows.
  - Missing or stale embeds can degrade retrieval quality even when raw files are present.
- `TODO`:
  - Define the canonical embed contract: when embed must run (create/update/delete/sync windows) and expected freshness.
  - Add a documented operational flow for embedding (`manual` and `scheduled`) with minimal commands and health checks.
  - Add stale-index detection and explicit operator feedback when search is running on outdated embeddings.
  - Add telemetry for embed duration, item counts, failures, and last successful embed timestamp.
  - Decide and document default mode policy (`search`/`query`) and prewarm expectations vs runtime tradeoffs.
- `Validation`:
  - E2E test verifies newly written memory/content is discoverable after the defined embed flow.
  - Operational runbook includes deterministic commands for embed refresh and status verification.
  - Metrics/logs expose embed freshness and failure signals for alerting/debugging.


## P2

### T-026 (2026-03-23): Harden macOS desktop DMG release pipeline
- `Status`: pending
- `Background`:
  - The desktop workspace app can already build a local unsigned `.dmg`, but public distribution needs a repeatable GitHub Actions release path.
  - macOS desktop packaging should be coupled to the exact runtime bundle produced in the same workflow run rather than resolving the latest published runtime asset.
  - Production macOS distribution also requires Apple code signing and notarization credentials, plus validation that the packaged app satisfies notarization requirements.
- `TODO`:
  - Finalize the GitHub Actions release flow that builds the macOS runtime bundle and desktop `.dmg` in the same run and publishes both assets to the same release.
  - Ensure the desktop packaging job consumes the exact runtime artifact from that run instead of downloading `latest`.
  - Configure repository secrets and operational setup for Apple Developer signing/notarization (`Developer ID Application` certificate export, Apple ID/app-specific password, team ID).
  - Verify whether explicit mac entitlements are required for notarization and add them if the current Electron bundle is rejected.
  - Add a validation pass that confirms the produced `.dmg` is signed/notarized when secrets are present and still supports an intentional unsigned fallback for OSS/internal builds.
- `Validation`:
  - A GitHub Actions release run on macOS publishes a desktop `.dmg` attached to the same release as the runtime asset.
  - The desktop bundle is built from the runtime artifact created in the same workflow run.
  - Signed runs pass notarization and open cleanly on macOS without Gatekeeper rejection.
  - Unsigned fallback runs remain available when signing secrets are intentionally absent.

### T-025 (2026-03-22): Replace task-proposal long-poll SSE with persistent local event stream
- `Status`: pending
- `Background`:
  - Task proposals are now sandbox-local canonical state in the runtime-local database.
  - The projects API keeps the existing `GET /task-proposals/unreviewed/stream` shape, but the current implementation is only a single-shot long-poll style SSE response.
  - This preserves API compatibility for now, but it is not a true realtime stream and is not the intended steady-state behavior.
- `TODO`:
  - Design a persistent local event bridge for sandbox-local task proposal insert/update events.
  - Replace the current projects-layer single-shot SSE implementation with a continuous stream sourced from sandbox runtime events.
  - Define reconnect, backpressure, and heartbeat behavior for desktop and backend consumers.
  - Add observability for proposal stream disconnects, replay gaps, and delivery lag.
- `Validation`:
  - `GET /task-proposals/unreviewed/stream` stays open and continuously emits new proposal events without polling the full list each reconnect cycle.
  - Desktop/backend consumers receive insert/update events for new sandbox-local task proposals with stable reconnect behavior.
  - Tests cover stream open, heartbeat, reconnect, and new-proposal delivery.

### T-013 (2026-03-06): Support cronjob presets as workspace/template defaults
- `Status`: pending
- `Background`:
  - Workspaces need reusable baseline automation without manual cronjob creation each time.
  - Template-level cronjob presets should bootstrap predictable proactive behavior.
- `TODO`:
  - Add template/workspace config schema for cronjob preset definitions.
  - Implement workspace bootstrap flow to materialize presets into core cronjob service.
  - Add idempotency and versioning behavior for preset re-sync/update.
  - Expose preset provenance in workspace metadata/logging.
- `Validation`:
  - Creating workspace from template auto-creates expected cronjobs.
  - Sync-template updates presets deterministically without duplicate jobs.
  - Tests verify disable/remove/update behavior for preset changes.

### T-004 (2026-03-03): Consolidate per-user quota/rate-limit enforcement and diagnostics in model proxy
- `Status`: pending
- `Background`:
  - Quota/rate governance is needed per user/tenant for cost control and fairness.
  - Model proxy should calculate and enforce quota per user before forwarding provider calls.
  - Current behavior lacks fully enforced per-user policy at model-proxy boundary.
  - Insufficient quota should return a clear typed error instead of surfacing as generic transport/runtime failures.
  - Upstream model-provider `429` behavior can surface as generic timeout/transport errors.
  - Current run failure output may hide the terminal cause.
- `TODO`:
  - Define per-user quota/rate-limit policy model (tokens, requests, burst windows).
  - Add per-user quota/rate-limit calculation and enforcement in model proxy request handling using user identity headers.
  - Return typed insufficient-quota and rate-limit error responses with actionable retry guidance.
  - Add explicit quota/rate-limit error classification in proxy and runner paths.
  - Map upstream `429` into typed terminal run failures.
  - Ensure runner/session terminal failures preserve quota/rate-limit error typing and message details.
  - Add budget/usage monitoring and alerting for gateway/provider utilization.
  - Add admin/observability visibility for usage, throttling events, limit hits, and remaining budget per user.
  - Define provider/model retry and timeout budgets.
- `Validation`:
  - Simulate exhausted user quota at model proxy and verify typed insufficient-quota response contract.
  - Simulate per-user request/token burst violations and verify stable throttling behavior under concurrent sessions.
  - Verify runner/session terminal failure preserves insufficient-quota typing and actionable message.
  - Simulate provider `429` and verify typed terminal error output.
  - Confirm fail-fast behavior with actionable message when quota is exhausted.
  - Validate observability dashboards show usage, rate/quota metrics, and limit hits per user.

### T-012 (2026-03-06): Refactor agent harness boundary and lifecycle
- `Status`: pending
- `Background`:
  - Harness behavior is spread across runtime execution paths and is hard to evolve safely.
  - Consistent harness interfaces are needed for long-term support of multiple runtimes/providers.
- `TODO`:
  - Define and document a stable harness interface (session, tools, streaming, lifecycle hooks).
  - Separate harness-specific codepaths from shared orchestration logic.
  - Add compatibility tests for existing harnesses (Agno/OpenCode) after refactor.
  - Add migration notes for future harness additions.
- `Validation`:
  - Existing harness integration tests pass with no behavior regressions.
  - New harness contract doc and typed interface are used by runtime executors.
  - Smoke tests verify streaming and tool invocation parity before/after refactor.

### T-014 (2026-03-06): Implement dynamic sandbox launch and suspend policy
- `Status`: pending
- `Background`:
  - Static lifecycle behavior can over-provision idle sandboxes and increase cost.
  - Runtime should launch/suspend based on usage patterns and workload signals.
- `TODO`:
  - Define policy inputs (idle time, queue depth, scheduled jobs, user activity).
  - Add policy-driven orchestration for automatic launch/resume/suspend transitions.
  - Add guardrails to avoid thrashing (cooldowns, minimum up/down windows).
  - Emit lifecycle decision telemetry with policy reasons.
- `Validation`:
  - Simulation/integration tests show expected launch/suspend decisions by policy.
  - Cost/uptime metrics improve versus static baseline.
  - No regressions in run latency for active users.
