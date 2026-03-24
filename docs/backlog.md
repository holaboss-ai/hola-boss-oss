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
- `Status`: pending
- `Background`:
  - The current runtime is Python-led across the agent API, harness execution, runtime-local state, CLI helpers, and packaging/bootstrap.
  - A full rewrite in one shot would couple harness changes, persistence changes, API changes, and packaging changes into a single high-risk migration.
  - The next step is to move agent harnesses to TypeScript first, then port the rest of the runtime behind stable contracts.
- `TODO`:
  - Freeze the current runtime event contract (`run_started`, deltas, tool calls, terminal events) and treat it as the compatibility boundary during migration.
  - Freeze the current runtime-local SQLite schema and treat DB compatibility as a separate concern from harness migration.
  - Document the target architecture: Python control plane first, TypeScript harness host second, then gradual control-plane replacement.
  - Define explicit migration phases, ownership boundaries, and rollback rules before implementation starts.
  - Keep desktop-facing API routes and SSE payloads stable until the TypeScript API replacement reaches parity.
- `Validation`:
  - The migration plan identifies which Python modules stay authoritative in each phase and which new TypeScript modules replace them.
  - Runtime events, persisted session bindings, and desktop API responses are explicitly called out as compatibility contracts.
  - Each later migration task can reference this entry as the sequencing source of truth.

### T-028 (2026-03-24): Move OpenCode harness execution into a TypeScript harness host
- `Status`: pending
- `Background`:
  - The current harness seam already exists, but `opencode` execution, session management, config persistence, and event mapping are still embedded in
    [runtime/src/sandbox_agent_runtime/runner.py](/Users/jeffrey/Desktop/hola-boss-oss/runtime/src/sandbox_agent_runtime/runner.py).
  - OpenCode is the lowest-risk harness to move first because it is already the default non-OSS path and has extensive Python tests.
  - Moving OpenCode first proves the TypeScript harness-host boundary without forcing a full runtime rewrite.
- `TODO`:
  - Create a bundled TypeScript `harness-host` package under `runtime/` with a small JSONL stdio protocol for `run`, event streaming, and terminal status.
  - Keep Python responsible for workspace runtime-plan compilation, workspace MCP sidecar startup, application lifecycle startup, and runtime-state persistence.
  - Port OpenCode-specific logic out of the Python runner:
    - provider/model config writing
    - OpenCode session create/existence/reuse handling
    - OpenCode event stream reads
    - OpenCode event normalization into runtime output events
  - Make the Python runner invoke the TypeScript harness host behind a feature flag while preserving current event payloads.
  - Persist any harness-session replacement emitted by the TypeScript host back into the existing runtime-local binding tables.
  - Add parity tests comparing Python and TypeScript OpenCode execution paths.
- `Validation`:
  - OpenCode runs can execute entirely through the TypeScript harness host while desktop clients observe unchanged runtime events and SSE payloads.
  - Harness session replacement/recovery behavior still updates `harness_session_id` correctly.
  - Existing OpenCode runner tests have TypeScript-path coverage for session reuse, stream mapping, and terminal failures.

### T-029 (2026-03-24): Port runtime local state and event persistence to TypeScript
- `Status`: pending
- `Background`:
  - Runtime-local SQLite state underpins workspaces, session bindings, queue items, runtime state, outputs, cronjobs, and task proposals.
  - Rewriting the API before the persistence layer would either duplicate business logic or force unstable cross-language ownership.
  - After the harness host exists, the next stable seam is the persistence layer.
- `TODO`:
  - Reimplement the runtime-local database access layer in TypeScript against the existing schema first.
  - Preserve table names, indexes, and payload shapes before making any schema changes.
  - Move queue-claim helpers, output event append/list behavior, session history reads, and binding upserts into the TypeScript layer.
  - Introduce side-by-side compatibility tests against the existing Python implementation for representative DB operations.
  - Leave the Python API in place temporarily, calling into the TypeScript state layer only after parity is demonstrated.
