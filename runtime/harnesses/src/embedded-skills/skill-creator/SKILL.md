---
name: skill-creator
description: Guide for creating effective skills. Use when creating or updating a skill.
---

# Skill Creator

Use this skill when defining or updating reusable Codex skills.

## Workflow
1. Read `workspace.yaml` before creating skill files and resolve the workspace skills directory from `skills.path`.
2. If `skills.path` is not set, fall back to `agents.proactive.skills_path`; if neither is set, default to `skills`.
3. Treat the resolved skills directory as relative to the workspace root. Create or update the skill under `<skills-dir>/<skill-id>/` and save `SKILL.md` plus any helper files there. This embedded skill is guidance only: do not write new workspace skills into `runtime/harnesses/src/embedded-skills/`. Do not assume a hardcoded `skills/` path when `workspace.yaml` points elsewhere.
4. Clarify the task and gather concrete examples.
5. Define minimal reusable structure and naming.
6. Keep `SKILL.md` concise; use references/scripts only when needed.
7. Validate with a real invocation path.
8. Iterate from usage feedback.
