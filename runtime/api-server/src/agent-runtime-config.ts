import fs from "node:fs";

import type { HarnessPromptLayerPayload } from "../../harnesses/src/types.js";
import {
  buildAgentCapabilityManifest,
  buildEnabledToolMapFromManifest,
  type AgentCapabilityManifest,
} from "./agent-capability-registry.js";
import {
  composeBaseAgentPrompt,
  type AgentCurrentUserContext,
  type AgentPendingUserMemoryContext,
  type AgentRecalledMemoryContext,
  type AgentRecentRuntimeContext,
  type AgentSessionResumeContext,
} from "./agent-runtime-prompt.js";
import type {
  AgentPromptCacheProfile,
  AgentPromptChannelContents,
  AgentPromptSection,
} from "./agent-prompt-sections.js";
import { resolveProductRuntimeConfig } from "./runtime-config.js";

export type AgentRuntimeConfigGeneralMemberPayload = {
  id: string;
  model: string;
  prompt: string;
  role?: string | null;
};

export interface AgentRuntimeConfigCliRequest {
  session_id: string;
  workspace_id: string;
  input_id: string;
  session_kind?: string | null;
  harness_id?: string | null;
  browser_tools_available?: boolean | null;
  browser_tool_ids?: string[] | null;
  runtime_tool_ids?: string[] | null;
  workspace_command_ids?: string[] | null;
  runtime_exec_model_proxy_api_key?: string | null;
  runtime_exec_sandbox_id?: string | null;
  runtime_exec_run_id?: string | null;
  recent_runtime_context?: AgentRecentRuntimeContext | null;
  session_resume_context?: AgentSessionResumeContext | null;
  recalled_memory_context?: AgentRecalledMemoryContext | null;
  current_user_context?: AgentCurrentUserContext | null;
  pending_user_memory_context?: AgentPendingUserMemoryContext | null;
  selected_model?: string | null;
  default_provider_id: string;
  session_mode: string;
  workspace_config_checksum: string;
  workspace_skill_ids: string[];
  default_tools: string[];
  extra_tools: string[];
  tool_server_id_map?: Record<string, string> | null;
  resolved_mcp_tool_refs: Array<{ tool_id: string; server_id: string; tool_name: string }>;
  resolved_output_schemas: Record<string, Record<string, unknown>>;
  agent: AgentRuntimeConfigGeneralMemberPayload;
}

export interface AgentRuntimeConfigCliResponse {
  provider_id: string;
  model_id: string;
  mode: string;
  system_prompt: string;
  context_messages?: string[];
  prompt_channel_contents?: AgentPromptChannelContents;
  prompt_sections?: AgentPromptSection[];
  prompt_layers?: HarnessPromptLayerPayload[];
  prompt_cache_profile?: AgentPromptCacheProfile;
  model_client: {
    model_proxy_provider: string;
    api_key: string;
    base_url?: string | null;
    default_headers?: Record<string, string> | null;
  };
  tools: Record<string, boolean>;
  workspace_tool_ids: string[];
  workspace_skill_ids: string[];
  output_schema_member_id?: string | null;
  output_format?: Record<string, unknown> | null;
  workspace_config_checksum: string;
  capability_manifest?: AgentCapabilityManifest;
}

const MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE = "openai_compatible";
const MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE = "anthropic_native";
const PROVIDER_KIND_HOLABOSS_PROXY = "holaboss_proxy";
const PROVIDER_KIND_OPENAI_COMPATIBLE = "openai_compatible";
const PROVIDER_KIND_ANTHROPIC_NATIVE = "anthropic_native";
const PROVIDER_KIND_OPENROUTER = "openrouter";
const HOLABOSS_PROXY_PROVIDER_ID = "holaboss_model_proxy";
const DEFAULT_RUNTIME_STRUCTURED_RETRY_COUNT = 2;
const DIRECT_OPENAI_FALLBACK_FLAG = "SANDBOX_MODEL_PROXY_ENABLE_DIRECT_OPENAI_FALLBACK";
const DIRECT_OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
const DIRECT_OPENAI_BASE_URL_ENV = "OPENAI_BASE_URL";
const DIRECT_ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
const DIRECT_ANTHROPIC_BASE_URL_ENV = "ANTHROPIC_BASE_URL";
const DIRECT_OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";
const DIRECT_OPENROUTER_BASE_URL_ENV = "OPENROUTER_BASE_URL";
const DEFAULT_DIRECT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_DIRECT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const KNOWN_DIRECT_PROVIDER_HOSTS = new Set(["api.openai.com", "api.anthropic.com"]);

