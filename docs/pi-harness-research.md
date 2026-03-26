# Pi Harness Research

## Goal

Map how to add `pi` as a third harness in the runtime and clarify whether it can replace the current `opencode` path.

## Repositories And Sources Reviewed

- Pi monorepo: <https://github.com/badlogic/pi-mono>
- Pi coding agent README: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md>
- Pi RPC docs: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md>
- Pi JSON mode docs: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/json.md>
- Pi session format docs: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md>
- Pi SDK docs: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md>
- Pi extensions docs: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md>

## Main Findings

### 1. Use Pi RPC, Not The SDK

Pi supports both:

- an in-process TypeScript SDK via `createAgentSession()`
- a subprocess RPC mode via `pi --mode rpc`

For this runtime, RPC is the better fit.

Reasoning:

- the runtime already orchestrates harnesses from TypeScript through subprocess boundaries
- the SDK would couple Pi more tightly to the runtime process than the existing harness model requires
- Pi explicitly documents RPC as the non-Node integration path
- RPC already exposes prompting, streaming, session state, session switching, compaction, and tool execution events over JSONL

Conclusion:

- implement the `pi` harness through `pi --mode rpc`
- do not build the first version around the TypeScript SDK

### 2. Pi Is Not OpenCode-Compatible On MCP

Pi core is intentionally minimal. Its README explicitly states:

- no built-in MCP
- MCP support must be added through extensions or packages

This answers the main backlog question:

- `pi` is not a drop-in replacement for `opencode` for MCP/tool integration

Implication:

- a first `pi` harness can work with Pi built-in tools only
- full parity requires a Pi extension/package layer that wraps current workspace MCP tools

### 3. Pi Already Has A Strong Session Model

Pi sessions are stored as JSONL files with a tree structure.

Relevant properties:

- session persistence is file-based
- sessions can be reopened by file path
- sessions support branching/forking and compaction
- RPC mode exposes session state and message retrieval

This maps well to the current runtime seam, but not in the same shape as OpenCode.

Recommended mapping:

- treat `harness_session_id` as a Pi session file path, or
- keep a tiny runtime-managed mapping from opaque ID to Pi session file path

For the first implementation, using the session file path directly is the simplest option.

### 4. Pi RPC Surface Is Sufficient For A First Harness

Pi RPC uses strict LF-delimited JSONL over stdin/stdout.

Important commands:

- `prompt`
- `abort`
- `get_state`
- `get_messages`
- `new_session`
- `switch_session`
- `fork`
- `compact`
- `set_model`

Important streamed events:

- `agent_start`
- `turn_start`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `turn_end`
- `agent_end`

This is enough to implement runtime event translation without an HTTP sidecar.

## Recommended Runtime Design

### Harness Shape

Add `pi` as a third harness in:

- [runner-worker.ts](/Users/jeffrey/Desktop/holaboss/typescript-migration/runtime/api-server/src/runner-worker.ts)
- [ts-runner.ts](/Users/jeffrey/Desktop/holaboss/typescript-migration/runtime/api-server/src/ts-runner.ts)

`pi` should be implemented as a spawned subprocess, not as an HTTP service.

### Session Mapping

For `pi`, maintain one runtime session file per harness session.

Recommended first pass:

- store Pi session files under the runtime state directory for the workspace
- reuse the file across runs
- pass the file path to Pi via `--session <path>`
- persist that path as the `harness_session_id`

This avoids trying to emulate OpenCode session IDs unnecessarily.

### Event Mapping

Map Pi RPC events into existing runtime events:

- `message_update` text deltas -> `output_delta`
- `message_update` thinking deltas -> `thinking_delta`
- `tool_execution_start/update/end` -> `tool_call`
- `agent_end` -> `run_completed`
- RPC/process/protocol failures -> `run_failed`

Open question for implementation:

- whether `tool_execution_update` should surface as incremental tool payloads or be collapsed into start/end behavior only

### Readiness Model

Pi does not need OpenCode-style sidecar readiness checks.

Recommended `pi` readiness definition:

- Pi binary exists and is executable
- minimal startup command succeeds, or
- runtime marks it as configured/available based on binary discovery alone

The TS runtime API should not reuse the current `/mcp`-based readiness logic for `pi`.

## Proposed Delivery Plan

### Phase 1: Thin Pi Harness

Ship a working but reduced `pi` harness that uses Pi built-in tools only.

Scope:

- add `pi` to `_SUPPORTED_HARNESSES`
- add `_execute_request_pi(request)`
- spawn `pi --mode rpc --session <path>`
- send `prompt`
- stream and map RPC events
- persist/reuse the Pi session path
- add API/runtime-status handling for `pi`
- add tests for:
  - harness selection
  - session creation/reuse
  - stream mapping
  - terminal completion/failure behavior

This phase validates that Pi works as a harness at all.

### Phase 2: Tool Parity Layer

Add a Pi extension/package strategy for current workspace capabilities.

Likely direction:

- generate or stage a project-local `.pi` extension/package
- register wrapper tools that call current workspace MCP-backed functionality
- map workspace skills/commands into Pi-compatible resources where possible

This is the parity work required before changing defaults.

## Why Not Start With The SDK

Using the Pi SDK from this runtime would mean:

- embedding the Pi SDK directly into the runtime process instead of keeping the existing subprocess harness boundary
- creating a custom bridge for events and session control
- carrying more packaging and operational complexity than the RPC approach

Because Pi already ships a documented subprocess RPC mode for non-Node integrations, the SDK is the wrong first integration path here.

## Repo-Specific Integration Notes

Current local integration points:

- [runner-worker.ts](/Users/jeffrey/Desktop/holaboss/typescript-migration/runtime/api-server/src/runner-worker.ts)
- [ts-runner.ts](/Users/jeffrey/Desktop/holaboss/typescript-migration/runtime/api-server/src/ts-runner.ts)
- [app.ts](/Users/jeffrey/Desktop/holaboss/typescript-migration/runtime/api-server/src/app.ts)
- [shared.sh](/Users/jeffrey/Desktop/holaboss/typescript-migration/runtime/deploy/bootstrap/shared.sh)

Important implementation note:

- the API currently seeds `harness_session_id` before execution
- if the runner creates or replaces a harness session during execution, that replacement needs to be persisted back to local binding state
- this matters for `pi` too, especially if session files are created lazily

## Decision Summary

- Add `pi` as an optional harness.
- Implement it over Pi RPC, not the SDK.
- Do not assume MCP parity.
- Ship a thin built-in-tools version first.
- Add a Pi extension/package layer later if full workspace MCP parity is required.
