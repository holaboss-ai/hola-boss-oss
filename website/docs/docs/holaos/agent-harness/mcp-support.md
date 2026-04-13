# MCP Support

MCP support is part of the current harness path, but it is explicitly projected rather than implicitly discovered.

## What the runtime does first

Before the harness runs, the runtime:

- prepares MCP server payloads
- starts the workspace MCP sidecar when needed
- resolves the allowed MCP tool refs for the run
- passes the allowlisted `mcp_tool_refs` into the host request

That means the runtime decides which part of the MCP graph is visible for this run.

## What the host does next

The harness host then:

- builds MCP bindings from the prepared server payloads
- discovers the allowed tools
- exposes only the resolved tool subset to the harness

This is why MCP visibility is explicit per run rather than a blanket “everything on the server is available” rule.

## Current boundary

MCP is one of the most important capability surfaces in `holaOS`, so it needs a stable policy boundary:

- runtime resolves and allowlists
- host materializes the allowed tools
- harness consumes the projected tool surface

That split is what keeps MCP support compatible with multiple harnesses later.