interface ConfiguredRuntimeProvider {
  id: string;
  kind: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  routes: Record<string, string>;
}

interface ConfiguredRuntimeModel {
  token: string;
  providerId: string;
  modelId: string;
  modelProxyProvider: string;
}

interface RuntimeModelCatalog {
  providers: Map<string, ConfiguredRuntimeProvider>;
  models: ConfiguredRuntimeModel[];
  defaultProvider: string;
}

interface ResolvedRuntimeModelTarget {
  providerId: string;
  modelId: string;
  modelToken: string;
  modelProxyProvider: string;
  configuredProvider?: ConfiguredRuntimeProvider | null;
}

function firstNonEmptyString(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = (value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function uniqueNonEmptyStringsInOrder(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = (value ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const entries: Array<[string, string]> = [];
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string") {
      continue;
    }
    const normalizedKey = key.trim();
    const normalizedValue = item.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    entries.push([normalizedKey, normalizedValue]);
  }
  return Object.fromEntries(entries);
}

function normalizeProviderKind(rawKind: string, providerId: string, baseUrl: string): string {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const normalizedKind = rawKind.trim().toLowerCase();
  const lowerBaseUrl = baseUrl.toLowerCase();
  if (
    normalizedKind === PROVIDER_KIND_HOLABOSS_PROXY ||
    normalizedKind === HOLABOSS_PROXY_PROVIDER_ID ||
    normalizedProviderId === HOLABOSS_PROXY_PROVIDER_ID ||
    normalizedProviderId === "holaboss" ||
    normalizedProviderId.includes("holaboss")
  ) {
    return PROVIDER_KIND_HOLABOSS_PROXY;
  }
  if (!normalizedKind && lowerBaseUrl.includes("model-proxy")) {
    return PROVIDER_KIND_HOLABOSS_PROXY;
  }
  if (normalizedKind === PROVIDER_KIND_OPENROUTER || normalizedProviderId.includes("openrouter")) {
    return PROVIDER_KIND_OPENROUTER;
  }
  if (
    normalizedKind === PROVIDER_KIND_ANTHROPIC_NATIVE ||
    normalizedKind === "anthropic" ||
    normalizedKind === "anthropic_compatible" ||
    normalizedProviderId.includes("anthropic")
  ) {
    return PROVIDER_KIND_ANTHROPIC_NATIVE;
  }
  if (
    normalizedKind === PROVIDER_KIND_OPENAI_COMPATIBLE ||
    normalizedKind === "openai" ||
    normalizedKind === "openai_native" ||
    normalizedProviderId.includes("openai")
  ) {
    return PROVIDER_KIND_OPENAI_COMPATIBLE;
  }
  return PROVIDER_KIND_OPENAI_COMPATIBLE;
}

function inferModelProxyProviderFromToken(token: string): string {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) {
    return MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE;
  }
  const scopedToken = trimmed.includes("/") ? trimmed.split("/").slice(1).join("/") : trimmed;
  if (
    trimmed.startsWith("anthropic/") ||
    trimmed.startsWith("claude") ||
    scopedToken.startsWith("anthropic/") ||
    scopedToken.startsWith("claude")
  ) {
    return MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE;
  }
  return MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE;
}

function modelProxyProviderForProviderKind(kind: string, modelToken: string): string {
  const normalizedKind = kind.trim().toLowerCase();
  if (normalizedKind === PROVIDER_KIND_ANTHROPIC_NATIVE) {
    return MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE;
  }
  if (normalizedKind === PROVIDER_KIND_HOLABOSS_PROXY) {
    return inferModelProxyProviderFromToken(modelToken);
  }
  return MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE;
}

function providerRequiresUnscopedModelId(kind: string): boolean {
  const normalizedKind = kind.trim().toLowerCase();
  return (
    normalizedKind === PROVIDER_KIND_HOLABOSS_PROXY ||
    normalizedKind === PROVIDER_KIND_OPENAI_COMPATIBLE ||
    normalizedKind === PROVIDER_KIND_ANTHROPIC_NATIVE
  );
}

