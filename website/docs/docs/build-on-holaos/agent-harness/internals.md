# Internals and Contracts

Use this page when you are changing the execution boundary itself rather than only building apps or templates.

In `holaOS`, a harness path is not only the underlying executor. It is the runtime adapter, the runtime plugin, the harness-host plugin, and the executor underneath them as one execution boundary.

The runtime intentionally splits that boundary so a new executor can fit into the same `holaOS` environment model without redefining memory, continuity, or the workspace contract.

## Follow the current run path first

For the shipped `pi` path, a single run currently moves through these seams:

1. `runtime/api-server/src/ts-runner.ts`: compiles the workspace runtime plan, stages MCP and app state, loads or persists harness session state, and decides which harness plugin to use.
2. `runtime/api-server/src/agent-runtime-config.ts`: projects prompt layers, response-delivery policy, operator-surface context, capability manifests, selected model client config, and the tool map passed into the harness.
3. `runtime/api-server/src/harness-registry.ts`: selects the runtime harness plugin, timeout behavior, browser tools, runtime tools, and MCP preparation policy.
4. `runtime/harnesses/src/pi.ts`: builds the reduced host request that crosses from runtime code into the harness host, including the raw `thinking_value` requested for this run.
5. `runtime/harness-host/src/index.ts`: dispatches the registered host plugin by command.
6. `runtime/harness-host/src/pi.ts`: creates the Pi session, loads skills, injects runtime and browser tools, materializes the resolved MCP tool surface, enforces workspace boundaries, maps `thinking_value` onto Pi-native reasoning settings, and maps native events back out.
7. `runtime/harness-host/src/contracts.ts`: defines the normalized runner event types that the host emits back to the runtime.

If you are unsure where a behavior belongs, trace this path before you patch anything.

Representative reduced host request from `runtime/harnesses/src/pi.ts`:

```ts
{
  workspace_id: params.request.workspace_id,
  workspace_dir: params.bootstrap.workspaceDir,
  session_id: params.request.session_id,
  input_id: params.request.input_id,
  instruction: instructionWithContextMessages(
    params.request.instruction,
    params.runtimeConfig.context_messages,
  ),
  attachments: params.request.attachments ?? [],
  thinking_value: params.request.thinking_value ?? null,
  provider_id: params.runtimeConfig.provider_id,
  model_id: params.runtimeConfig.model_id,
  model_client: params.runtimeConfig.model_client,
  mcp_servers: params.mcpServers,
  mcp_tool_refs: params.mcpToolRefs,
}
```

`mcp_tool_refs` may be empty. In that case the host still receives the configured `mcp_servers` and exposes all discovered tools from those servers for the run.

## Main code seams

- `runtime/harnesses/src/types.ts`: canonical harness contracts, including adapter capabilities, runner prep plans, prompt-layer payloads, prepared MCP payloads, and host request build parameters.
- `runtime/harnesses/src/pi.ts`: the current `pi` runtime adapter. This is where the shipped path declares capabilities, chooses its runner prep plan, and builds the reduced host request.
- `runtime/api-server/src/harness-registry.ts`: runtime-side harness registration. This is where browser tools, runtime tools, skill staging, command staging, readiness, and harness-specific timeouts are coordinated.
- `runtime/api-server/src/ts-runner.ts`: per-run bootstrap. This is where the runtime applies the default tool set, adds extra tools such as `web_search` and `write_report`, prepares browser/runtime/MCP state, loads operator-surface context, and builds the agent runtime config request.
- `runtime/api-server/src/agent-runtime-config.ts`: prompt and capability projection. This is where prompt layers, recalled memory, recent runtime context, operator-surface context, response-delivery policy, capability manifests, and tool visibility are composed before the harness runs.
- `runtime/harness-host/src/contracts.ts`: host-side request and event contracts. This is the source of truth for the decoded host request and the normalized runner event types the host must emit back.
- `runtime/harness-host/src/index.ts`: harness-host CLI entrypoint that dispatches a registered host plugin by command.
- `runtime/harness-host/src/pi.ts`: the current host implementation. This is where the host loads workspace skills, applies skill widening, enforces workspace-boundary policy, injects browser/runtime/web search tools, materializes allowlisted MCP tools or all discovered tools when the MCP allowlist is omitted, and normalizes provider-native `thinking_value` choices onto Pi reasoning levels or budgets.
- `runtime/harness-host/src/pi-browser-tools.ts`: desktop browser bridge used by the current host.
- `runtime/harness-host/src/pi-runtime-tools.ts`: runtime-managed tool bridge for onboarding, cronjobs, image generation, and `write_report`. This is also where the host attaches workspace/session/input/model headers to runtime-tool calls.
- `runtime/harness-host/src/pi-web-search.ts`: hosted native web search bridge for the current `web_search` tool.
- `runtime/harnesses/src/desktop-browser-tools.ts`, `runtime/harnesses/src/runtime-agent-tools.ts`, and `runtime/harnesses/src/native-web-search-tools.ts`: canonical ids and descriptions for the projected browser, runtime, and native web-search surfaces.

