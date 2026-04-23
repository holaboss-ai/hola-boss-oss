# Runtime Post-Run Evolve Stage

Last verified against:
- current branch at `a14f6b8`
- code in `runtime/api-server/src/*.ts`
- tests in `runtime/api-server/src/evolve.test.ts` and `runtime/api-server/src/turn-memory-writeback.test.ts`

This document describes the current coded behavior of the post-run evolve stage.

It is intentionally based on implementation and tests, not older architecture notes.

## Scope

This covers:

- when evolve work is triggered after a run
- what happens inline versus in the background worker
- how durable memory writeback currently works
- how evolve skill candidates are drafted, proposed, accepted, and promoted

This does not try to describe the full recall system or the separate checkpoint job in detail.

## Short Version

Current post-run evolve behavior is:

1. a run finishes and `turn_results` is persisted as deterministic execution/observability state
2. if this run is an accepted evolve review session and it completed successfully, the candidate skill may be promoted inline
3. the executor then runs `runEvolveTasks(...)`
4. today that function only enqueues a background `evolve` post-run job when `memoryService` exists
5. the evolve worker later claims that job and performs:
   - durable memory writeback
   - skill-candidate review

Important current constraint:

- the inline post-run path does not write runtime continuity or `runtime/session-memory` files as part of evolve
- the heavy memory and skill-review work happens in the background worker

## End-To-End Flow

### 1. Foreground run completion

In `processClaimedInput(...)`, once the executor has persisted the turn result, it does three adjacent post-run actions:

1. best-effort inline promotion for accepted evolve candidates
2. `runEvolveTasks(...)`
3. enqueue of the separate checkpoint job

Relevant file:

- `runtime/api-server/src/claimed-input-executor.ts`

Important detail:

- evolve task execution is awaited on both the normal completion path and the executor-error path
- in practice that means the runtime will still attempt to queue post-run evolve work even when the executor itself fails, as long as the turn result was persisted and `memoryService` is available

### 2. Inline promotion path for accepted evolve proposals

Before queueing background evolve work, the executor checks whether the just-finished run was a task proposal review session for an evolve candidate.

The promotion check requires:

- `turnResult.status === "completed"`
- `record.payload.context.source === "task_proposal"`
- `record.payload.context.proposal_source === "evolve"`
- `record.payload.context.evolve_candidate.candidate_id` to be present

If those conditions match, `promoteAcceptedSkillCandidate(...)` runs inline.

That function:

- loads the candidate from the state store
- requires candidate status `accepted`
- resolves the target live path as `skills/<slug>/SKILL.md`
- reads the draft either from memory-service storage or from a misplaced local file under `evolve/`
- writes the live skill into the workspace `skills/` namespace
- removes misplaced `evolve/` artifacts if needed
- marks the candidate `promoted`

Important detail:

- this inline promotion is separate from the background evolve worker
- it only applies to accepted evolve skill proposals, not ordinary completed turns

## The Evolve Task Layer

`runEvolveTasks(...)` is a thin task runner. Today it has a single default task: `turn_memory_evolve`.

That task:

- runs only when `memoryService` is present
- enqueues one `post_run_jobs` row with `jobType = "evolve"`
- uses `inputId` as the idempotency boundary
- passes through any optional writeback instruction from the model context
- wakes the evolve worker if a wake callback was provided

Current idempotency behavior:

- key: `evolve:<inputId>`
- legacy keys for old durable-memory job names are also checked before creating a new row

Relevant files:

- `runtime/api-server/src/evolve-tasks.ts`
- `runtime/api-server/src/evolve.ts`

## The Background Evolve Worker

`RuntimeEvolveWorker` drains queued post-run jobs.

Current defaults:

- claimed by: `evolve-worker`
- lease: 300 seconds
- poll interval: 1000 ms
- max concurrency: 1 by default
- max attempts: 3
- retry delay: 5000 ms

Behavior:

- claims queued post-run jobs from `post_run_jobs`
- processes at most one session at a time
- marks successful jobs `DONE`
- requeues failures with incremented attempt count
- marks a job `FAILED` once the attempt limit is reached
- recovers expired claimed jobs and requeues or fails them the same way

Relevant file:

- `runtime/api-server/src/evolve-worker.ts`

## What `processEvolveJob(...)` Actually Does

Once a queued evolve job is claimed, `processEvolveJob(...)` performs two steps in order:

1. `writeTurnDurableMemory(...)`
2. `reviewTurnForSkillCandidate(...)`

The worker accepts:

- current `evolve`
- legacy `reinforce_memory_writeback`
- legacy `durable_memory_writeback`

It fails if the referenced `turn_result` cannot be found.

## Durable Memory Writeback

### Always-on parts

`writeTurnDurableMemory(...)` always starts by:

- reconstructing semantic turn artifacts from persisted session messages and output events
  - current assistant text
  - current permission denials
  - recent compact turn summaries
- loading recent turns for the same workspace session
- loading recent user messages for the same workspace session

That context then feeds durable candidate generation.

Important detail:

- the compacted summary used here is ephemeral background-writeback context
- it is not written back into `turn_results`
- queued evolve/writeback does not treat `turn_results` as the semantic source of truth for prompts or model context