function assertCanonicalConfiguredModelId(provider: ConfiguredRuntimeProvider, modelId: string): void {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId || !providerRequiresUnscopedModelId(provider.kind)) {
    return;
  }
  if (!normalizedModelId.includes("/")) {
    return;
  }
  throw new Error(
    `Invalid runtime-config model for provider '${provider.id}': model '${normalizedModelId}' must be a bare model id without provider prefixes`
  );
}

function modelProxyProviderRouteSegment(modelProxyProvider: string): string {
  return modelProxyProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE ? "anthropic" : "openai";
}

function runtimeConfigDocument(): Record<string, unknown> {
  const configPath = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false,
    includeDefaultBaseUrl: false
  }).configPath;
  if (!configPath) {
    return {};
  }
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function configuredRuntimeModelCatalog(defaultProviderHint: string): RuntimeModelCatalog {
  const config = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false,
    includeDefaultBaseUrl: false
  });
  const document = runtimeConfigDocument();
  const providersPayload = asRecord(document.providers);
  const runtimePayload = asRecord(document.runtime);
  const modelsPayload = asRecord(document.models);
  const integrationsPayload = asRecord(document.integrations);
  const holabossIntegration = asRecord(integrationsPayload.holaboss);
  const providers = new Map<string, ConfiguredRuntimeProvider>();

  for (const [providerId, rawProvider] of Object.entries(providersPayload)) {
    const providerPayload = asRecord(rawProvider);
    const options = asRecord(providerPayload.options);
    const baseUrl = firstNonEmptyString(
      providerPayload.base_url as string | undefined,
      providerPayload.baseURL as string | undefined,
      options.baseURL as string | undefined,
      options.base_url as string | undefined,
      providerPayload.url as string | undefined,
      options.url as string | undefined
    );
    const apiKey = firstNonEmptyString(
      providerPayload.api_key as string | undefined,
      providerPayload.auth_token as string | undefined,
      options.apiKey as string | undefined,
      options.api_key as string | undefined,
      options.authToken as string | undefined,
      options.auth_token as string | undefined
    );
    const headers = {
      ...asStringRecord(providerPayload.headers),
      ...asStringRecord(options.headers)
    };
    const routes = {
      ...asStringRecord(providerPayload.routes),
      ...asStringRecord(options.routes)
    };
    const kind = normalizeProviderKind(
      firstNonEmptyString(
        providerPayload.kind as string | undefined,
        providerPayload.type as string | undefined,
        options.kind as string | undefined
      ),
      providerId,
      baseUrl
    );
    providers.set(providerId, {
      id: providerId,
      kind,
      baseUrl,
      apiKey,
      headers,
      routes
    });
  }

  const legacyAuthToken = firstNonEmptyString(
    config.authToken,
    holabossIntegration.auth_token as string | undefined
  );
  const legacyBaseUrl = config.modelProxyBaseUrl.trim();
  const legacyProviderId = firstNonEmptyString(
    config.defaultProvider,
    (runtimePayload.default_provider as string | undefined) ?? "",
    defaultProviderHint,
    HOLABOSS_PROXY_PROVIDER_ID
  );
  if (legacyBaseUrl || legacyAuthToken) {
    const current = providers.get(legacyProviderId);
    if (!current) {
      providers.set(legacyProviderId, {
        id: legacyProviderId,
        kind: normalizeProviderKind("", legacyProviderId, legacyBaseUrl),
        baseUrl: legacyBaseUrl,
        apiKey: legacyAuthToken,
        headers: {},
        routes: {}
      });
    } else {
      providers.set(legacyProviderId, {
        ...current,
        baseUrl: current.baseUrl || legacyBaseUrl,
        apiKey: current.apiKey || legacyAuthToken
      });
    }
  }

  const configuredModels: ConfiguredRuntimeModel[] = [];
  for (const [token, rawModel] of Object.entries(modelsPayload)) {
    const modelPayload = asRecord(rawModel);
    let providerId = firstNonEmptyString(
      modelPayload.provider_id as string | undefined,
      modelPayload.provider as string | undefined
    );
    let modelId = firstNonEmptyString(
      modelPayload.model_id as string | undefined,
      modelPayload.model as string | undefined
    );
    if (!providerId && token.includes("/")) {
      const [prefix, ...rest] = token.split("/");
      if (providers.has(prefix) && rest.length > 0) {
        providerId = prefix;
        modelId = modelId || rest.join("/");
      }
    }
    if (!providerId || !modelId) {
      continue;
    }
    const provider = providers.get(providerId);
    if (!provider) {
      continue;
    }
    assertCanonicalConfiguredModelId(provider, modelId);
    configuredModels.push({
      token,
      providerId,
      modelId,
      modelProxyProvider: modelProxyProviderForProviderKind(provider.kind, modelId)
    });
  }

  return {
    providers,
    models: configuredModels,
    defaultProvider: firstNonEmptyString(config.defaultProvider, defaultProviderHint)
  };
}

