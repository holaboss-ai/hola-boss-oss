import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const MCP_METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0",
  error: {
    code: -32000,
    message: "Method not allowed."
  },
  id: null
};

export interface WorkspaceMcpHostCliRequest {
  workspace_dir: string;
  catalog_json_base64: string;
  host: string;
  port: number;
  server_name: string;
  python_executable: string;
}

export interface WorkspaceMcpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface WorkspaceMcpToolCallResult {
  content: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

type JsonCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => Promise<unknown>;

type WorkspaceMcpHostDeps = {
  createHttpServer?: typeof createServer;
  runJsonCommand?: JsonCommandRunner;
  logger?: Pick<typeof console, "error" | "info">;
};

type WorkspaceToolBridgeRequest = {
  workspace_dir: string;
  catalog_json_base64: string;
};

type WorkspaceToolCallBridgeRequest = WorkspaceToolBridgeRequest & {
  tool_name: string;
  arguments: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isToolCallResult(value: unknown): value is WorkspaceMcpToolCallResult {
  return isRecord(value) && Array.isArray(value.content);
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, key: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return Number(value);
}

export function decodeWorkspaceMcpHostCliRequest(encoded: string): WorkspaceMcpHostCliRequest {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error("request_base64 is required");
  }
  const raw = Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("request payload must be an object");
  }
  return {
    workspace_dir: requiredString(parsed.workspace_dir, "workspace_dir"),
    catalog_json_base64: requiredString(parsed.catalog_json_base64, "catalog_json_base64"),
    host: requiredString(parsed.host ?? "127.0.0.1", "host"),
    port: requiredPositiveInteger(parsed.port, "port"),
    server_name: requiredString(parsed.server_name ?? "workspace", "server_name"),
    python_executable: requiredString(parsed.python_executable, "python_executable")
  };
}

function resolveWorkspaceDir(value: string): string {
  return path.resolve(value);
}

function encodeBridgeRequest(payload: WorkspaceToolBridgeRequest | WorkspaceToolCallBridgeRequest): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function buildBridgeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pythonpath = (env.PYTHONPATH ?? "").trim();
  if (!pythonpath) {
    env.PYTHONPATH = "/app";
  } else if (!pythonpath.split(":").includes("/app")) {
    env.PYTHONPATH = `/app:${pythonpath}`;
  }
  return env;
}

async function defaultRunJsonCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<unknown> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 0));
  });

  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim() || `command exited with code ${exitCode}`;
    throw new Error(detail);
  }
  return JSON.parse(stdout);
}

async function runWorkspaceToolBridge(
  request: WorkspaceMcpHostCliRequest,
  operation: "inspect" | "call",
  payload: WorkspaceToolBridgeRequest | WorkspaceToolCallBridgeRequest,
  deps: WorkspaceMcpHostDeps = {}
): Promise<unknown> {
  const runJsonCommand = deps.runJsonCommand ?? defaultRunJsonCommand;
  return runJsonCommand(
    request.python_executable,
    [
      "-m",
      "sandbox_agent_runtime.workspace_tool_bridge",
      operation,
      "--request-base64",
      encodeBridgeRequest(payload)
    ],
    {
      cwd: resolveWorkspaceDir(request.workspace_dir),
      env: buildBridgeEnv()
    }
  );
}

export async function inspectWorkspaceTools(
  request: WorkspaceMcpHostCliRequest,
  deps: WorkspaceMcpHostDeps = {}
): Promise<WorkspaceMcpToolDefinition[]> {
  const payload = await runWorkspaceToolBridge(
    request,
    "inspect",
    {
      workspace_dir: resolveWorkspaceDir(request.workspace_dir),
      catalog_json_base64: request.catalog_json_base64
    },
    deps
  );
  if (!isRecord(payload) || !Array.isArray(payload.tools)) {
    throw new Error("workspace tool bridge returned an invalid inspect payload");
  }
  return payload.tools as WorkspaceMcpToolDefinition[];
}

