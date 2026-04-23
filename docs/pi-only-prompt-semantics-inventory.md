# PI-Only Prompt Semantics Inventory

This note inventories behavior-shaping prompt semantics that currently exist only in the PI harness path instead of the harness-agnostic runtime prompt contract.

Relevant runtime contract:
- [agent-runtime-config.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/api-server/src/agent-runtime-config.ts:1527) returns `system_prompt`, `context_messages`, `prompt_sections`, and `prompt_layers`
- Anything that should behave the same across harnesses should ideally originate there

## What Counts As PI-Only Prompt Semantics

PI-only prompt semantics are instructions or behavior nudges that:
- change what the model is encouraged to do
- are injected in `runtime/harness-host/src/pi.ts` or PI-specific tool definitions
- are not represented upstream in `runtime/api-server`

Pure transport formatting does not count unless it carries behavior policy.

## Should Move Upstream

### 1. Todo resume and continuation policy

Current PI-only sources:
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:1368) `resumeTodoReadInstruction(...)`
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:2288) `todoread` prompt guidelines
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:2328) `todowrite` prompt guidelines

Behavior encoded there:
- newest user message is primary
- do not auto-resume unfinished todo on ambiguous user messages
- ask first on conversational or ambiguous continuation messages
- keep executing resumed work until complete or genuinely blocked
- do not stop only for progress updates while executable todo items remain
- preserve unfinished todo when user redirects to unrelated work

Why this should move:
- this is not PI transport behavior
- this is core session continuation policy
- other harnesses should follow the same continuation logic

Suggested home:
- `runtime/api-server/src/agent-runtime-prompt.ts`
- likely a dedicated runtime section such as `todo_continuity_policy`

### 2. Quoted workspace skill expansion

Current PI-only sources:
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:1271) `resolveQuotedSkillSections(...)`
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:653) prompt-body insertion of `Quoted workspace skills:`

Behavior encoded there:
- leading slash skill references in the instruction are expanded into full skill markdown blocks
- missing quoted skills produce explicit prompt feedback

Why this should move:
- this is user-visible behavior
- if `/skill-name` works in one harness, it should work in all harnesses
- the current implementation makes quoted skill support a PI feature instead of a runtime feature

Suggested home:
- runtime-side instruction preprocessing before harness dispatch
- or a dedicated prompt section emitted by `runtime/api-server`

### 3. `write_report` usage policy

Current PI-only source:
- [pi-runtime-tools.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi-runtime-tools.ts:614) `runtimeToolPromptGuidelines("write_report")`

Behavior encoded there:
- use `write_report` for long, evidence-heavy, or multi-source work
- do not use it for short self-contained answers
- if the user asked for research or latest information and findings were gathered, save a report before final answer
- keep chat reply short after report creation

Why this should move:
- `write_report` is a runtime tool, not a PI-only tool
- the threshold for creating an artifact should be consistent across harnesses

Suggested home:
- shared runtime tool metadata in `runtime/harnesses/src/runtime-agent-tools.ts`
- or a runtime prompt section keyed off capability availability

### 4. Web-search recency wording

Current PI-only source:
- [pi-web-search.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi-web-search.ts:99)

Behavior encoded there:
- PI appends “The current year is X; include X in recent-information queries.”

Why this should move:
- this is a query-planning heuristic, not a PI transport detail
- if web search exists in multiple harnesses, recency handling should be shared

Suggested home:
- shared web-search tool definition metadata
- or a general runtime recency policy

## Should Probably Move Upstream Or Be Derived From Shared Metadata

These items are partially duplicated already. The projection can remain harness-local, but the source text should not be handwritten only in PI.

### 5. Scratchpad tool guidance

Current PI-only source:
- [pi-runtime-tools.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi-runtime-tools.ts:625)

Behavior encoded there:
- when to read scratchpad
- how to interpret scratchpad truth status
- when to append vs replace vs clear

Why only “probably”:
- some scratchpad guidance already exists upstream in [agent-runtime-prompt.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/api-server/src/agent-runtime-prompt.ts:375) and [agent-runtime-prompt.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/api-server/src/agent-runtime-prompt.ts:663)
- PI still adds extra tool-specific policy that other harnesses would miss

Suggested direction:
- keep tool-level projection in harnesses
- move canonical scratchpad guidance into shared metadata or runtime prompt sections

### 6. `download_url` and background terminal routing guidance

Current PI-only source:
- [pi-runtime-tools.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi-runtime-tools.ts:606)
- [pi-runtime-tools.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi-runtime-tools.ts:639)

Upstream duplication already exists:
- [agent-capability-registry.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/api-server/src/agent-capability-registry.ts:1280)
- [agent-capability-registry.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/api-server/src/agent-capability-registry.ts:1285)

Assessment:
- the decision policy is already becoming runtime-owned
- PI still contains a second, more detailed version
- this should be deduplicated so harnesses derive from one shared source

### 7. Todo tool schema usage advice

Current PI-only source:
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:2334)

Behavior encoded there:
- valid todo ops
- use `name` instead of `title`
- use `content` instead of `title` for tasks
- read current ids before mutating an existing plan
- keep one task `in_progress`

Assessment:
- some of this belongs in tool parameter schemas and runtime-side validation
- some of it is true cross-harness usage guidance
- the projection should remain harness-local, but the canonical rules should be shared

## Can Stay Harness-Local

These are projection concerns. They affect prompt shape, but not the underlying policy contract.

### 8. Runtime context block wrappers

Current PI-only source:
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:638)

Behavior:
- wraps runtime context messages as:
  - `Runtime context:`
  - `[Runtime Context N]`

Assessment:
- this is serialization, not policy
- another harness may project the same `context_messages` differently

### 9. Attachment, folder, and image prompt serialization

Current PI-only source:
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:687)
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:703)
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:712)

Behavior:
- inlines extracted document text
- lists image attachments
- lists folder attachment paths
- says folder contents are not inlined automatically

Assessment:
- this is mostly harness projection
- the runtime may later define a richer attachment contract, but this is not the highest-priority prompt-policy leak

### 10. Tool `promptSnippet` packaging itself

Current PI-only sources:
- [pi.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi.ts:2293)
- [pi-runtime-tools.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi-runtime-tools.ts:820)
- [pi-browser-tools.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi-browser-tools.ts:331)
- [pi-web-search.ts](/Users/jeffrey/Desktop/holaboss/holaOS-runtime-work-checkpoints/runtime/harness-host/src/pi-web-search.ts:261)

Assessment:
- each harness may need to package tool metadata differently
- that projection can stay local
- but the meaning carried inside descriptions and guidelines should come from shared definitions where possible

## Priority Order

1. Move todo continuation policy upstream.
2. Move quoted skill expansion upstream.
3. Move `write_report` policy into shared runtime tool metadata.
4. Move web-search recency guidance into shared metadata.
5. Deduplicate scratchpad, terminal, and download guidance so PI only projects shared text.

## Practical Rule

Use this boundary:
- if it changes agent behavior across sessions or tools, define it in `runtime/api-server` or shared tool metadata
- if it only changes how one harness serializes already-defined content, keep it in the harness adapter