function legacyRuntimeProviderId(modelProxyProvider: string): string {
  return modelProxyProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE ? "anthropic" : "openai";
}

function runtimeProviderIdForConfiguredProvider(
  provider: ConfiguredRuntimeProvider,
  modelProxyProvider: string
): string {
  if (provider.kind === PROVIDER_KIND_HOLABOSS_PROXY) {
    return legacyRuntimeProviderId(modelProxyProvider);
  }
  return provider.id;
}

function firstConfiguredProviderByKind(catalog: RuntimeModelCatalog, kind: string): ConfiguredRuntimeProvider | null {
  for (const provider of catalog.providers.values()) {
    if (provider.kind === kind) {
      return provider;
    }
  }
  return null;
}

function defaultConfiguredProvider(catalog: RuntimeModelCatalog, defaultProviderHint: string): ConfiguredRuntimeProvider | null {
  const candidateIds = [
    catalog.defaultProvider,
    defaultProviderHint,
    HOLABOSS_PROXY_PROVIDER_ID
  ]
    .map((token) => token.trim())
    .filter(Boolean);

  for (const providerId of candidateIds) {
    const provider = catalog.providers.get(providerId);
    if (provider) {
      return provider;
    }
  }

  if (catalog.providers.size === 1) {
    return Array.from(catalog.providers.values())[0] ?? null;
  }

  return null;
}

function resolveRuntimeModelTarget(modelToken: string, defaultProviderHint: string): ResolvedRuntimeModelTarget {
  const token = modelToken.trim();
  if (!token) {
    throw new Error("model must be a non-empty string");
  }

  const catalog = configuredRuntimeModelCatalog(defaultProviderHint);
  const configuredModel =
    catalog.models.find((entry) => entry.token === token) ??
    (catalog.models.filter((entry) => entry.modelId === token).length === 1
      ? catalog.models.find((entry) => entry.modelId === token)
      : null);
  if (configuredModel) {
    const configuredProvider = catalog.providers.get(configuredModel.providerId) ?? null;
    const resolvedProviderId = configuredProvider
      ? runtimeProviderIdForConfiguredProvider(configuredProvider, configuredModel.modelProxyProvider)
      : configuredModel.providerId;
    return {
      providerId: resolvedProviderId,
      modelId: configuredModel.modelId,
      modelToken: configuredModel.token,
      modelProxyProvider: configuredModel.modelProxyProvider,
      configuredProvider
    };
  }

  if (token.includes("/")) {
    const [providerToken, ...rest] = token.split("/");
    const normalizedProviderToken = providerToken.trim();
    const modelId = rest.join("/").trim();
    if (!modelId) {
      throw new Error("model id segment after provider must be non-empty");
    }

    const configuredProvider = catalog.providers.get(normalizedProviderToken);
    if (configuredProvider) {
      assertCanonicalConfiguredModelId(configuredProvider, modelId);
      const modelProxyProvider = modelProxyProviderForProviderKind(configuredProvider.kind, modelId);
      return {
        providerId: runtimeProviderIdForConfiguredProvider(configuredProvider, modelProxyProvider),
        modelId,
        modelToken: token,
        modelProxyProvider,
        configuredProvider
      };
    }

    if (
      normalizedProviderToken === HOLABOSS_PROXY_PROVIDER_ID ||
      normalizedProviderToken === "holaboss" ||
      normalizedProviderToken.includes("holaboss")
    ) {
      const modelProxyProvider = inferModelProxyProviderFromToken(modelId);
      const holabossProvider = firstConfiguredProviderByKind(catalog, PROVIDER_KIND_HOLABOSS_PROXY);
      if (holabossProvider) {
        return {
          providerId: runtimeProviderIdForConfiguredProvider(holabossProvider, modelProxyProvider),
          modelId,
          modelToken: token,
          modelProxyProvider,
          configuredProvider: holabossProvider
        };
      }
      return {
        providerId: legacyRuntimeProviderId(modelProxyProvider),
        modelId,
        modelToken: token,
        modelProxyProvider,
        configuredProvider: null
      };
    }

    const normalizedModelProxyProvider = normalizeModelProxyProvider(normalizedProviderToken);
    if (
      normalizedModelProxyProvider === MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE ||
      normalizedModelProxyProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE
    ) {
      return {
        providerId: legacyRuntimeProviderId(normalizedModelProxyProvider),
        modelId,
        modelToken: token,
        modelProxyProvider: normalizedModelProxyProvider,
        configuredProvider: null
      };
    }
  }

  const normalizedToken = token.toLowerCase();
  const defaultProvider = defaultConfiguredProvider(catalog, defaultProviderHint);
  if (normalizedToken.startsWith("claude")) {
    const anthropicProvider = firstConfiguredProviderByKind(catalog, PROVIDER_KIND_ANTHROPIC_NATIVE) ?? defaultProvider;
    if (anthropicProvider) {
      const modelProxyProvider = modelProxyProviderForProviderKind(anthropicProvider.kind, token);
      return {
        providerId: runtimeProviderIdForConfiguredProvider(anthropicProvider, modelProxyProvider),
        modelId: token,
        modelToken: token,
        modelProxyProvider,
        configuredProvider: anthropicProvider
      };
    }
    return {
      providerId: "anthropic",
      modelId: token,
      modelToken: token,
      modelProxyProvider: MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE,
      configuredProvider: null
    };
  }

  if (defaultProvider) {
    const modelProxyProvider = modelProxyProviderForProviderKind(defaultProvider.kind, token);
    return {
      providerId: runtimeProviderIdForConfiguredProvider(defaultProvider, modelProxyProvider),
      modelId: token,
      modelToken: token,
      modelProxyProvider,
      configuredProvider: defaultProvider
    };
  }

  const normalizedDefaultProvider = normalizeModelProxyProvider(defaultProviderHint);
  const defaultModelProxyProvider =
    normalizedDefaultProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE
      ? MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE
      : MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE;
  return {
    providerId: legacyRuntimeProviderId(defaultModelProxyProvider),
    modelId: token,
    modelToken: token,
    modelProxyProvider: defaultModelProxyProvider,
    configuredProvider: null
  };
}

