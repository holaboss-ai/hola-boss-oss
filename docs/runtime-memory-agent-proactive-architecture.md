# Runtime, Memory, Agent, and Proactive Architecture

Last verified against:
- `hola-boss-oss-proactive` `feat/proactive` at `61e5aa3`
- supplemental `../hola-boss-ai` code as checked locally on the same machine

This document describes the current coded behavior of four connected components:
- local runtime persistence and memory
- agent execution and resume/compaction
- proactive task proposal generation and delivery
- desktop surfaces over those systems

It is intentionally based on implementation and tests, not `README.md`.

## System Boundary

There are three distinct runtime roles in the current system.

1. Desktop app
- Lives in `desktop/`
- Presents proposal, status, notification, and chat UI
- Talks to the embedded local runtime over Electron IPC
- Talks to the remote proactive control plane for scoped preferences, heartbeat config, and ingest

2. Local OSS runtime
- Lives in `runtime/api-server/` and `runtime/state-store/`
- Owns canonical local persistence in `state/runtime.db`
- Owns memory writeback, compaction artifacts, agent resume context, local task proposal storage, and accepted proposal execution
- Exposes `POST /api/v1/proactive/context/capture` for workspace context bundling
- Runs the bridge worker that polls remote proactive jobs and materializes them locally

3. Remote proactive service
- In the sibling repo `../hola-boss-ai`
- Ingests proactive events, runs the analyst, and decides which task proposals to emit
- Uses a bridge-backed proposal store, so created proposals are pushed back into the local OSS runtime instead of being durably owned in Python

The important architectural consequence is:
- proposal ideation is remote
- proposal persistence and execution are local
- memory continuity is local

## Canonical Local State

The source of truth for local runtime state is `state/runtime.db`, managed by `RuntimeStateStore` in `runtime/state-store/src/store.ts`.

The key entities for this area are:

- `memory_entries`
  - durable memory catalog metadata
  - type: `MemoryEntryRecord`
- `turn_request_snapshots`
  - request snapshots used by compaction/restoration
- `compaction_boundaries`
  - post-turn boundary artifacts and restoration context
- `turn_results`
  - per-run terminal state and linkage to compaction boundary ids
- `task_proposals`
  - locally materialized proactive proposals
- `memory_update_proposals`
  - user-scoped proposed updates that require explicit acceptance

Important implementation facts:

- `memory_entries` are application-governed, not database-constrained by rich CHECK rules.
- task proposals have no `updated_at` column; memory update proposals do.
- session linkage for compaction and memory-update proposals is enforced in code through `ensureSession(...)`, not foreign keys.

Relevant files:
- `runtime/state-store/src/store.ts`
- `runtime/state-store/src/store.test.ts`

## Memory Mechanism

### 1. Two different memory classes

The runtime splits memory into two lanes.

1. Runtime/session continuity files
- Written under `memory/workspace/<workspace-id>/runtime/...`
- Includes:
  - `session-state`
  - `blockers`
  - `latest-turn`
  - `recent-turns`
  - `session-memory`
  - `permission-blockers`
- These files support resume, inspection, and proactive context capture
- They are not persisted as `memory_entries`

2. Durable recalled memory
- Written as markdown plus catalog rows
- Workspace durable memory lives under `workspace/<workspace-id>/knowledge/...`
- User durable memory lives under `preference/` and `identity/`
- These entries are cataloged in `memory_entries`

Relevant files:
- `runtime/api-server/src/turn-memory-writeback.ts`
- `runtime/api-server/src/memory.ts`
- `runtime/api-server/src/memory-capture-views.ts`

### 2. Write path

Post-turn writeback is scheduled after turn results are committed.

High-level path:
- claimed input execution finishes
- turn result is written
- post-run tasks are scheduled
- `writeTurnMemory(...)` runs in the background

`writeTurnMemory(...)` currently does all of the following:
- compacts the turn summary
- loads recent turns and messages
- writes runtime continuity files
- derives heuristic durable workspace memories
- optionally accepts model-extracted durable candidates if confidence and evidence thresholds are met
- upserts `memory_entries` for durable candidates
- regenerates durable indexes:
  - `MEMORY.md`
  - `workspace/<id>/MEMORY.md`
  - `preference/MEMORY.md`
