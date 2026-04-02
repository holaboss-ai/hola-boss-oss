---
name: skill-creator
description: Guide for creating effective skills. Use when creating or updating a skill.
---

# Skill Creator

Use this skill when defining or updating reusable Codex skills.

## Workflow
1. Workspace-local skills always live under `skills/` at the workspace root.
2. Create or update each workspace skill under `skills/<skill-id>/` and save `SKILL.md` plus any helper files there.
3. This embedded skill is guidance only: do not write new workspace skills into `runtime/harnesses/src/embedded-skills/`.
4. Clarify the task and gather concrete examples.
5. Define minimal reusable structure and naming.
6. Keep `SKILL.md` concise; use references/scripts only when needed.
7. Validate with a real invocation path.
8. Iterate from usage feedback.