function toolErrorResult(message: string): WorkspaceMcpToolCallResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}

export async function callWorkspaceTool(
  request: WorkspaceMcpHostCliRequest,
  toolName: string,
  args: Record<string, unknown>,
  deps: WorkspaceMcpHostDeps = {}
): Promise<WorkspaceMcpToolCallResult> {
  const payload = await runWorkspaceToolBridge(
    request,
    "call",
    {
      workspace_dir: resolveWorkspaceDir(request.workspace_dir),
      catalog_json_base64: request.catalog_json_base64,
      tool_name: toolName,
      arguments: args
    },
    deps
  );
  if (!isToolCallResult(payload)) {
    throw new Error("workspace tool bridge returned an invalid call payload");
  }
  return payload;
}

function jsonResponse(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

function getRequestPath(request: IncomingMessage): string {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  return url.pathname;
}

async function handleMcpPost(
  request: IncomingMessage,
  response: ServerResponse,
  serverName: string,
  tools: WorkspaceMcpToolDefinition[],
  toolRequest: WorkspaceMcpHostCliRequest,
  deps: WorkspaceMcpHostDeps
): Promise<void> {
  const server = new Server(
    { name: serverName, version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (callRequest) => {
    try {
      return await callWorkspaceTool(
        toolRequest,
        callRequest.params.name,
        isRecord(callRequest.params.arguments) ? callRequest.params.arguments : {},
        deps
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolErrorResult(message);
    }
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });
  await server.connect(transport);
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await transport.handleRequest(request, response);
}

export async function startWorkspaceMcpHost(
  request: WorkspaceMcpHostCliRequest,
  deps: WorkspaceMcpHostDeps = {}
): Promise<HttpServer> {
  const workspaceDir = resolveWorkspaceDir(request.workspace_dir);
  const tools = await inspectWorkspaceTools({ ...request, workspace_dir: workspaceDir }, deps);
  const logger = deps.logger ?? console;
  const serverFactory = deps.createHttpServer ?? createServer;

  const httpServer = serverFactory(async (incoming, outgoing) => {
    const requestPath = getRequestPath(incoming);
    if (requestPath !== "/mcp") {
      jsonResponse(outgoing, 404, {
        jsonrpc: "2.0",
        error: { code: -32601, message: "Not found" },
        id: null
      });
      return;
    }
    if (incoming.method === "GET" || incoming.method === "DELETE") {
      jsonResponse(outgoing, 405, MCP_METHOD_NOT_ALLOWED);
      return;
    }
    if (incoming.method !== "POST") {
      jsonResponse(outgoing, 405, MCP_METHOD_NOT_ALLOWED);
      return;
    }

    try {
      await handleMcpPost(incoming, outgoing, request.server_name, tools, { ...request, workspace_dir: workspaceDir }, deps);
    } catch (error) {
      logger.error("Workspace MCP host request failed", error);
      if (!outgoing.headersSent) {
        jsonResponse(outgoing, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(request.port, request.host, () => resolve());
  });

  logger.info(
    "Starting workspace MCP host at %s:%s with %s tools",
    request.host,
    request.port,
    tools.length
  );
  return httpServer;
}

export async function runWorkspaceMcpHostCli(
  argv: string[],
  deps: WorkspaceMcpHostDeps = {}
): Promise<number> {
  const requestBase64 = argv[0] === "--request-base64" ? argv[1] ?? "" : argv[0] ?? "";
  if (!requestBase64) {
    process.stderr.write("request_base64 is required\n");
    return 2;
  }

  let server: HttpServer | null = null;
  try {
    const request = decodeWorkspaceMcpHostCliRequest(requestBase64);
    server = await startWorkspaceMcpHost(request, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    return 1;
  }

  const shutdown = async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  await new Promise<void>(() => {});
  return 0;
}

async function main(): Promise<void> {
  process.exitCode = await runWorkspaceMcpHostCli(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
