---
name: skill-installer
description: Install Codex skills from curated sources or GitHub paths.
---

# Skill Installer

Use this skill to list and install workspace skills into the workspace-local `skills/` directory.

## Common Tasks
1. Install each workspace skill under `skills/<skill-id>/` and save `SKILL.md` plus any helper files there.
2. This embedded skill is guidance only: do not install workspace skills into `runtime/harnesses/src/embedded-skills/`. Do not install into `$CODEX_HOME/skills` unless the user explicitly asks for a global Codex skill install instead of a workspace skill install.
3. List installable skills.
4. Install a curated skill by name.
5. Install a skill from a GitHub repository/path.
