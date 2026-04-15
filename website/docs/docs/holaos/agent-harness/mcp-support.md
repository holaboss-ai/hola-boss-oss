# MCP Support

MCP support is part of the current harness path, but it is projected from `workspace.yaml` rather than discovered by the harness on its own.

## Where Workspace-Level MCP Lives

Workspace-level MCP servers are authored in `workspace.yaml` under `mcp_registry`.

Remote server example with an explicit allowlist:

```yaml
mcp_registry:
  servers:
    context7:
      type: remote
      url: https://mcp.context7.com/mcp
      enabled: true
      timeout_ms: 30000
      headers:
        Authorization: "{env:CONTEXT7_AUTHORIZATION}"
  allowlist:
    tool_ids:
      - context7.lookup
      - context7.search
```

Remote server example that allows all discovered tools from the configured server:

```yaml
mcp_registry:
  servers:
    context7:
      type: remote
      url: https://mcp.context7.com/mcp
      enabled: true
      timeout_ms: 30000
```

An empty allowlist has the same meaning:

```yaml
mcp_registry:
  servers:
    context7:
      type: remote
      url: https://mcp.context7.com/mcp
      enabled: true
  allowlist:
    tool_ids: []
```

## What the Runtime Does First

Before the harness runs, the runtime:

- prepares MCP server payloads
- starts the workspace MCP sidecar when needed
- resolves MCP tool refs when `mcp_registry.allowlist.tool_ids` is present and non-empty
- passes the prepared `mcp_servers` and any resolved `mcp_tool_refs` into the host request

That means the runtime decides which part of the MCP graph is visible for this run.

## What the Host Does Next

The harness host then:

- builds MCP bindings from the prepared server payloads
- discovers tools from those configured servers
- exposes either the allowlisted subset or all discovered tools when no MCP allowlist was indicated

This keeps MCP visibility policy inside the runtime while still allowing a workspace to opt into “all tools from this configured server” by leaving the allowlist empty.

## When Changes Take Effect

The runtime compiles `workspace.yaml` at run start. If you add or edit a remote MCP server during one run, the updated server configuration is ready on the next run, not retroactively inside the already running harness session.

## Current Boundary

MCP is one of the most important capability surfaces in `holaOS`, so it needs a stable policy boundary:

- runtime resolves configured MCP servers for the run
- runtime resolves explicit MCP tool refs when an allowlist is present
- host materializes the resolved subset or all discovered tools when no allowlist was indicated
- harness consumes the projected tool surface

That split is what keeps MCP support compatible with multiple harnesses later.
