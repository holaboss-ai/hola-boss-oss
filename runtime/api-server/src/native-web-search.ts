export type ExaWebSearchLivecrawlMode = "fallback" | "preferred";
export type ExaWebSearchType = "auto" | "fast" | "deep";

export interface NativeWebSearchParams {
  query: string;
  numResults?: number | null;
  maxResults?: number | null;
  livecrawl?: string | null;
  type?: string | null;
  contextMaxCharacters?: number | null;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  baseUrl?: string | null;
  requestTimeoutMs?: number;
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

export const EXA_WEB_SEARCH_BASE_URL = "https://mcp.exa.ai";
export const EXA_WEB_SEARCH_ENDPOINT = "/mcp";
export const DEFAULT_WEB_SEARCH_NUM_RESULTS = 8;
export const MAX_WEB_SEARCH_NUM_RESULTS = 10;
export const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 25_000;
export const EXA_WEB_SEARCH_PROVIDER_ID = "exa_hosted_mcp";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseWebSearchNumResults(params: {
  numResults?: number | null;
  maxResults?: number | null;
}): number {
  const value = Number.isInteger(params.numResults)
    ? params.numResults
    : Number.isInteger(params.maxResults)
      ? params.maxResults
      : DEFAULT_WEB_SEARCH_NUM_RESULTS;
  return Math.max(1, Math.min(MAX_WEB_SEARCH_NUM_RESULTS, Number(value)));
}

export function parseWebSearchQuery(value: unknown): string {
  const query = typeof value === "string" ? value.trim() : "";
  if (!query) {
    throw new Error("query is required");
  }
  return query;
}

export function parseWebSearchLivecrawl(value: unknown): ExaWebSearchLivecrawlMode {
  return typeof value === "string" && value.trim().toLowerCase() === "preferred"
    ? "preferred"
    : "fallback";
}

export function parseWebSearchType(value: unknown): ExaWebSearchType {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "fast":
    case "deep":
      return normalized;
    default:
      return "auto";
  }
}

export function parseWebSearchContextMaxCharacters(value: unknown): number | undefined {
  if (!Number.isInteger(value)) {
    return undefined;
  }
  return Math.max(1, Number(value));
}

export function webSearchDescription(baseDescription: string): string {
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
    const text = payload.result?.content?.find((entry) => entry?.type === "text" && typeof entry.text === "string")?.text?.trim();
    if (text) {
      return text;
    }
  }
  return "No search results found. Please try a different query.";
}

export async function searchPublicWeb(params: NativeWebSearchParams): Promise<{ text: string; providerId: string }> {
  const query = parseWebSearchQuery(params.query);
  const numResults = parseWebSearchNumResults({
    numResults: params.numResults,
    maxResults: params.maxResults,
  });
  const livecrawl = parseWebSearchLivecrawl(params.livecrawl);
  const type = parseWebSearchType(params.type);
  const contextMaxCharacters = parseWebSearchContextMaxCharacters(params.contextMaxCharacters);
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
        query,
        numResults,
        livecrawl,
        type,
        contextMaxCharacters,
      })
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

export function nativeWebSearchPayload(payload: unknown): {
  query: string;
  numResults: number;
  livecrawl: ExaWebSearchLivecrawlMode;
  type: ExaWebSearchType;
  contextMaxCharacters?: number;
} {
  const params = isRecord(payload) ? payload : {};
  return {
    query: parseWebSearchQuery(params.query),
    numResults: parseWebSearchNumResults({
      numResults: Number.isInteger(params.num_results) ? Number(params.num_results) : null,
      maxResults: Number.isInteger(params.max_results) ? Number(params.max_results) : null,
    }),
    livecrawl: parseWebSearchLivecrawl(params.livecrawl),
    type: parseWebSearchType(params.type),
    ...(typeof parseWebSearchContextMaxCharacters(params.context_max_characters) === "number"
      ? { contextMaxCharacters: parseWebSearchContextMaxCharacters(params.context_max_characters) }
      : {}),
  };
}
