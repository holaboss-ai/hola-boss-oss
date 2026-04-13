# Skills Usage

Skills are a first-class part of the current harness path. They are not hidden prompt fragments glued onto the executor.

## How they enter the run

The runtime passes workspace skill directories into the host request, and the current `pi` host exposes a `skill` tool that loads a workspace skill by id or name.

That means skills remain:

- workspace-owned
- inspectable on disk
- explicitly invoked during the run

## Skill widening

The current host also supports skill-driven widening.

Skill frontmatter can grant additional managed tools or workspace commands for the run through fields such as:

- `holaboss_granted_tools`
- `holaboss_granted_commands`

So the skill system is not just about loading instructions. It can also widen the effective tool or command surface in a controlled, inspectable way.

## What this changes

This keeps skills aligned with the environment model:

- skills are explicit artifacts in the workspace
- widening is tied to metadata rather than hidden state
- the runtime and host can audit how capability changed during the run

That is much more coherent than burying extra permissions inside executor-specific prompt logic.