function directOpenaiFallbackEnabled(): boolean {
  const raw = (process.env[DIRECT_OPENAI_FALLBACK_FLAG] ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function providerPathSegment(provider: string): string {
  return provider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE ? "anthropic" : "openai";
}

function shouldTreatAsDirectProviderBaseUrl(baseRoot: string): boolean {
  const normalizedRoot = baseRoot.replace(/\/+$/, "");
  if (!normalizedRoot) {
    return false;
  }
  try {
    const parsed = new URL(normalizedRoot);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    if (normalizedPath.includes("model-proxy")) {
      return false;
    }
    if (
      normalizedPath.endsWith("/openai/v1") ||
      normalizedPath.endsWith("/anthropic/v1") ||
      normalizedPath.includes("/model-proxy/")
    ) {
      return false;
    }
    if (normalizedPath === "/v1") {
      return true;
    }
    if ((normalizedPath === "" || normalizedPath === "/") && KNOWN_DIRECT_PROVIDER_HOSTS.has(parsed.hostname.toLowerCase())) {
      return true;
    }
    return false;
  } catch {
    return normalizedRoot.toLowerCase().endsWith("/v1");
  }
}

function appendProviderRoute(baseRoot: string, provider: string): string {
  const normalizedRoot = baseRoot.replace(/\/+$/, "");
  return `${normalizedRoot}/${providerPathSegment(provider)}/v1`;
}

function normalizeDirectProviderBaseUrl(baseRoot: string): string {
  const normalizedRoot = baseRoot.replace(/\/+$/, "");
  try {
    const parsed = new URL(normalizedRoot);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      return `${normalizedRoot}/v1`;
    }
    return normalizedRoot;
  } catch {
    return normalizedRoot;
  }
}

function isProviderScopedV1Path(baseRoot: string, provider: string): boolean {
  const segment = providerPathSegment(provider);
  const normalizedRoot = baseRoot.replace(/\/+$/, "");
  try {
    const parsed = new URL(normalizedRoot);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    return normalizedPath.endsWith(`/${segment}/v1`);
  } catch {
    return normalizedRoot.toLowerCase().endsWith(`/${segment}/v1`);
  }
}

function baseUrlForProvider(baseRoot: string, provider: string, options?: { forceProxyRoute?: boolean }): string {
  const normalizedProvider = normalizeModelProxyProvider(provider);
  if (!baseRoot) {
    return "";
  }
  if (options?.forceProxyRoute) {
    return appendProviderRoute(baseRoot, normalizedProvider);
  }
  if (shouldTreatAsDirectProviderBaseUrl(baseRoot)) {
    return normalizeDirectProviderBaseUrl(baseRoot);
  }
  if (isProviderScopedV1Path(baseRoot, normalizedProvider)) {
    return normalizeDirectProviderBaseUrl(baseRoot);
  }
  return appendProviderRoute(baseRoot, normalizedProvider);
}

function modelProxyBaseUrlForProvider(
  provider: string,
  options?: {
    allowMissingBaseRoot?: boolean;
    forceProxyRoute?: boolean;
  }
): string {
  const normalizedProvider = normalizeModelProxyProvider(provider);
  const baseRoot = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: !(options?.allowMissingBaseRoot ?? false),
    includeDefaultBaseUrl: false
  }).modelProxyBaseUrl.replace(/\/+$/, "");
  return baseUrlForProvider(baseRoot, normalizedProvider, {
    forceProxyRoute: options?.forceProxyRoute
  });
}

