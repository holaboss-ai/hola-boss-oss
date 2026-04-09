import fs from "node:fs";

import {
  resolveRuntimeModelClient,
  resolveRuntimeModelReference,
} from "./agent-runtime-config.js";
import type { MemoryModelClientConfig } from "./memory-model-client.js";
import { resolveProductRuntimeConfig } from "./runtime-config.js";

const HOLABOSS_PROVIDER_ID = "holaboss_model_proxy";
const IMAGE_GENERATION_ALLOWED_PROVIDER_IDS = new Set([
  HOLABOSS_PROVIDER_ID,
  "openai_direct",
  "openrouter_direct",
  "gemini_direct",
]);
const PROVIDER_ID_ALIASES: Record<string, string> = {
  holaboss: HOLABOSS_PROVIDER_ID,
  [HOLABOSS_PROVIDER_ID]: HOLABOSS_PROVIDER_ID,
  openai: "openai_direct",
  openai_direct: "openai_direct",
  openrouter: "openrouter_direct",
  openrouter_direct: "openrouter_direct",
  gemini: "gemini_direct",
  google: "gemini_direct",
  gemini_direct: "gemini_direct",
};
const LEGACY_DIRECT_PROVIDER_MODEL_ALIASES: Record<string, Record<string, string>> = {
  gemini_direct: {
    "imagen-3.0-generate-002": "gemini-3.1-flash-image-preview",
    "imagen-4.0-generate-001": "gemini-3.1-flash-image-preview",
  },
};
const IMAGE_GENERATION_MODEL_DEFAULTS: Record<string, string | null> = {
  [HOLABOSS_PROVIDER_ID]: "gpt-image-1.5",
  openai_direct: "gpt-image-1.5",
  openrouter_direct: "google/gemini-3.1-flash-image-preview",
  gemini_direct: "gemini-3.1-flash-image-preview",
};
const OPENAI_COMPATIBLE_MODEL_PROXY_PROVIDERS = new Set([
  "openai_compatible",
  "google_compatible",
]);
const GEMINI_NATIVE_HOST = "generativelanguage.googleapis.com";
const GEMINI_NATIVE_PATH = "/v1beta";

function normalizeGeminiNativeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.hostname.toLowerCase() !== GEMINI_NATIVE_HOST) {
      return normalized;
    }
    const pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    if (pathname === "" || pathname === "/" || pathname === GEMINI_NATIVE_PATH) {
      return `${parsed.origin}${GEMINI_NATIVE_PATH}`;
    }
    if (pathname === `${GEMINI_NATIVE_PATH}/openai`) {
      return `${parsed.origin}${GEMINI_NATIVE_PATH}`;
    }
    return normalized;
  } catch {
    return normalized.replace(/\/openai$/i, "");
  }
}

export interface ImageGenerationModelSelection {
  providerId: string;
  modelId: string | null;
  source: "configured" | "default" | "disabled";
}

export interface CreateImageGenerationModelClientParams {
  workspaceId: string;
  sessionId: string;
  inputId: string;
  selectedModel?: string | null;
  defaultProviderId?: string | null;
  explicitProviderId?: string | null;
  runtimeExecModelProxyApiKey?: string | null;
  runtimeExecSandboxId?: string | null;
  runtimeExecRunId?: string | null;
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeImageGenerationProviderId(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  const providerId = PROVIDER_ID_ALIASES[normalized] ?? normalized;
  return IMAGE_GENERATION_ALLOWED_PROVIDER_IDS.has(providerId) ? providerId : "";
}

function normalizeImageGenerationModelId(providerId: string, value: string | null | undefined): string {
  const normalizedProviderId = normalizeImageGenerationProviderId(providerId);
  const normalizedValue = (value ?? "").trim();
  if (!normalizedProviderId || !normalizedValue) {
    return normalizedValue;
  }
  return LEGACY_DIRECT_PROVIDER_MODEL_ALIASES[normalizedProviderId]?.[normalizedValue] ?? normalizedValue;
}

function runtimeConfigDocument(): Record<string, unknown> {
  const runtimeConfig = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false,
    includeDefaultBaseUrl: false,
  });
  const configPath = runtimeConfig.configPath?.trim() ?? "";
  if (!configPath || !fs.existsSync(configPath)) {
    return {};
  }
  try {
    return asRecord(JSON.parse(fs.readFileSync(configPath, "utf8")));
  } catch {
    return {};
  }
}

