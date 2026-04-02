---
name: skill-installer
description: Install Codex skills from curated sources or GitHub paths.
---

# Skill Installer

Use this skill to list and install workspace skills into the directory configured by `workspace.yaml`.

## Common Tasks
1. Read `workspace.yaml` before installing skill files and resolve the workspace skills directory from `skills.path`.
2. If `skills.path` is not set, fall back to `agents.proactive.skills_path`; if neither is set, default to `skills`.
3. Treat the resolved skills directory as relative to the workspace root. Install each skill under `<skills-dir>/<skill-id>/` and save `SKILL.md` plus any helper files there.
4. This embedded skill is guidance only: do not install workspace skills into `runtime/harnesses/src/embedded-skills/`. Do not install into `$CODEX_HOME/skills` unless the user explicitly asks for a global Codex skill install instead of a workspace skill install.
5. List installable skills.
6. Install a curated skill by name.
7. Install a skill from a GitHub repository/path.
