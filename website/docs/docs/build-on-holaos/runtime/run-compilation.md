# Run Compilation

Use this page when you are changing how workspace files become the reduced execution package the harness host actually receives.

The source of truth is:

- `runtime/api-server/src/workspace-runtime-plan.ts`
- `runtime/api-server/src/runner-prep.ts`
- `runtime/api-server/src/ts-runner.ts`
- `runtime/api-server/src/agent-runtime-config.ts`
- `runtime/api-server/src/harness-registry.ts`

## The Current Compile Path

For the shipped path, a run moves through these stages:

1. collect the workspace references the runtime needs
2. compile `workspace.yaml` plus those references into a `CompiledWorkspaceRuntimePlan`
3. stage runtime-owned capability surfaces such as browser tools, runtime tools, MCP, skills, and commands
4. load recent runtime context, session resume context, recalled memory, operator surface context, and pending user-memory proposals
5. project the final runtime config passed into the harness
6. build the harness-host request, persist a sanitized request snapshot, and launch the host

If you patch the wrong stage, the system usually still builds but exposes the wrong tools, prompt layers, or runtime context.

## Stage 1: Collect Workspace References

`compileWorkspaceRuntimePlanFromWorkspace()` in `runner-prep.ts` starts from the workspace directory:

- reads `workspace.yaml`
- calls `collectWorkspaceRuntimePlanReferences()`
- loads the referenced files from disk
- passes everything into `compileWorkspaceRuntimePlan()`

Today the reference collection is intentionally narrow:

- `AGENTS.md`
- every `applications[].config_path` from `workspace.yaml`

That means app manifests are runtime-plan inputs, but arbitrary workspace files are not unless later code stages them explicitly.

## Stage 2: Compile `workspace.yaml`

`compileWorkspaceRuntimePlan()` turns the authored workspace contract into a structured plan with:

- `general_config`
- `resolved_prompts`
- `resolved_mcp_servers`
- `resolved_mcp_tool_refs`
- `workspace_mcp_catalog`
- `resolved_applications`
- `mcp_tool_allowlist`
- `config_checksum`

This is the runtime-owned interpretation of the authored workspace, not a loose YAML parse.

## Strict Runtime-Plan Rules

`workspace-runtime-plan.ts` is intentionally strict. Current important rules:

- `workspace.yaml` must parse to a mapping object
- `mcp_registry` is required
- `tool_registry` is explicitly unsupported
- allowlisted MCP tool ids must be `server.tool`
- `mcp_registry.servers.workspace` must be local
- `applications` must be a list of mappings
- `applications[].app_id` must be unique
- `applications[].config_path` must resolve to an app manifest in the workspace references
- each `app.runtime.yaml` `app_id` must match the declared `app_id`
- each resolved app manifest must declare `mcp.port`

If you are changing config shape, start here before you touch the harness or desktop.

## Stage 3: Prepare Runtime-Owned Capability Surfaces

`ts-runner.ts` does not hand the compiled plan straight to the harness.

Before the harness launch it also:

- stages browser tools through the selected harness plugin
- stages runtime tools through the selected harness plugin, including runtime-owned mutate paths such as `write_report`
- resolves workspace skills
- optionally stages skills and workspace commands depending on the runner prep plan
- maps logical MCP server ids to physical server ids with `mcpServerIdMap()`
- starts the workspace MCP sidecar when `workspace_mcp_catalog` is non-empty
- bootstraps resolved applications and merges app-provided MCP servers into the prepared MCP payloads

This is where runtime-owned tool visibility stops being a static config file and becomes a run-specific capability surface.

## Stage 4: Load Runtime Context

The runner then loads the context that is specific to this run:

- recent runtime context from turn results or compaction boundaries
- session resume context from artifacts, compaction boundaries, and session-memory files
- recalled memory context from the memory registry and vector recall path
- current user profile context
- operator surface context from the desktop browser capability base URL when desktop browser tooling is active
- pending user-memory proposals for the current input

Those inputs come from both filesystem state and `runtime.db`. They are runtime-owned context, not authored workspace config.

## Stage 5: Project Agent Runtime Config

`buildAgentRuntimeConfigRequest()` and `projectAgentRuntimeConfig()` turn the compile output plus staged context into the final runtime config.

Important outputs include:

- `system_prompt`
- `prompt_sections`
- `prompt_layers`
- `prompt_cache_profile`
- `model_client`
- `tools`
- `workspace_tool_ids`
- `workspace_skill_ids`
- `output_schema_member_id`
- `output_format`
- `workspace_config_checksum`
- `capability_manifest`

This is also where response-delivery guidance and operator surface context become prompt-visible context for the run. If the harness sees the wrong tools, wrong prompt layers, wrong selected model, or wrong output schema, this is usually the page and code seam you wanted.

Model selection and reasoning effort split here:

- the queued input can carry a selected `model`
- `projectAgentRuntimeConfig()` resolves that into `provider_id`, `model_id`, and `model_client`
- the queued input can also carry `thinking_value`, but that value is not folded into `runtime-config.json` or the projected model client

That separation is intentional. The runtime owns model routing, while the harness host owns executor-specific reasoning controls.

## Stage 6: Build the Harness Request and Snapshot It

After runtime config projection, the harness adapter builds the host request.

`ts-runner.ts` then:

- computes a request fingerprint
- measures the `persist_turn_request_snapshot` bootstrap stage and calls `persistTurnRequestSnapshot()`
- persists a sanitized `turn_request_snapshot` in `runtime.db`
- carries request-scoped execution metadata such as `thinking_value` into the reduced host request alongside the resolved model client
- includes MCP server mapping metadata and bootstrap timing details in the run-started payload
- launches the harness host with the reduced request payload

That snapshot is the runtime’s replay and debugging seam. It is how the system preserves what was actually sent across the execution boundary.

## Change the Right File

- Change `workspace-runtime-plan.ts` when you are changing authored config parsing, validation, MCP registry rules, or app-manifest resolution.
- Change `runner-prep.ts` when you are changing workspace reference loading, MCP payload shaping, or logical-to-physical MCP server mapping.
- Change `ts-runner.ts` when you are changing bootstrap order, sidecar/app startup timing, context loading, request snapshots, or the handoff into the harness host.
- Change `agent-runtime-config.ts` when you are changing prompt composition, capability manifests, selected model behavior, or output-schema projection.

## Debugging Tips

- `workspace_config_checksum` changing unexpectedly usually means the authored workspace input changed, not the harness.
- Missing MCP tools often come from `mcp_registry` compile rules or server-id mapping, not from the host implementation.
- Ambiguous `here`, `this page`, or `what am I looking at` behavior usually comes from operator surface context loading, not from `workspace.yaml`.
- Wrong prompt context often comes from runtime context loading or `projectAgentRuntimeConfig()`, not from `workspace.yaml`.
- Wrong reasoning effort usually comes from the queued `thinking_value`, catalog metadata, or harness-host normalization, not from `workspace.yaml`.
- If the runtime-plan compile fails before a run starts, use the dedicated workspace-runtime-plan CLI entrypoint from `runtime/api-server`.

## Validation

```bash
npm run runtime:api-server:typecheck
npm run runtime:api-server:test
npm run runtime:harness-host:test
npm run runtime:test
```

`runtime/api-server/src/app.test.ts`, `runtime/state-store/src/store.test.ts`, and the focused runtime package tests are the fastest executable references when this pipeline is unclear.