- writes the compaction boundary artifact even when durable-memory extraction fails

Current heuristic durable extraction covers:
- explicit command facts
- business facts
- procedures
- repeated permission blockers

Current user-scoped durable promotion does not happen automatically from model extraction.
User-scoped proposals are kept in the explicit acceptance lane instead.

Relevant files:
- `runtime/api-server/src/claimed-input-executor.ts`
- `runtime/api-server/src/post-run-tasks.ts`
- `runtime/api-server/src/turn-memory-writeback.ts`
- `runtime/api-server/src/turn-memory-writeback.test.ts`

### 3. Filesystem memory API

The local memory service is a built-in filesystem backend.

Allowed writable/readable paths are constrained to:
- `MEMORY.md`
- `workspace/<workspace_id>/*`
- `preference/*`
- `identity/*`

This path policy is enforced in code by `memory.ts`.

Important distinction:
- `memory.search` can scan markdown files including runtime files in workspace scope
- durable recall for prompt injection intentionally excludes `/runtime/` files

Relevant files:
- `runtime/api-server/src/memory.ts`
- `runtime/api-server/src/memory.test.ts`

### 4. Recall path

Recalled durable memory is loaded during TS runner bootstrap.

High-level path:
- load active workspace and user `memory_entries`
- dedupe by memory id, favor newer `updatedAt`
- build a manifest from durable markdown files
- exclude runtime files and index files
- select up to 5 entries
- merge manifest snippets with DB governance metadata and freshness state
- inject as `recalled_memory_context`

Recall uses:
- governance boosts by memory type
- freshness penalties
- query token matching and intent weighting
- selection budgets:
  - cap user-scoped entries when non-user entries exist
  - cap per-type concentration
  - semantic dedupe by subject/path

If manifest selection is unavailable or empty, the system falls back to DB-entry ranking.

Relevant files:
- `runtime/api-server/src/ts-runner.ts`
- `runtime/api-server/src/memory-recall.ts`
- `runtime/api-server/src/memory-recall-index.ts`
- `runtime/api-server/src/memory-recall-manifest.ts`
- `runtime/api-server/src/memory-recall.test.ts`

### 5. User memory proposals

User-scoped memory proposals are a separate workflow from durable writeback.

Creation:
- happens at queue time, right after the user message is inserted
- currently only detects:
  - response style preference
  - file delivery preference (`no zip`, `deliver individual files`)

Deduping:
- skips proposals already reflected in active durable user preference memory
- skips proposals already pending in `memory_update_proposals`

Prompt use:
- pending proposals for the same `workspace_id + session_id + input_id` are loaded into `pending_user_memory_context`

Promotion:
- only on explicit accept via `POST /api/v1/memory-update-proposals/:proposalId/accept`
- `preference` proposals become durable markdown + `memory_entries` rows + refreshed indexes
- `profile` proposals update the runtime profile, not markdown memory

Relevant files:
- `runtime/api-server/src/app.ts`
- `runtime/api-server/src/user-memory-proposals.ts`
- `runtime/api-server/src/ts-runner.ts`

### 6. Planned recall indexing direction

One future direction under consideration is a hybrid `sqlite-vec` retrieval index for recall.

The intended shape is:
- markdown memory files remain the content source of truth
- `memory_entries` remain the metadata/governance source of truth
- vector rows are derived/indexed data only
- vector search would be used to narrow recall candidates
- final recalled content would still be read from markdown leaves and assembled by the recall workflow

Important non-goal:
- this is not intended to replace post-run durable-memory extraction
- it is intended to improve the recall stage

## Agent Runtime and Resume

### 1. Terminal semantics

The runtime treats only these as terminal:
- `run_completed`
- `run_failed`

If the harness exits without emitting a terminal event, the runtime synthesizes `run_failed`.

That behavior exists in:
- runner worker
- claimed input executor
- queue worker lease recovery
- TS runner harness-host flow

Important consequences:
- terminal events are authoritative for session completion
- missing terminals are treated as failure, not success

