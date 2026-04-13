# Workspace Experience

This page defines the design contract for the workspace surface in Holaboss Desktop.

Use it when you are building or refining the workspace UI. For the underlying filesystem and runtime model, see [Workspace Model](/holaos/workspace-model).

## Why the workspace surface matters

The workspace is the operator's entrypoint into the `holaOS` environment. The UI should not behave like a generic folder browser. It should expose the operating context the agent is actually working inside.

At the product level, a workspace is where the operator understands what this environment is for, what capabilities are currently available, what state should persist, and what changed since the last session.

## What a workspace represents

A workspace is a stable operating context for one workflow. In the UI, that context includes:

- its instructions
- its apps and capabilities
- its integrations (connected external accounts that apps use)
- its skills (agent behaviors and instruction packs)
- its session and continuity state
- its memory and outputs
- its model and provider settings

That means the desktop is not just opening a folder. It is opening a complete operating environment.

## What the workspace UI must make visible

The workspace UI should make these areas discoverable:

| Area | What the operator should be able to answer | Why it matters |
| --- | --- | --- |
| Workspace identity | Which workspace is open right now? | Prevents work in the wrong context. |
| Active configuration | Which model, provider, and runtime settings are in effect? | Determines how the next run will behave. |
| Apps and capabilities | What can this workspace do right now? | Shows the actual capability surface, not just installed code. |
| Integrations | Which external accounts are connected? | Determines whether apps can use external services. |
| Recent session state | What happened most recently? | Helps the operator continue work without starting from scratch. |
| Durable memory | What should persist beyond one run? | Keeps long-horizon context visible and reviewable. |
| Outputs | What has this workspace produced? | Gives the operator reviewable results instead of hidden side effects. |

## What the UI should help the operator answer quickly

A good workspace surface helps the operator answer three questions fast:

1. What is this workspace for?
2. What can this workspace do right now?
3. What changed since the last time I opened it?

That means summary, capability visibility, current configuration, and recent activity should appear before deep diagnostics.

## Recommended priority order

When designing the workspace surface, prefer this order:

1. workspace identity and summary
2. active capabilities and integrations
3. model and runtime configuration
4. recent outputs, memory changes, and session activity
5. raw files, logs, and advanced diagnostics

This keeps the first screen oriented around operator decisions rather than repository structure.

## Anti-patterns to avoid

Avoid these failure modes:

- treating the workspace as only a file tree
- hiding capability state behind too many nested screens
- mixing durable memory with transient session state
- making outputs indistinguishable from local app records
- surfacing raw internals before the operator is oriented

The workspace should feel inspectable and powerful, but still organized around the operator's need to understand and direct work.

## Relationship to the rest of the system

The workspace UI sits above several deeper contracts:

- [Workspace Model](/holaos/workspace-model) for the authored and runtime-owned structure
- [Memory and Continuity](/holaos/memory-and-continuity/) for what persists and what resumes
- [Model Configuration](/desktop/model-configuration) for provider and model controls

The UI should expose those layers clearly without collapsing them into one undifferentiated screen.