function providerPayloadForId(document: Record<string, unknown>, providerId: string): Record<string, unknown> {
  const providersPayload = asRecord(document.providers);
  if (providerId === HOLABOSS_PROVIDER_ID) {
    return asRecord(providersPayload[HOLABOSS_PROVIDER_ID] ?? providersPayload.holaboss);
  }
  return asRecord(providersPayload[providerId]);
}

function runtimePayload(document: Record<string, unknown>): Record<string, unknown> {
  return asRecord(document.runtime);
}

function configuredImageGenerationSettings(document: Record<string, unknown>): {
  providerId: string;
  modelId: string;
} {
  const runtimeSettings = runtimePayload(document);
  const imageGenerationPayload = asRecord(
    runtimeSettings.image_generation ?? runtimeSettings.imageGeneration,
  );
  const providerId = normalizeImageGenerationProviderId(
    firstNonEmptyString(
      imageGenerationPayload.provider as string | undefined,
      imageGenerationPayload.provider_id as string | undefined,
      imageGenerationPayload.providerId as string | undefined,
    ),
  );
  return {
    providerId,
    modelId: normalizeImageGenerationModelId(
      providerId,
      firstNonEmptyString(
        imageGenerationPayload.model as string | undefined,
        imageGenerationPayload.model_id as string | undefined,
        imageGenerationPayload.modelId as string | undefined,
      ),
    ),
  };
}

function configuredImageModelForProvider(document: Record<string, unknown>, providerId: string): string {
  const providerPayload = providerPayloadForId(document, providerId);
  const optionsPayload = asRecord(providerPayload.options);
  return firstNonEmptyString(
    providerPayload.image_model as string | undefined,
    providerPayload.imageModel as string | undefined,
    optionsPayload.image_model as string | undefined,
    optionsPayload.imageModel as string | undefined,
  );
}

function imageGenerationProviderIsAvailable(
  document: Record<string, unknown>,
  providerId: string,
  runtimeConfig: ReturnType<typeof resolveProductRuntimeConfig>,
): boolean {
  const normalizedProviderId = normalizeImageGenerationProviderId(providerId);
  if (!normalizedProviderId) {
    return false;
  }
  if (normalizedProviderId === HOLABOSS_PROVIDER_ID) {
    return Boolean(
      runtimeConfig.authToken.trim() ||
        runtimeConfig.modelProxyBaseUrl.trim() ||
        Object.keys(providerPayloadForId(document, normalizedProviderId)).length > 0,
    );
  }
  return Object.keys(providerPayloadForId(document, normalizedProviderId)).length > 0;
}

export function defaultImageGenerationModelForProvider(providerId: string): string | null {
  const normalizedProviderId = normalizeImageGenerationProviderId(providerId);
  const value = IMAGE_GENERATION_MODEL_DEFAULTS[normalizedProviderId];
  return typeof value === "string"
    ? normalizeImageGenerationModelId(normalizedProviderId, value)
    : null;
}

