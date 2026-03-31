import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PERSISTED_PROXY_HEADER_ALLOWLIST = new Set([
  "x-api-key",
  "x-holaboss-user-id",
  "x-holaboss-sandbox-id"
]);

export interface OpencodeConfigModelClient {
  model_proxy_provider: string;
  api_key: string;
  base_url?: string | null;
  default_headers?: Record<string, string> | null;
}

export interface OpencodeConfigCliRequest {
  workspace_root: string;
  provider_id: string;
  model_id: string;
  model_client: OpencodeConfigModelClient;
}

export interface OpencodeConfigCliResponse {
  path: string;
  provider_config_changed: boolean;
  model_selection_changed: boolean;
}

export function opencodeProxyConfigPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), "opencode.json");
}

export function buildOpencodeProviderConfigPayload(
  providerId: string,
  modelId: string,
  modelClient: OpencodeConfigModelClient
): Record<string, unknown> {
  const baseUrl = (modelClient.base_url ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("OpenCode model proxy base URL is not configured");
  }

  const headers: Record<string, string> = {};
  if (modelClient.default_headers) {
    for (const [key, value] of Object.entries(modelClient.default_headers)) {
      const normalizedKey = String(key).trim();
      const normalizedValue = String(value).trim();
      if (!normalizedKey || !normalizedValue) {
        continue;
      }
      if (!PERSISTED_PROXY_HEADER_ALLOWLIST.has(normalizedKey.toLowerCase())) {
        continue;
      }
      headers[normalizedKey] = normalizedValue;
    }
  }
  if (!("X-API-Key" in headers)) {
    headers["X-API-Key"] = modelClient.api_key;
  }

  const normalizedProviderId = providerId.trim().toLowerCase();
  const providerNpmPackage =
    modelClient.model_proxy_provider === "anthropic_native"
      ? "@ai-sdk/anthropic"
      : normalizedProviderId === "hb_openai" ||
          normalizedProviderId === "openai" ||
          normalizedProviderId === "openai_direct" ||
          baseUrl === "https://api.openai.com/v1" ||
          baseUrl.startsWith("https://api.openai.com/v1/") ||
          baseUrl.includes("/model-proxy/openai/v1")
        ? "@ai-sdk/openai"
        : "@ai-sdk/openai-compatible";

  return {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [providerId]: {
        npm: providerNpmPackage,
        name: "Holaboss Model Proxy",
        options: {
          apiKey: modelClient.api_key,
          baseURL: baseUrl,
          headers
        },
        models: {
          [modelId]: {
            name: modelId,
            provider: {
              npm: providerNpmPackage,
              api: baseUrl
            }
          }
        }
      }
    },
    model: `${providerId}/${modelId}`
  };
}

export function writeOpencodeProviderConfig(
  workspaceRoot: string,
  providerId: string,
  modelId: string,
  modelClient: OpencodeConfigModelClient
): { path: string; changed: boolean } {
  const configPath = opencodeProxyConfigPath(workspaceRoot);
  const payload = buildOpencodeProviderConfigPayload(providerId, modelId, modelClient);
  const nextText = JSON.stringify(payload, null, 2);
  let existingText = "";
  try {
    existingText = fs.readFileSync(configPath, "utf8");
  } catch {
    existingText = "";
  }
  if (existingText === nextText) {
    return { path: configPath, changed: false };
  }
  fs.writeFileSync(configPath, nextText, "utf8");
  return { path: configPath, changed: true };
}

export function writeOpencodeModelSelection(
  workspaceRoot: string,
  providerId: string,
  modelId: string
): { path: string; changed: boolean } {
  const configPath = opencodeProxyConfigPath(workspaceRoot);
  const desiredModel = `${providerId}/${modelId}`;

  let existingText: string;
  try {
    existingText = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    throw new Error(`OpenCode config file is missing at ${configPath}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(existingText);
  } catch {
    throw new Error(`OpenCode config at ${configPath} is invalid JSON`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError(`OpenCode config at ${configPath} must be a JSON object`);
  }

  const configObject = payload as Record<string, unknown>;
  const existingModel = String(configObject.model ?? "").trim();
  if (existingModel === desiredModel) {
    return { path: configPath, changed: false };
  }

  configObject.model = desiredModel;
  fs.writeFileSync(configPath, JSON.stringify(configObject, null, 2), "utf8");
  return { path: configPath, changed: true };
}

export function updateOpencodeConfig(request: OpencodeConfigCliRequest): OpencodeConfigCliResponse {
  const providerResult = writeOpencodeProviderConfig(
    request.workspace_root,
    request.provider_id,
    request.model_id,
    request.model_client
  );
  const modelSelectionResult = writeOpencodeModelSelection(
    request.workspace_root,
    request.provider_id,
    request.model_id
  );
  return {
    path: providerResult.path,
    provider_config_changed: providerResult.changed,
    model_selection_changed: modelSelectionResult.changed
  };
}

function decodeCliRequest(encoded: string): OpencodeConfigCliRequest {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error("request_base64 is required");
  }
  const raw = Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request payload must be an object");
  }
  return parsed as OpencodeConfigCliRequest;
}

export async function runOpencodeConfigCli(
  argv: string[],
  options: {
    io?: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
    updateConfig?: (request: OpencodeConfigCliRequest) => OpencodeConfigCliResponse;
  } = {}
): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const requestBase64 = argv[0] === "--request-base64" ? argv[1] ?? "" : argv[0] ?? "";
  if (!requestBase64) {
    io.stderr.write("request_base64 is required\n");
    return 2;
  }
  try {
    const request = decodeCliRequest(requestBase64);
    const result = (options.updateConfig ?? updateOpencodeConfig)(request);
    io.stdout.write(JSON.stringify(result));
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runOpencodeConfigCli(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
