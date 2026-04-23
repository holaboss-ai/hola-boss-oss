import {
  NATIVE_WEB_SEARCH_TOOL_DEFINITIONS,
  type NativeWebSearchToolId,
} from "./native-web-search-tools.js";

const EXA_WEB_SEARCH_BASE_URL = "https://mcp.exa.ai";
const EXA_WEB_SEARCH_ENDPOINT = "/mcp";
const DEFAULT_WEB_SEARCH_NUM_RESULTS = 8;
const MAX_WEB_SEARCH_NUM_RESULTS = 10;
const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 25_000;
const EXA_WEB_SEARCH_PROVIDER_ID = "exa_hosted_mcp";

type ExaWebSearchLivecrawlMode = "fallback" | "preferred";
type ExaWebSearchType = "auto" | "fast" | "deep";

export interface HarnessNativeWebSearchToolOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string | null;
  requestTimeoutMs?: number;
}

export interface HarnessNativeWebSearchToolDefinitionLike {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  parameters: Record<string, unknown>;
  execute: (...args: any[]) => Promise<any>;
}

interface ExaMcpSearchRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tools/call";
  params: {
    name: "web_search_exa";
    arguments: {
      query: string;
      numResults: number;
      livecrawl: ExaWebSearchLivecrawlMode;
      type: ExaWebSearchType;
      contextMaxCharacters?: number;
    };
  };
}

interface ExaMcpSseResponse {
  result?: {
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
  error?: {
    message?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNumResults(toolParams: unknown): number {
  const numResults = isRecord(toolParams) ? toolParams.num_results : undefined;
  const maxResults = isRecord(toolParams) ? toolParams.max_results : undefined;
  const value = Number.isInteger(numResults) ? numResults : maxResults;
  if (!Number.isInteger(value)) {
    return DEFAULT_WEB_SEARCH_NUM_RESULTS;
  }
  return Math.max(1, Math.min(MAX_WEB_SEARCH_NUM_RESULTS, Number(value)));
}

function parseQuery(toolParams: unknown): string {
  const query = isRecord(toolParams) && typeof toolParams.query === "string" ? toolParams.query.trim() : "";
  if (!query) {
    throw new Error("query is required");
  }
  return query;
}

function parseLivecrawl(toolParams: unknown): ExaWebSearchLivecrawlMode {
  const value =
    isRecord(toolParams) && typeof toolParams.livecrawl === "string"
      ? toolParams.livecrawl.trim().toLowerCase()
      : "";
  return value === "preferred" ? "preferred" : "fallback";
}

function parseSearchType(toolParams: unknown): ExaWebSearchType {
  const value = isRecord(toolParams) && typeof toolParams.type === "string" ? toolParams.type.trim().toLowerCase() : "";
  switch (value) {
    case "fast":
    case "deep":
      return value;
    default:
      return "auto";
  }
}

function parseContextMaxCharacters(toolParams: unknown): number | undefined {
  const value = isRecord(toolParams) ? toolParams.context_max_characters : undefined;
  if (!Number.isInteger(value)) {
    return undefined;
  }
  return Math.max(1, Number(value));
}

function webSearchDescription(baseDescription: string): string {
  const currentYear = new Date().getFullYear();
  return `${baseDescription} Uses hosted Exa web search without authentication. The current year is ${currentYear}; include ${currentYear} in recent-information queries.`;
}

function normalizedBaseUrl(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().replace(/\/+$/, "");
  return normalized || EXA_WEB_SEARCH_BASE_URL;
}

function createSearchRequest(params: {
  query: string;
  numResults: number;
  livecrawl: ExaWebSearchLivecrawlMode;
  type: ExaWebSearchType;
  contextMaxCharacters?: number;
}): ExaMcpSearchRequest {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "web_search_exa",
      arguments: {
        query: params.query,
        numResults: params.numResults,
        livecrawl: params.livecrawl,
        type: params.type,
        ...(typeof params.contextMaxCharacters === "number"
          ? { contextMaxCharacters: params.contextMaxCharacters }
          : {}),
      },
    },
  };
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

function parseSseText(responseText: string): string {
  const lines = responseText.split(/\r?\n/g);
  for (const line of lines) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const payloadText = line.slice(6).trim();
    if (!payloadText) {
      continue;
    }
    const payload = JSON.parse(payloadText) as ExaMcpSseResponse;
    const errorMessage = payload.error?.message?.trim();
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    const text = payload.result?.content
      ?.find((entry) => entry?.type === "text" && typeof entry.text === "string")
      ?.text?.trim();
    if (text) {
      return text;
    }
  }
  return "No search results found. Please try a different query.";
}

async function searchWeb(params: {
  query: string;
  numResults: number;
  livecrawl: ExaWebSearchLivecrawlMode;
  type: ExaWebSearchType;
  contextMaxCharacters?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  baseUrl?: string | null;
  requestTimeoutMs?: number;
}): Promise<{ text: string; providerId: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const baseUrl = normalizedBaseUrl(params.baseUrl);
  const response = await fetchImpl(`${baseUrl}${EXA_WEB_SEARCH_ENDPOINT}`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(
      createSearchRequest({
        query: params.query,
        numResults: params.numResults,
        livecrawl: params.livecrawl,
        type: params.type,
        contextMaxCharacters: params.contextMaxCharacters,
      }),
    ),
    signal: requestSignal(params.signal, params.requestTimeoutMs ?? DEFAULT_WEB_SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(`web_search failed with status ${response.status}${errorText ? `: ${errorText}` : ""}`);
  }

  return {
    providerId: EXA_WEB_SEARCH_PROVIDER_ID,
    text: parseSseText(await response.text()),
  };
}

function webSearchParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query for the public web.",
        minLength: 1,
      },
      num_results: {
        type: "integer",
        description: `Number of search results to return (1-${MAX_WEB_SEARCH_NUM_RESULTS}). Defaults to ${DEFAULT_WEB_SEARCH_NUM_RESULTS}.`,
        minimum: 1,
        maximum: MAX_WEB_SEARCH_NUM_RESULTS,
      },
      max_results: {
        type: "integer",
        description: `Compatibility alias for num_results (1-${MAX_WEB_SEARCH_NUM_RESULTS}).`,
        minimum: 1,
        maximum: MAX_WEB_SEARCH_NUM_RESULTS,
      },
      livecrawl: {
        type: "string",
        enum: ["fallback", "preferred"],
        description: "Whether to prefer live crawling or only use it as fallback.",
      },
      type: {
        type: "string",
        enum: ["auto", "fast", "deep"],
        description: "Search depth mode.",
      },
      context_max_characters: {
        type: "integer",
        description: "Maximum number of context characters to request from the search backend.",
        minimum: 1,
      },
    },
    required: ["query"],
    additionalProperties: false,
  };
}