Relevant files:
- `runtime/api-server/src/runner-worker.ts`
- `runtime/api-server/src/claimed-input-executor.ts`
- `runtime/api-server/src/queue-worker.ts`
- `runtime/api-server/src/ts-runner.ts`

### 2. Compaction and restoration

Post-turn writeback creates a compaction boundary artifact linked to the turn result.

Boundary contents include:
- boundary summary
- recent runtime context
- `compaction_source`
- `boundary_type`
- `restoration_order`
- `session_resume_context`
- `restored_memory_paths`
- preserved turn input ids

On the next run:
- the TS runner loads the latest prior compaction boundary
- converts it to session resume context
- merges session-memory excerpt if available
- emits `compaction_restored`
- injects the resulting resume context into runtime config

Relevant files:
- `runtime/api-server/src/turn-result-summary.ts`
- `runtime/api-server/src/turn-memory-writeback.ts`
- `runtime/api-server/src/ts-runner.ts`
- `runtime/api-server/src/agent-runtime-prompt.ts`

### 3. Prompt composition inputs

The agent runtime config currently receives these continuity/memory inputs:
- `recent_runtime_context`
- `session_resume_context`
- `recalled_memory_context`
- `current_user_context`
- `pending_user_memory_context`

Those become prompt sections and context messages, rather than being flattened into one opaque blob.

Relevant files:
- `runtime/api-server/src/agent-runtime-config.ts`
- `runtime/api-server/src/agent-runtime-prompt.ts`
- `runtime/api-server/src/ts-runner.ts`

## Proactive Task Proposal Pipeline

## 1. Local OSS runtime responsibilities

The local runtime does not currently generate proactive proposals on its own.

It does three proactive-related jobs:

1. Capture workspace context
- `POST /api/v1/proactive/context/capture`
- bundles workspace metadata, snapshot, memory capture, cronjobs, existing task proposals, and tool manifest

2. Persist and expose task proposals
- list all
- list unreviewed
- stream unreviewed inserts via SSE
- create
- patch state
- accept into a child `task_proposal` session

3. Run the bridge worker
- poll remote proactive bridge jobs
- execute `task_proposal.create` and memory/context jobs locally
- report results back to the remote service

Relevant files:
- `runtime/api-server/src/app.ts`
- `runtime/api-server/src/proactive-context.ts`
- `runtime/api-server/src/bridge-worker.ts`
- `runtime/api-server/src/bridge-worker.test.ts`

## 2. Remote proactive service responsibilities

The supplemental Python service in `../hola-boss-ai` is the current producer of proposals.

High-level path:
- events are ingested via `/api/v1/proactive/ingest`
- Redis stream consumer dispatches events to `StrategyAnalystAgent.analyze(...)`
- analyst tools call `generate_task_proposal(...)`
- proposal store is bridge-backed
- proposal creation is pushed to `/api/v1/proactive/bridge/jobs`
- local OSS runtime bridge worker materializes the proposal into local `task_proposals`

Important detail:
- the Python service does not durably own proposal persistence in the current architecture
- it emits bridge jobs
- the OSS runtime owns the durable local proposal row

Relevant files in `../hola-boss-ai`:
- `src/api/v1/proactive/routes/ingest.py`
- `src/proactive/consumer.py`
- `src/proactive/analyst/analyst_agent.py`
- `src/proactive/analyst/toolkits.py`
- `src/proactive/domain/action_store.py`
- `src/api/v1/proactive/routes/bridge.py`

## 3. Heartbeat behavior

Heartbeat is the main scheduled proactive mechanism.

Current remote heartbeat flow:
- heartbeat cron and workspace settings are scoped by `(holaboss_user_id, sandbox_id)`
- the orchestrator finds due schedules
- it filters enabled workspaces
- it emits heartbeat events back into proactive ingest
- the analyst handles heartbeat differently from reactive events

Current heartbeat-specific analyst behavior:
- computes a target proposal budget
- checks existing not-reviewed proposals
- skips heartbeat when too many proposals are already pending
- builds workspace snapshot/capabilities
- emits a zero-proposal outcome if no executable capabilities exist
- applies a planning policy that can ignore lower-scoring or over-capacity proposals
- writes heartbeat learning signals

