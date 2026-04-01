---
description: Holaboss runtime conventions for runtime, harness, and desktop changes.
---
# Holaboss Runtime

Use this skill when you are changing Holaboss runtime execution, harness wiring, or desktop-to-runtime integration.

- Treat `runtime/api-server`, `runtime/harness-host`, `runtime/harnesses`, and `runtime/state-store` as one execution surface.
- Prefer `npm run runtime:test` after changing runtime, harness, prompt, skill, or capability code.
- The shared runtime harness is `pi`; do not assume legacy OpenCode bootstrap or sidecar paths still exist.
- Keep runtime behavior explicit in tests when changing capabilities, prompts, skill resolution, or harness request payloads.
