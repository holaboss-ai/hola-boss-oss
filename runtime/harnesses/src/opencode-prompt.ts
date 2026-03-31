import type { HarnessToolRefPayload } from "./types.js";

function callableToolNameFromMcpServerAndTool(serverId: string, toolName: string): string {
  return `${serverId}_${toolName}`;
}

export function appendOpencodeMcpToolAliasGuidance(
  systemPrompt: string,
  resolvedMcpToolRefs: HarnessToolRefPayload[]
): string {
  if (resolvedMcpToolRefs.length === 0) {
    return systemPrompt.trim();
  }

  const aliasLines = resolvedMcpToolRefs.map((toolRef) => {
    const callableName = callableToolNameFromMcpServerAndTool(toolRef.server_id, toolRef.tool_name);
    return `- ${toolRef.tool_id} -> ${callableName}`;
  });

  return [
    systemPrompt.trim(),
    "",
    "OpenCode MCP tool naming:",
    "Workspace configuration and workspace.yaml list MCP tool ids as `server.tool`.",
    "When calling MCP tools through OpenCode, use these callable tool names:",
    ...aliasLines,
    "Use the callable OpenCode tool name for tool invocation."
  ]
    .join("\n")
    .trim();
}