function configuredModelClient(provider: string): { apiKey: string; baseRoot: string } {
  const normalizedProvider = normalizeModelProxyProvider(provider);
  const runtimeConfig = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false,
    includeDefaultBaseUrl: false
  });
  const providerApiKeyEnv =
    normalizedProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE ? DIRECT_ANTHROPIC_API_KEY_ENV : DIRECT_OPENAI_API_KEY_ENV;
  const providerBaseUrlEnv =
    normalizedProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE ? DIRECT_ANTHROPIC_BASE_URL_ENV : DIRECT_OPENAI_BASE_URL_ENV;
  return {
    apiKey: firstNonEmptyString(runtimeConfig.authToken, process.env[providerApiKeyEnv]),
    baseRoot: firstNonEmptyString(runtimeConfig.modelProxyBaseUrl, process.env[providerBaseUrlEnv]).replace(/\/+$/, "")
  };
}

function configuredProviderFallbackCredentials(
  provider: ConfiguredRuntimeProvider,
  modelProxyProvider: string
): { apiKey: string; baseRoot: string } {
  const normalizedModelProxyProvider = normalizeModelProxyProvider(modelProxyProvider);
  if (provider.kind === PROVIDER_KIND_OPENROUTER) {
    return {
      apiKey: firstNonEmptyString(provider.apiKey, process.env[DIRECT_OPENROUTER_API_KEY_ENV]),
      baseRoot: firstNonEmptyString(provider.baseUrl, process.env[DIRECT_OPENROUTER_BASE_URL_ENV], DEFAULT_DIRECT_OPENROUTER_BASE_URL)
        .replace(/\/+$/, "")
    };
  }
  if (provider.kind === PROVIDER_KIND_ANTHROPIC_NATIVE || normalizedModelProxyProvider === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE) {
    return {
      apiKey: firstNonEmptyString(provider.apiKey, process.env[DIRECT_ANTHROPIC_API_KEY_ENV]),
      baseRoot: firstNonEmptyString(provider.baseUrl, process.env[DIRECT_ANTHROPIC_BASE_URL_ENV]).replace(/\/+$/, "")
    };
  }
  return {
    apiKey: firstNonEmptyString(provider.apiKey, process.env[DIRECT_OPENAI_API_KEY_ENV]),
    baseRoot: firstNonEmptyString(provider.baseUrl, process.env[DIRECT_OPENAI_BASE_URL_ENV]).replace(/\/+$/, "")
  };
}

function configuredProviderProxyRoute(provider: ConfiguredRuntimeProvider, modelProxyProvider: string): string {
  const normalizedProvider = normalizeModelProxyProvider(modelProxyProvider);
  const directRoute = firstNonEmptyString(
    provider.routes[normalizedProvider],
    provider.routes[modelProxyProviderRouteSegment(normalizedProvider)]
  );
  if (!directRoute) {
    return appendProviderRoute(provider.baseUrl, normalizedProvider);
  }
  const normalizedBase = provider.baseUrl.replace(/\/+$/, "");
  const normalizedRoute = directRoute.startsWith("/") ? directRoute : `/${directRoute}`;
  return `${normalizedBase}${normalizedRoute}`;
}