export function createHarnessNativeWebSearchToolDefinition(
  toolId: NativeWebSearchToolId,
  options: HarnessNativeWebSearchToolOptions = {},
): HarnessNativeWebSearchToolDefinitionLike {
  const definition = NATIVE_WEB_SEARCH_TOOL_DEFINITIONS.find((entry) => entry.id === toolId);
  if (!definition) {
    throw new Error(`Unknown web search tool '${toolId}'`);
  }

  const description = webSearchDescription(definition.description);
  return {
    name: definition.id,
    label: "Web Search",
    description,
    promptSnippet: `${definition.id}: ${description}`,
    parameters: webSearchParameters(),
    execute: async (_toolCallId, toolParams, signal) => {
      const query = parseQuery(toolParams);
      const numResults = parseNumResults(toolParams);
      const livecrawl = parseLivecrawl(toolParams);
      const type = parseSearchType(toolParams);
      const contextMaxCharacters = parseContextMaxCharacters(toolParams);
      const { text, providerId } = await searchWeb({
        query,
        numResults,
        livecrawl,
        type,
        contextMaxCharacters,
        fetchImpl: options.fetchImpl,
        signal,
        baseUrl: options.baseUrl,
        requestTimeoutMs: options.requestTimeoutMs,
      });
      return {
        content: [{ type: "text" as const, text }],
        details: {
          tool_id: definition.id,
          provider: providerId,
        },
      };
    },
  };
}

export async function resolveHarnessNativeWebSearchToolDefinitions(
  options: HarnessNativeWebSearchToolOptions = {},
): Promise<HarnessNativeWebSearchToolDefinitionLike[]> {
  return NATIVE_WEB_SEARCH_TOOL_DEFINITIONS.map((definition) =>
    createHarnessNativeWebSearchToolDefinition(definition.id, options),
  );
}