Relevant files in `../hola-boss-ai`:
- `src/api/v1/proactive/routes/preferences.py`
- `src/api/v1/proactive/routes/heartbeat_cronjobs.py`
- `src/proactive/heartbeat/heartbeat_orchestrator.py`
- `src/proactive/heartbeat/heartbeat_job.py`
- `src/proactive/heartbeat/event_emitter.py`
- `src/proactive/analyst/analyst_agent.py`

## Desktop Surfaces

The desktop app is mostly a presentation and routing layer.

### 1. Local runtime-backed desktop flows

Desktop uses local runtime IPC for:
- unreviewed task proposal list
- task proposal accept
- task proposal patch state
- memory update proposal list
- memory update proposal accept/dismiss
- proactive status synthesis inputs

Important current behavior:
- task proposals are shown in the operations drawer inbox
- memory update proposals are shown in chat, scoped to the relevant run/input
- accepting a task proposal creates a child task-proposal session in local runtime

Relevant files:
- `desktop/electron/preload.ts`
- `desktop/electron/main.ts`
- `desktop/src/components/layout/AppShell.tsx`
- `desktop/src/components/layout/OperationsDrawer.tsx`
- `desktop/src/components/layout/ProactiveStatusCard.tsx`
- `desktop/src/components/panes/ChatPane.tsx`

### 2. Remote control-plane desktop flows

Desktop uses remote proactive control-plane calls for:
- proactive task proposal preference GET/POST
- heartbeat cron config GET/POST
- heartbeat workspace enablement
- manual proactive trigger ingest

Manual trigger is not a direct bridge demo.
It does:
- local `context/capture`
- remote proactive ingest with `captured_context`

### 3. Proactive status in desktop

Current desktop proactive status is computed locally in Electron main.

Inputs:
- count of local `task_proposals`
- latest local `event_log` heartbeat emit entry
- runtime process health/auth state

That means the desktop lifecycle card is not a canonical remote status API response.
It is a local synthesis over local state plus runtime readiness.

## Verified Checks

The current branch was verified after the merge and latest desktop follow-up commit with:

Runtime:
```sh
cd runtime/api-server
node --import tsx --test \
  src/memory.test.ts \
  src/memory-recall.test.ts \
  src/turn-memory-writeback.test.ts \
  src/app.test.ts \
  src/ts-runner.test.ts \
  src/bridge-worker.test.ts \
  src/agent-runtime-config.test.ts
```

Result:
- `109` passed
- `0` failed

Desktop:
```sh
cd desktop
node --test \
  electron/proactive-preference-fetch.test.mjs \
  src/components/layout/AppShell.test.mjs \
  src/components/layout/ProactiveStatusCard.test.mjs \
  src/components/panes/ChatPane.test.mjs
```

Result:
- `40` passed
- `0` failed

## Notable Current Caveats

1. Local proposal generation is still remote-dependent
- the OSS runtime captures context and stores proposals
- the Python proactive service still decides what to propose

2. Proposal persistence is intentionally split from proposal generation
- remote analyst emits bridge jobs
- local runtime owns the actual durable proposal row

3. There is still an old demo bridge endpoint in the Python service
- current desktop manual trigger does not use it
- current desktop uses heartbeat ingest with bundled captured context instead

4. One observed supplemental-code risk in `../hola-boss-ai`
- `StrategyAnalystAgent` fallback creation path appears to call `proposal_store.create(...)`
- in the current file this looks like it should likely be `self._proposal_store.create(...)`
- this is outside the local OSS repo, but it is relevant if the fallback path is exercised

Relevant file:
- `../hola-boss-ai/src/proactive/analyst/analyst_agent.py`

## Short Version

If you need the current architecture in one paragraph:

The local runtime owns durable local state, memory writeback, compaction/resume, proposal persistence, and accepted proposal execution. The desktop is a presenter/router over that runtime plus a remote proactive control plane. The remote proactive service ingests events, runs the analyst, and emits proposal bridge jobs back into the local runtime. Durable memory recall is file-and-catalog based, runtime continuity is file-based under `runtime/`, and user preference updates go through an explicit `memory_update_proposals` acceptance lane instead of being promoted automatically.
