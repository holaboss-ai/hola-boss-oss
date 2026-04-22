# PI Harness Prompt Boundary

This document describes the prompt-facing boundary between the shared runtime contract and the `pi` harness host.

Use it when you need to decide whether a behavior belongs in:

- `runtime/api-server`, where the runtime defines agent behavior that should apply across harnesses
- `runtime/harness-host/src/pi.ts` and related PI host helpers, where the `pi` path serializes that behavior into a PI-native request shape or enforces PI-local execution rules

## Runtime-Owned Prompt Contract

The runtime owns the parts of the prompt that should stay consistent even if the harness changes.

That includes:

- the base workspace instructions from `AGENTS.md`
- execution doctrine and response-delivery policy
- todo continuity policy
- session-memory-backed resume context
- scratchpad metadata and scratchpad usage guidance
- recalled durable memory
- current-user context
- operator-surface context
- pending user-memory proposals
- capability policy derived from the run's tool and MCP surface
- runtime-backed tool semantics for `todoread`, `todowrite`, `skill`, `web_search`, `write_report`, scratchpad tools, onboarding tools, cronjob tools, and image generation
- quoted workspace-skill preparation from leading `/skill-id` lines in the user instruction

The shared sources of truth are:

- `runtime/api-server/src/agent-runtime-prompt.ts`
- `runtime/api-server/src/agent-runtime-config.ts`
- `runtime/api-server/src/workspace-skills.ts`
- `runtime/api-server/src/runtime-agent-tools.ts`
- `runtime/api-server/src/native-web-search.ts`

If a rule changes how the agent should plan, continue work, use memory, or decide between tools independent of harness, it belongs here.

## What PI Owns

The PI host keeps the parts of the execution boundary that are specific to the PI request shape or to PI-managed local tool state.

### Prompt payload construction

`runtime/harness-host/src/pi.ts` owns `buildPiPromptPayload(...)`.

That function turns the already-prepared runtime request into the PI prompt body by concatenating:

1. runtime-prepared `quoted_skill_blocks`
2. a missing-skill warning when `missing_quoted_skill_ids` is non-empty
3. the cleaned user instruction
4. a `Runtime context:` block that wraps each runtime `context_message`
5. attachment-derived prompt sections returned by `attachment-prompt-content.ts`

This is transport and serialization logic. It is not the source of truth for prompt semantics.

### Attachment projection

`runtime/harness-host/src/attachment-prompt-content.ts` owns how staged attachments become PI prompt content.

It is responsible for:

- extracting inline text from common document formats such as PDF, DOCX, PPTX, and spreadsheets
- keeping image attachments separate so they can be passed as image content rather than flattened into text
- producing the human-readable attachment sections that `buildPiPromptPayload(...)` appends to the PI request body

The runtime decides which attachments belong to the run. The PI host decides how those attachments are encoded for PI.

### Runtime-tool packaging

`runtime/harness-host/src/pi-runtime-tools.ts` owns PI `ToolDefinition` wrappers for runtime-backed tools.

This layer is responsible for:

- PI-native parameter schemas
- PI-specific tool descriptions and usage guidance
- HTTP proxying to the runtime capability endpoints
- attaching workspace, session, input, and model metadata to runtime-tool calls

The underlying tool behavior still comes from the runtime. PI only packages and forwards those tool calls.

### Skill widening over PI-managed tools

The `skill` tool itself is runtime-backed, but PI still owns local widening enforcement for PI-managed tools and commands.

That logic lives in `runtime/harness-host/src/pi.ts` and is built from the runtime-provided `workspace_skills` manifests.

PI keeps:

- the live widening state for the run
- wrappers that deny managed tools or commands until a skill grants them
- application of granted tools and commands returned by the runtime-backed `skill` call
- `skill_invocation` event mapping for the PI event stream

This remains host-local because it governs PI-managed tool wrappers, not the shared meaning of a skill.

### MCP materialization for PI

The runtime prepares `mcp_servers` and any explicit `mcp_tool_refs`.

The PI host still owns:

- building PI MCP server bindings from that prepared payload
- discovering tools from those configured servers
- constraining servers that have explicit `mcp_tool_refs`
- exposing the discovered tool set to the PI session

This is part of host-side tool materialization, not prompt policy.

## What Stays Outside Prompt Semantics But Remains PI-Local

The `pi` path also owns several execution details that are not really prompt semantics at all:

- PI session creation and persisted harness session reuse
- PI-native post-run compaction
- provider-specific reasoning normalization
- local coding tools from the PI SDK
- workspace-boundary enforcement wrappers around PI-managed local tools
- native event normalization back into the runtime event contract

Those are part of the harness host, but they are separate from the shared runtime prompt contract.

## Boundary Rule

Use this rule when deciding where a change belongs:

- If the change affects what the agent should know, prioritize, remember, or do across harnesses, implement it in the runtime.
- If the change affects how the PI host serializes prompt content, wraps PI-local tools, or maps PI-native events, keep it in the PI host.

That boundary keeps the runtime as the owner of agent behavior and keeps the harness host as the owner of transport, projection, and PI-local enforcement.
