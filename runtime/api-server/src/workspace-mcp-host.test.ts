import assert from "node:assert/strict";
import { test } from "node:test";

import {
  callWorkspaceTool,
  decodeWorkspaceMcpHostCliRequest,
  inspectWorkspaceTools
} from "./workspace-mcp-host.js";

function encodeRequest(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

test("decodeWorkspaceMcpHostCliRequest decodes a valid request payload", () => {
  const request = decodeWorkspaceMcpHostCliRequest(
    encodeRequest({
      workspace_dir: "/tmp/workspace-1",
      catalog_json_base64: "W10=",
      host: "127.0.0.1",
      port: 8080,
      server_name: "workspace__abc123",
      python_executable: "python3"
    })
  );

  assert.deepEqual(request, {
    workspace_dir: "/tmp/workspace-1",
    catalog_json_base64: "W10=",
    host: "127.0.0.1",
    port: 8080,
    server_name: "workspace__abc123",
    python_executable: "python3"
  });
});

test("inspectWorkspaceTools delegates to the Python bridge inspect operation", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const tools = await inspectWorkspaceTools(
    {
      workspace_dir: "/tmp/workspace-1",
      catalog_json_base64: "W10=",
      host: "127.0.0.1",
      port: 8080,
      server_name: "workspace__abc123",
      python_executable: "python3"
    },
    {
      async runJsonCommand(command, args, options) {
        calls.push({ command, args, cwd: options.cwd });
        return {
          tools: [
            {
              name: "echo",
              description: "Echo text",
              inputSchema: {
                type: "object",
                properties: {
                  text: { type: "string" }
                }
              }
            }
          ]
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "python3");
  assert.deepEqual(calls[0]?.args.slice(0, 4), [
    "-m",
    "sandbox_agent_runtime.workspace_tool_bridge",
    "inspect",
    "--request-base64"
  ]);
  assert.equal(calls[0]?.cwd, "/tmp/workspace-1");
  assert.equal(tools[0]?.name, "echo");
});

test("callWorkspaceTool delegates to the Python bridge call operation", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const result = await callWorkspaceTool(
    {
      workspace_dir: "/tmp/workspace-1",
      catalog_json_base64: "W10=",
      host: "127.0.0.1",
      port: 8080,
      server_name: "workspace__abc123",
      python_executable: "python3"
    },
    "echo",
    { text: "hello" },
    {
      async runJsonCommand(command, args, options) {
        calls.push({ command, args, cwd: options.cwd });
        return {
          content: [{ type: "text", text: "hello" }]
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "python3");
  assert.deepEqual(calls[0]?.args.slice(0, 4), [
    "-m",
    "sandbox_agent_runtime.workspace_tool_bridge",
    "call",
    "--request-base64"
  ]);
  assert.equal(calls[0]?.cwd, "/tmp/workspace-1");
  assert.deepEqual(result, {
    content: [{ type: "text", text: "hello" }]
  });
});