export function resolveImageGenerationModelSelection(params: {
  selectedModel?: string | null;
  defaultProviderId?: string | null;
  explicitProviderId?: string | null;
}): ImageGenerationModelSelection {
  const runtimeConfig = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false,
    includeDefaultBaseUrl: false,
  });
  const document = runtimeConfigDocument();
  const configuredSettings = configuredImageGenerationSettings(document);
  if (configuredSettings.providerId) {
    if (!imageGenerationProviderIsAvailable(document, configuredSettings.providerId, runtimeConfig)) {
      return {
        providerId: configuredSettings.providerId,
        modelId: null,
        source: "disabled",
      };
    }
    return {
      providerId: configuredSettings.providerId,
      modelId: configuredSettings.modelId || null,
      source: configuredSettings.modelId ? "configured" : "disabled",
    };
  }

  const defaultProviderId = normalizeImageGenerationProviderId(
    firstNonEmptyString(params.defaultProviderId, runtimeConfig.defaultProvider),
  );
  let providerId = normalizeImageGenerationProviderId(params.explicitProviderId);
  if (!providerId) {
    const selectedModel = firstNonEmptyString(params.selectedModel, runtimeConfig.defaultModel);
    if (selectedModel) {
      try {
        const resolved = resolveRuntimeModelReference(
          selectedModel,
          defaultProviderId || runtimeConfig.defaultProvider,
        );
        providerId = normalizeImageGenerationProviderId(
          resolved.configuredProviderId ?? resolved.providerId,
        );
      } catch {
        providerId = "";
      }
    }
  }
  if (!providerId && runtimeConfig.modelProxyBaseUrl.trim()) {
    providerId = HOLABOSS_PROVIDER_ID;
  }

  if (!imageGenerationProviderIsAvailable(document, providerId, runtimeConfig)) {
    return {
      providerId,
      modelId: null,
      source: "disabled",
    };
  }

  const configuredModelId = normalizeImageGenerationModelId(
    providerId,
    configuredImageModelForProvider(document, providerId),
  );
  if (configuredModelId) {
    return {
      providerId,
      modelId: configuredModelId,
      source: "configured",
    };
  }

  const defaultModelId = defaultImageGenerationModelForProvider(providerId);
  if (defaultModelId) {
    return {
      providerId,
      modelId: defaultModelId,
      source: "default",
    };
  }

  return {
    providerId,
    modelId: null,
    source: "disabled",
  };
}

export function createImageGenerationModelClient(
  params: CreateImageGenerationModelClientParams,
): MemoryModelClientConfig | null {
  const runtimeConfig = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false,
    includeDefaultBaseUrl: false,
  });
  const selection = resolveImageGenerationModelSelection({
    selectedModel: params.selectedModel,
    defaultProviderId: params.defaultProviderId,
    explicitProviderId: params.explicitProviderId,
  });
  if (!selection.providerId || !selection.modelId) {
    return null;
  }

  let resolved;
  try {
    resolved = resolveRuntimeModelClient({
      selectedModel: `${selection.providerId}/${selection.modelId}`,
      defaultProviderId:
        normalizeImageGenerationProviderId(
          firstNonEmptyString(params.defaultProviderId, runtimeConfig.defaultProvider, selection.providerId),
        ) || selection.providerId,
      sessionId: params.sessionId,
      workspaceId: params.workspaceId,
      inputId: params.inputId,
      runtimeExecModelProxyApiKey: firstNonEmptyString(
        params.runtimeExecModelProxyApiKey,
        runtimeConfig.authToken,
      ),
      runtimeExecSandboxId: firstNonEmptyString(params.runtimeExecSandboxId, runtimeConfig.sandboxId),
      runtimeExecRunId: params.runtimeExecRunId ?? null,
    });
  } catch {
    return null;
  }

  if (!OPENAI_COMPATIBLE_MODEL_PROXY_PROVIDERS.has(resolved.modelClient.model_proxy_provider)) {
    return null;
  }

  const baseUrl = (resolved.modelClient.base_url ?? "").trim();
  const apiKey = resolved.modelClient.api_key.trim();
  if (!baseUrl || !apiKey) {
    return null;
  }

  if (selection.providerId === "gemini_direct") {
    return {
      baseUrl: normalizeGeminiNativeBaseUrl(baseUrl),
      apiKey,
      defaultHeaders: resolved.modelClient.default_headers ?? null,
      modelId: resolved.modelId,
      apiStyle: "google_native",
    };
  }

  if (selection.providerId === "openrouter_direct") {
    return {
      baseUrl,
      apiKey,
      defaultHeaders: resolved.modelClient.default_headers ?? null,
      modelId: resolved.modelId,
      apiStyle: "openrouter_image",
    };
  }

  return {
    baseUrl,
    apiKey,
    defaultHeaders: resolved.modelClient.default_headers ?? null,
    modelId: resolved.modelId,
    apiStyle: "openai_compatible",
  };
}