- `Validation`:
  - TypeScript persistence code can read and write the existing runtime DB without requiring a schema migration.
  - Session bindings, output events, and runtime-state transitions match current Python behavior for the same inputs.
  - Mixed Python and TypeScript phases can safely share the same local database during rollout.

### T-030 (2026-03-24): Replace FastAPI runtime endpoints with a TypeScript API service
- `Status`: pending
- `Background`:
  - The current FastAPI app exposes workspace, agent-session, memory, cronjob, task-proposal, lifecycle, and app-management endpoints.
  - Desktop currently assumes that route surface and payload shape, so the API migration must preserve compatibility while the implementation moves.
  - Once harness execution and persistence are in TypeScript, the API can move with much lower risk.
- `TODO`:
  - Recreate the current runtime API surface in TypeScript with route and payload compatibility as the first goal.
  - Preserve existing SSE and long-poll response shapes used by the desktop app.
  - Keep Python API startup available as a fallback until endpoint parity is demonstrated.
  - Move workspace/session queue handling and stream fanout to TypeScript after local-state parity is in place.
  - Add endpoint parity coverage for the highest-risk routes:
    - session queue
    - output event/history reads
    - workspace CRUD
    - runtime status/config
    - lifecycle control
- `Validation`:
  - The desktop app can talk to the TypeScript API without route or payload changes.
  - Existing session queueing, output streaming, and runtime-status flows behave the same against the TypeScript API.
  - Python FastAPI can be disabled without regressions in primary desktop workflows.

### T-031 (2026-03-24): Port runtime CLI and workflow helpers to TypeScript
- `Status`: pending
- `Background`:
  - The `hb` CLI currently exposes runtime info, memory commands, onboarding helpers, and cronjob-related workflow helpers.
  - Those commands are part of the runtime contract used by agents and bootstrap scripts, so they need a stable replacement before Python can be removed.
- `TODO`:
  - Recreate the `hb` CLI surface in TypeScript with argument and JSON-output compatibility first.
  - Port runtime info, memory commands, onboarding helpers, and cronjob helper flows incrementally.
  - Preserve current command names, default values, and error payload conventions during the transition.
  - Update harness-host and runtime bootstrap flows to use the TypeScript CLI only after parity is reached.
- `Validation`:
  - Existing CLI invocations return equivalent JSON payloads and exit codes from the TypeScript implementation.
  - Agents can continue calling `hb` commands without prompt or workflow changes.
  - Python CLI entrypoints can be removed only after all currently used commands have TypeScript replacements.

### T-032 (2026-03-24): Replace Python-led runtime packaging and bootstrap with a TypeScript runtime bundle
- `Status`: pending
- `Background`:
  - Runtime bundle assembly, packaged Python installation, and bootstrap startup are currently centered around Python.
  - Packaging should be the last migration step, once harness, state, API, and CLI ownership have already moved.
  - Flipping packaging too early would force operational changes while the runtime internals are still in flux.
- `TODO`:
  - Update runtime bundle assembly to package the TypeScript runtime and harness host as first-class artifacts.
  - Remove mandatory bundled Python once no runtime entrypoint or fallback path depends on it.
  - Replace Python bootstrap scripts with TypeScript/Node bootstrap commands while preserving current environment-variable contracts where possible.
  - Update desktop runtime detection and staging to treat the TypeScript runtime bundle as canonical.
  - Keep an explicit rollback path until packaged desktop and local-dev flows are stable on the new bundle.
- `Validation`:
  - Local dev, packaged desktop, and release-built runtime bundles can start the TypeScript runtime without Python.
  - Desktop runtime staging and health checks work unchanged from the user’s perspective.
  - Python packaging assets can be deleted only after release pipeline parity is confirmed.


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
  - Current no-op implementation lives at
    `src/services/cronjobs/cronjob_runner.py::_default_system_notification_executor`.
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