Representative event normalization from `runtime/harness-host/src/pi.ts`:

```ts
switch (event.type) {
  case "message_update":
    return event.assistantMessageEvent.type === "thinking_delta"
      ? [{ event_type: "thinking_delta", payload: { delta_kind: "thinking" } }]
      : [{ event_type: "output_delta", payload: { delta_kind: "output" } }];
  case "tool_execution_start":
  case "tool_execution_end":
    return [{ event_type: "tool_call", payload: { source: "pi" } }];
}
```

Representative reasoning normalization in the host:

```ts
const requestedThinking = requestedPiThinkingLevel(request) ?? "off";
const requestedThinkingBudgets = requestedPiThinkingBudgets(request);

const settingsManager = SettingsManager.inMemory({
  defaultProvider: request.provider_id,
  defaultModel: request.model_id,
  defaultThinkingLevel: requestedThinking,
  ...(requestedThinkingBudgets
    ? { thinkingBudgets: requestedThinkingBudgets }
    : {}),
});
```

## Quoted workspace skill expansion

The current prompt path supports leading slash skill references from the composer.

When the request instruction starts with lines like:

```text
/customer_lookup
/sales_policy

Review this lead and draft next-step guidance.
```

`buildPiPromptPayload()` resolves those ids against `workspace_skill_dirs`, injects canonical `<skill ...>` blocks, and leaves the remainder as the instruction body:

```ts
const quotedSkills = resolveQuotedSkillSections(
  request.instruction,
  request.workspace_skill_dirs,
);
if (quotedSkills.blocks.length > 0) {
  sections.push(["Quoted workspace skills:", ...quotedSkills.blocks].join("\n\n"));
}
const instruction = quotedSkills.body.trim();
```

If a quoted skill id is missing, the host appends an explicit warning section rather than silently dropping it. Keep this behavior stable so composer-selected skills remain inspectable in runtime traces and harness prompts.

## Change the right seam

- If you are changing prompt layers, model selection, or capability projection, start in `runtime/api-server/src/agent-runtime-config.ts`.
- If you are changing run bootstrap, session reuse, or the order of preparation steps, start in `runtime/api-server/src/ts-runner.ts`.
- If you are changing which reasoning-effort values appear in the desktop or how they map into the executor, inspect `desktop/shared/model-catalog.ts`, `desktop/src/components/panes/ChatPane.tsx`, and `runtime/harness-host/src/pi.ts` together.
- If you are changing which tools the harness can see, inspect both `runtime/api-server/src/harness-registry.ts` and the tool-definition files under `runtime/harnesses/src/`.
- If you are changing report-artifact behavior or runtime-tool request metadata, inspect both `runtime/harness-host/src/pi-runtime-tools.ts` and `runtime/api-server/src/runtime-agent-tools.ts`.
- If you are changing event normalization, waiting-user behavior, or tool-call event mapping, inspect `runtime/harness-host/src/contracts.ts` and `runtime/harness-host/src/pi.ts`.
- If you are adding a brand-new harness path, you need a runtime adapter, a host implementation, registry wiring, and tests for the new boundary.

## How to add another harness path

1. Add a new runtime adapter under `runtime/harnesses/src/` that declares capabilities and a runner prep plan.
2. Build the host request from the runtime's reduced execution package instead of letting the executor infer state implicitly.
3. Implement a host plugin under `runtime/harness-host/src/` that decodes that request and emits normalized lifecycle events.
4. Register the runtime plugin in `runtime/api-server/src/harness-registry.ts` so browser tools, runtime tools, skill staging, timeouts, and readiness rules match the new harness.
5. Decide deliberately which capability surfaces the harness should expose: browser tools, runtime tools, MCP, skills, native web search, or future additions.
6. Keep event normalization stable so the runtime and desktop can observe runs without depending on harness-native output.

## Invariants to preserve

- The workspace contract stays runtime-owned. A harness should consume it, not redefine it.
- Memory and continuity stay runtime-owned. A harness can use recalled context, but it should not replace the persistence model.
- MCP tools stay runtime-projected per run. When the runtime resolved a subset, do not expose whole servers; when the runtime omitted the allowlist, exposing all discovered tools from the configured servers is intentional.
- Skills stay explicit. If a harness supports skill-driven widening, keep the widening rules inspectable and tied to skill metadata.
- Runtime-tool mutations should stay turn-aware. If the host creates outputs such as report artifacts, keep workspace/session/input association explicit instead of inferring it later from file capture.
- The harness should receive a reduced execution package, not uncontrolled access to the whole product state.

## Validation

```bash
npm run runtime:harness-host:test
npm run runtime:api-server:test
npm run runtime:test
```

Use the package-specific test commands while you iterate, then run the full runtime suite before review.