### Heuristic durable candidates

Current deterministic extraction produces workspace-scoped durable memories for:

- command facts
- business facts
- procedures
- repeated permission blockers

Current repeated permission blocker rule:

- the same denial must recur at least 2 times across recent turns before it becomes a durable blocker candidate

Output locations currently include:

- `workspace/<workspace-id>/knowledge/facts/*.md`
- `workspace/<workspace-id>/knowledge/procedures/*-procedure.md`
- `workspace/<workspace-id>/knowledge/blockers/*.md`

### Optional model-assisted durable candidates

If a background-task memory model is configured, the evolve job may also ask the model for durable memory candidates.

Current cadence:

- every 5 completed turns in the session

Current acceptance thresholds:

- standard: confidence `>= 0.82` and evidence length `>= 36`
- corroborated by a heuristic candidate: confidence `>= 0.6` and evidence length `>= 16`

Current safety boundary:

- model-extracted user-scoped memories are skipped in this queued evolve path
- this path does not auto-promote durable preference or profile memory

### Persistence and indexes

Accepted durable candidates are:

- written to markdown through the memory service
- upserted into `memory_entries`
- followed by selective index refresh only for scopes that changed

Current indexes:

- `MEMORY.md`
- `workspace/<workspace-id>/MEMORY.md`
- `preference/MEMORY.md`
- `identity/MEMORY.md`

Important detail:

- if no durable candidates are found, the function returns without generating indexes

## Skill Candidate Review

After durable memory writeback, the evolve job optionally reviews the turn for a reusable workspace-local skill candidate.

### Review cadence and prerequisites

Skill review only runs when:

- a background model client exists
- the session has reached the review cadence

Current cadence:

- every 3 completed turns in the session

Current minimum confidence:

- `0.72`

Current prompt inputs for skill review are reconstructed from persisted artifacts:

- assistant response text from `output_delta` events or the persisted assistant message
- tool usage from `tool_call` events
- permission denials from `tool_call` events
- recent summaries rebuilt from persisted artifacts, not from `turn_results`

If review is not due, there is no model, the candidate is too weak, or the result duplicates an existing skill or active candidate, nothing more happens.

### Candidate drafting

When a candidate is accepted for drafting, the system:

- chooses `skill_create` or `skill_patch`
- normalizes the slug
- renders a draft `SKILL.md`
- writes that draft into memory-service storage at:
  - `workspace/<workspace-id>/evolve/skills/<candidate-id>/SKILL.md`
- creates an `evolve_skill_candidates` row in the state store

The initial persisted candidate is a draft, not a live workspace skill.

### Proposal creation

If the draft candidate is new and has not already been proposed, accepted, or promoted, evolve creates a `task_proposals` row with:

- `proposalSource = "evolve"`
- a generated proposal id derived from the candidate id
- a review-oriented prompt telling the reviewer to promote only into `skills/<slug>/SKILL.md`
- rationale from `evaluationNotes` when available

The linked skill candidate is then updated to:

- `status = "proposed"`
- `taskProposalId = <generated proposal id>`
- `proposedAt = now`

## Accepted Proposal Lifecycle

Once an evolve task proposal is accepted through the API, the runtime:

- creates a `task_proposal` session
- enqueues an input for that session
- injects `context.evolve_candidate` into the input payload
- loads the draft markdown and includes it in that context
- marks the linked candidate `accepted`

That review run is then handled like any other queued input.

When the accepted review run later finishes successfully, the inline promotion path described above promotes the draft into live workspace `skills/`.

If the proposal is dismissed instead:

- the linked candidate is marked `dismissed`

## Current Status Model

The practical candidate lifecycle is:

1. `draft`
2. `proposed`
3. `accepted` or `dismissed`
4. `promoted`

Important detail:

- accepted candidates do not become live automatically at proposal-accept time
- they become live only after the accepted review run completes and the inline promotion check succeeds

## Current Non-Behavior

The current implementation does not do the following as part of the evolve stage:

- it does not inline heavy durable memory extraction during normal foreground run completion
- it does not write `runtime/session-memory` as part of `writeTurnDurableMemory(...)`
- it does not auto-promote user preference memory or runtime profile updates from queued evolve
- it does not auto-activate drafted workspace skills without proposal review and accepted promotion flow

## Key Files

- `runtime/api-server/src/claimed-input-executor.ts`
- `runtime/api-server/src/evolve-tasks.ts`
- `runtime/api-server/src/evolve.ts`
- `runtime/api-server/src/evolve-worker.ts`
- `runtime/api-server/src/turn-memory-writeback.ts`
- `runtime/api-server/src/evolve-skill-review.ts`
- `runtime/api-server/src/app.ts`

## Key Tests

- `runtime/api-server/src/evolve.test.ts`
- `runtime/api-server/src/turn-memory-writeback.test.ts`

The most important current test assertions for this topic are:

- a completed turn queues durable memory work and leaves durable files absent until the evolve worker runs
- `writeTurnDurableMemory(...)` does not mutate `turn_results` summaries and does not write runtime continuity files
- accepted evolve proposal review runs promote the candidate into the live workspace `skills/` folder