function resolveModelClientConfig(request: AgentRuntimeConfigCliRequest, target: ResolvedRuntimeModelTarget): {
  model_proxy_provider: string;
  api_key: string;
  base_url?: string | null;
  default_headers?: Record<string, string> | null;
} {
  const normalizedProvider = normalizeModelProxyProvider(target.modelProxyProvider);
  if (
    normalizedProvider !== MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE &&
    normalizedProvider !== MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE
  ) {
    throw new Error(
      `resolved model proxy provider=${target.modelProxyProvider} is unsupported; expected one of: ` +
        `${MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE}, ${MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE}`
    );
  }

  const proxyApiKey = request.runtime_exec_model_proxy_api_key?.trim() ?? "";
  const sandboxId = request.runtime_exec_sandbox_id?.trim() ?? "";
  const runId = request.runtime_exec_run_id?.trim() ?? "";
  if (proxyApiKey && sandboxId) {
    const headers: Record<string, string> = {
      "X-API-Key": proxyApiKey,
      "X-Holaboss-Sandbox-Id": sandboxId,
      "X-Holaboss-Session-Id": request.session_id,
      "X-Holaboss-Workspace-Id": request.workspace_id,
      "X-Holaboss-Input-Id": request.input_id
    };
    if (runId) {
      headers["X-Holaboss-Run-Id"] = runId;
    }
    return {
      model_proxy_provider: normalizedProvider,
      api_key: proxyApiKey,
      base_url: modelProxyBaseUrlForProvider(normalizedProvider, { forceProxyRoute: true }),
      default_headers: headers
    };
  }

  const configuredProvider = target.configuredProvider;
  if (configuredProvider) {
    const credentials = configuredProviderFallbackCredentials(configuredProvider, normalizedProvider);
    if (credentials.apiKey && credentials.baseRoot) {
      const baseUrl =
        configuredProvider.kind === PROVIDER_KIND_HOLABOSS_PROXY
          ? configuredProviderProxyRoute(
              {
                ...configuredProvider,
                baseUrl: credentials.baseRoot
              },
              normalizedProvider
            )
          : configuredProvider.kind === PROVIDER_KIND_OPENROUTER
            ? normalizeDirectProviderBaseUrl(credentials.baseRoot)
            : baseUrlForProvider(credentials.baseRoot, normalizedProvider);
      const configuredHeaders = Object.keys(configuredProvider.headers).length > 0 ? { ...configuredProvider.headers } : null;
      return {
        model_proxy_provider: normalizedProvider,
        api_key: credentials.apiKey,
        base_url: baseUrl,
        default_headers: configuredHeaders
      };
    }
  }

  const configured = configuredModelClient(normalizedProvider);
  if (configured.apiKey && configured.baseRoot) {
    return {
      model_proxy_provider: normalizedProvider,
      api_key: configured.apiKey,
      base_url: baseUrlForProvider(configured.baseRoot, normalizedProvider)
    };
  }

  if (normalizedProvider === MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE && directOpenaiFallbackEnabled()) {
    const directApiKey = (process.env[DIRECT_OPENAI_API_KEY_ENV] ?? "").trim();
    if (directApiKey) {
      return {
        model_proxy_provider: MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE,
        api_key: directApiKey,
        base_url: baseUrlForProvider(
          firstNonEmptyString(process.env[DIRECT_OPENAI_BASE_URL_ENV], DEFAULT_DIRECT_OPENAI_BASE_URL),
          MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE
        )
      };
    }
  }

  const missingVars: string[] = [];
  if (!proxyApiKey) {
    missingVars.push("_sandbox_runtime_exec_v1.model_proxy_api_key");
  }
  if (!sandboxId) {
    missingVars.push("_sandbox_runtime_exec_v1.sandbox_id");
  }
  let message = `Sandbox model proxy is not configured (missing: ${missingVars.join(", ")})`;
  message +=
    "; or configure a provider in runtime-config.json providers{} " +
    "with base_url + api_key.";
  if (normalizedProvider === MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE && directOpenaiFallbackEnabled()) {
    message += "; OPENAI_API_KEY is also missing for direct fallback.";
  }
  throw new Error(message);
}

function normalizeModelProxyProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "openai" || normalized === MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE) {
    return MODEL_PROXY_PROVIDER_OPENAI_COMPATIBLE;
  }
  if (normalized === "anthropic" || normalized === MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE) {
    return MODEL_PROXY_PROVIDER_ANTHROPIC_NATIVE;
  }
  return normalized;
}

function runtimeStructuredRetryCount(): number {
  const raw = (process.env.HOLABOSS_STRUCTURED_OUTPUT_RETRY_COUNT ?? String(DEFAULT_RUNTIME_STRUCTURED_RETRY_COUNT)).trim();
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return DEFAULT_RUNTIME_STRUCTURED_RETRY_COUNT;
  }
  return Math.max(0, Math.min(value, 10));
}

function selectedRuntimeOutputSchema(
  request: AgentRuntimeConfigCliRequest
): { outputSchemaMemberId: string | null; outputFormat: Record<string, unknown> | null } {
  const memberId = request.agent.id.trim();
  if (!memberId) {
    return { outputSchemaMemberId: null, outputFormat: null };
  }
  const schema = request.resolved_output_schemas[memberId];
  return {
    outputSchemaMemberId: memberId,
    outputFormat: schema
      ? {
          type: "json_schema",
          schema,
          retryCount: runtimeStructuredRetryCount()
        }
      : null
  };
}

export function projectAgentRuntimeConfig(
  request: AgentRuntimeConfigCliRequest
): AgentRuntimeConfigCliResponse {
  const selectedModel = request.selected_model?.trim() || request.agent.model;
  const capabilityManifest = buildAgentCapabilityManifest({
    harnessId: request.harness_id ?? null,
    sessionKind: request.session_kind ?? null,
    browserToolsAvailable:
      typeof request.browser_tools_available === "boolean" ? request.browser_tools_available : null,
    browserToolIds: request.browser_tool_ids ?? null,
    runtimeToolIds: request.runtime_tool_ids ?? null,
    workspaceCommandIds: request.workspace_command_ids ?? null,
    defaultTools: request.default_tools,
    extraTools: request.extra_tools,
    workspaceSkillIds: request.workspace_skill_ids ?? [],
    resolvedMcpToolRefs: request.resolved_mcp_tool_refs,
    toolServerIdMap: request.tool_server_id_map ?? null,
  });
  const promptComposition = composeBaseAgentPrompt(request.agent.prompt, {
    defaultTools: request.default_tools,
    extraTools: request.extra_tools,
    workspaceSkillIds: request.workspace_skill_ids ?? [],
    resolvedMcpToolRefs: request.resolved_mcp_tool_refs,
    sessionKind: request.session_kind ?? null,
    sessionMode: request.session_mode,
    harnessId: request.harness_id ?? null,
    recentRuntimeContext: request.recent_runtime_context ?? null,
    sessionResumeContext: request.session_resume_context ?? null,
    recalledMemoryContext: request.recalled_memory_context ?? null,
    currentUserContext: request.current_user_context ?? null,
    pendingUserMemoryContext: request.pending_user_memory_context ?? null,
    capabilityManifest,
  });

  const target = resolveRuntimeModelTarget(selectedModel, request.default_provider_id);
  const workspaceToolIds = uniqueNonEmptyStringsInOrder(
    request.resolved_mcp_tool_refs.map((toolRef) => toolRef.tool_id)
  );
  const tools = buildEnabledToolMapFromManifest(capabilityManifest);

  const { outputSchemaMemberId, outputFormat } = selectedRuntimeOutputSchema(request);
  return {
    provider_id: target.providerId,
    model_id: target.modelId,
    mode: request.session_mode,
    system_prompt: promptComposition.systemPrompt,
    context_messages: promptComposition.contextMessages,
    prompt_channel_contents: promptComposition.promptChannelContents,
    prompt_sections: promptComposition.promptSections,
    prompt_layers: promptComposition.promptLayers,
    prompt_cache_profile: promptComposition.promptCacheProfile,
    model_client: resolveModelClientConfig(request, target),
    tools,
    workspace_tool_ids: workspaceToolIds,
    workspace_skill_ids: request.workspace_skill_ids ?? [],
    output_schema_member_id: outputSchemaMemberId,
    output_format: outputFormat,
    workspace_config_checksum: request.workspace_config_checksum,
    capability_manifest: capabilityManifest,
  };
}
