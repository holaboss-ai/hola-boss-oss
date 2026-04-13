# Adapter Capabilities

The runtime adapter is where the shipped harness path declares what it supports before a run ever reaches the host.

## Current coded truth

In `runtime/harnesses/src/pi.ts`, the current `pi` adapter declares:

- `supportsWaitingUser: true`
- `supportsSkills: true`
- `supportsMcpTools: true`
- `supportsStructuredOutput: false`

That is the current contract the runtime is working with, not an aspirational roadmap.

## What these flags affect

These capability flags influence how the runtime prepares a run:

- whether it can rely on skill support
- whether it can project MCP tools
- whether waiting-user style interactions are valid
- whether structured output should be treated as native harness behavior or as something the runtime must handle elsewhere

This gives the runtime a concrete statement of what the selected executor can handle.

## More than a flag list

The adapter also defines the runner prep plan and the reduced host request shape. So in practice, adapter capabilities are part of a broader boundary:

- capability flags
- runner prep behavior
- host request building
- readiness reporting

That is what makes the adapter a real systems seam rather than just a static config object.
