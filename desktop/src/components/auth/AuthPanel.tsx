import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import anthropicLogoMarkup from "@/assets/providers/anthropic.svg?raw";
import geminiLogoMarkup from "@/assets/providers/gemini.svg?raw";
import minimaxLogoMarkup from "@/assets/providers/minimax.svg?raw";
import ollamaLogoMarkup from "@/assets/providers/ollama.svg?raw";
import openaiLogoMarkup from "@/assets/providers/openai.svg?raw";
import openrouterLogoMarkup from "@/assets/providers/openrouter.svg?raw";
import { BillingSummaryCard } from "@/components/billing/BillingSummaryCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDesktopAuthSession,
  type AuthSession
} from "@/lib/auth/authClient";
import { holabossLogoUrl } from "@/lib/assetPaths";
import { useDesktopBilling } from "@/lib/billing/useDesktopBilling";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";

type AuthPanelView = "full" | "account" | "runtime";

interface AuthPanelProps {
  view?: AuthPanelView;
}

const KNOWN_PROVIDER_ORDER = ["holaboss", "openai_direct", "anthropic_direct", "openrouter_direct", "gemini_direct", "ollama_direct", "minimax_direct"] as const;
type KnownProviderId = (typeof KNOWN_PROVIDER_ORDER)[number];
const PROVIDER_AUTOSAVE_DELAY_MS = 800;
const AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME =
  "auth-settings-control theme-control-surface relative isolate h-9 w-full overflow-hidden rounded-[10px] border border-border/45 bg-muted px-2.5 text-sm text-foreground shadow-none transition-colors hover:border-border/65 focus-visible:border-border/65 focus-visible:ring-0 focus-visible:ring-transparent aria-invalid:border-border/45 aria-invalid:ring-0";
const LEGACY_DIRECT_PROVIDER_MODEL_ALIASES: Record<string, Record<string, string>> = {
  anthropic_direct: {
    "claude-sonnet-4-5": "claude-sonnet-4-6"
  },
  gemini_direct: {
    "gemini-3.1-pro-preview": "gemini-2.5-pro",
    "gemini-3.1-flash-lite-preview": "gemini-2.5-flash-lite"
  }
};

type RuntimeCatalogModelCapability = "chat" | "image_generation";
const RUNTIME_MODEL_CAPABILITY_ALIASES: Record<string, RuntimeCatalogModelCapability> = {
  chat: "chat",
  text: "chat",
  completion: "chat",
  completions: "chat",
  responses: "chat",
  image: "image_generation",
  images: "image_generation",
  image_generation: "image_generation",
  image_gen: "image_generation",
};

interface KnownProviderTemplate {
  id: KnownProviderId;
  label: string;
  description: string;
  kind: string;
  defaultBaseUrl: string;
  defaultModels: string[];
  defaultBackgroundModel: string | null;
  defaultImageModel: string | null;
  imageModelSuggestions: string[];
  apiKeyPlaceholder: string;
}

interface ProviderDraft {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  modelsText: string;
}

type ProviderDraftMap = Record<KnownProviderId, ProviderDraft>;

type BackgroundTasksDraftProviderId = KnownProviderId | "";

interface BackgroundTasksDraft {
  providerId: BackgroundTasksDraftProviderId;
  model: string;
}

const IMAGE_GENERATION_PROVIDER_IDS = [
  "holaboss",
  "openai_direct",
  "gemini_direct",
] as const;

type ImageGenerationDraftProviderId =
  (typeof IMAGE_GENERATION_PROVIDER_IDS)[number] | "";

interface ImageGenerationDraft {
  providerId: ImageGenerationDraftProviderId;
  model: string;
}

const KNOWN_PROVIDER_TEMPLATES: Record<KnownProviderId, KnownProviderTemplate> = {
  holaboss: {
    id: "holaboss",
    label: "Holaboss Proxy",
    description: "Managed by your Holaboss account session and runtime binding.",
    kind: "holaboss_proxy",
    defaultBaseUrl: "",
    defaultModels: [],
    defaultBackgroundModel: null,
    defaultImageModel: null,
    imageModelSuggestions: [],
    apiKeyPlaceholder: "hbrt.v1.your-proxy-token"
  },
  openai_direct: {
    id: "openai_direct",
    label: "OpenAI",
    description: "Direct OpenAI-compatible endpoint with your own API key.",
    kind: "openai_compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModels: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"],
    defaultBackgroundModel: "gpt-5.4-mini",
    defaultImageModel: "gpt-image-1.5",
    imageModelSuggestions: ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini", "chatgpt-image-latest"],
    apiKeyPlaceholder: "sk-your-openai-key"
  },
  anthropic_direct: {
    id: "anthropic_direct",
    label: "Anthropic",
    description: "Direct Anthropic native endpoint with your own API key.",
    kind: "anthropic_native",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModels: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
    defaultBackgroundModel: "claude-sonnet-4-6",
    defaultImageModel: null,
    imageModelSuggestions: [],
    apiKeyPlaceholder: "sk-ant-your-anthropic-key"
  },
  openrouter_direct: {
    id: "openrouter_direct",
    label: "OpenRouter",
    description: "OpenRouter endpoint for provider-aggregated model access.",
    kind: "openrouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModels: ["openai/gpt-5.4", "openai/gpt-5.4-mini", "anthropic/claude-sonnet-4-6"],
    defaultBackgroundModel: "openai/gpt-5.4-mini",
    defaultImageModel: null,
    imageModelSuggestions: [],
    apiKeyPlaceholder: "sk-or-your-openrouter-key"
  },
  gemini_direct: {
    id: "gemini_direct",
    label: "Gemini",
    description: "Google Gemini OpenAI-compatible endpoint with your own API key.",
    kind: "openai_compatible",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    defaultBackgroundModel: "gemini-2.5-flash",
    defaultImageModel: "gemini-3.1-flash-image-preview",
    imageModelSuggestions: ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"],
    apiKeyPlaceholder: "AIza...your-gemini-api-key"
  },
  ollama_direct: {
    id: "ollama_direct",
    label: "Ollama",
    description: "Local Ollama OpenAI-compatible endpoint.",
    kind: "openai_compatible",
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModels: ["llama3.1:8b", "qwen3:8b", "gpt-oss:20b"],
    defaultBackgroundModel: null,
    defaultImageModel: null,
    imageModelSuggestions: [],
    apiKeyPlaceholder: "Optional. Use 'ollama' for strict OpenAI SDK compatibility."
  },
  minimax_direct: {
    id: "minimax_direct",
    label: "MiniMax",
    description: "MiniMax OpenAI-compatible endpoint with your own API key.",
    kind: "openai_compatible",
    defaultBaseUrl: "https://api.minimax.io/v1",
    defaultModels: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
    defaultBackgroundModel: "MiniMax-M2.7",
    defaultImageModel: null,
    imageModelSuggestions: [],
    apiKeyPlaceholder: "sk-your-minimax-api-key"
  }
};

function isKnownProviderId(value: string): value is KnownProviderId {
  return KNOWN_PROVIDER_ORDER.includes(value as KnownProviderId);
}

function createDefaultProviderDrafts(): ProviderDraftMap {
  return {
    holaboss: {
      enabled: false,
      baseUrl: "",
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.holaboss.defaultModels.join(", "),
    },
    openai_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.openai_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.openai_direct.defaultModels.join(", "),
    },
    anthropic_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.anthropic_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.anthropic_direct.defaultModels.join(", "),
    },
    openrouter_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.openrouter_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.openrouter_direct.defaultModels.join(", "),
    },
    gemini_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.gemini_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.gemini_direct.defaultModels.join(", "),
    },
    ollama_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.ollama_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.ollama_direct.defaultModels.join(", "),
    },
    minimax_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.minimax_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.minimax_direct.defaultModels.join(", "),
    }
  };
}

function createDefaultBackgroundTasksDraft(): BackgroundTasksDraft {
  return {
    providerId: "",
    model: "",
  };
}

function createDefaultImageGenerationDraft(): ImageGenerationDraft {
  return {
    providerId: "",
    model: "",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
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

function parseRuntimeConfigDocument(rawText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseModelsText(value: string): string[] {
  return uniqueValues(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function normalizeConfiguredProviderModelId(providerId: string, modelId: string): string {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const normalizedModelId = modelId.trim();
  if (!normalizedProviderId || !normalizedModelId) {
    return normalizedModelId;
  }
  return LEGACY_DIRECT_PROVIDER_MODEL_ALIASES[normalizedProviderId]?.[normalizedModelId] ?? normalizedModelId;
}

function normalizeRuntimeCatalogModelCapability(value: string): RuntimeCatalogModelCapability | "" {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) {
    return "";
  }
  return RUNTIME_MODEL_CAPABILITY_ALIASES[normalized] ?? "";
}

function runtimeCatalogModelCapabilities(model: RuntimeProviderModelPayload): RuntimeCatalogModelCapability[] {
  if (!Array.isArray(model.capabilities)) {
    return [];
  }
  const seen = new Set<RuntimeCatalogModelCapability>();
  const capabilities: RuntimeCatalogModelCapability[] = [];
  for (const value of model.capabilities) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeRuntimeCatalogModelCapability(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    capabilities.push(normalized);
  }
  return capabilities;
}

function runtimeCatalogModelSupportsCapability(
  model: RuntimeProviderModelPayload,
  capability: RuntimeCatalogModelCapability,
): boolean {
  const capabilities = runtimeCatalogModelCapabilities(model);
  if (capabilities.length === 0) {
    return capability === "chat";
  }
  return capabilities.includes(capability);
}

function enabledProviderIdsForDrafts(providerDrafts: ProviderDraftMap, isSignedIn: boolean): KnownProviderId[] {
  return KNOWN_PROVIDER_ORDER.filter((providerId) =>
    providerId === "holaboss" ? isSignedIn : providerDrafts[providerId].enabled
  );
}

function providerBrandIconMarkup(providerId: KnownProviderId): string | null {
  if (providerId === "openai_direct") {
    return openaiLogoMarkup;
  }
  if (providerId === "anthropic_direct") {
    return anthropicLogoMarkup;
  }
  if (providerId === "openrouter_direct") {
    return openrouterLogoMarkup;
  }
  if (providerId === "gemini_direct") {
    return geminiLogoMarkup;
  }
  if (providerId === "ollama_direct") {
    return ollamaLogoMarkup;
  }
  if (providerId === "minimax_direct") {
    return minimaxLogoMarkup;
  }
  return null;
}

function configuredRuntimeProviderModelIds(
  runtimeConfig: RuntimeConfigPayload | null,
  providerId: KnownProviderId,
  capability: RuntimeCatalogModelCapability = "chat",
): string[] {
  const runtimeProviderId =
    providerId === "holaboss" ? "holaboss_model_proxy" : providerId;
  const providerGroup = runtimeConfig?.providerModelGroups.find(
    (group) => group.providerId.trim() === runtimeProviderId
  );
  if (!providerGroup) {
    return [];
  }
  return uniqueValues(
    providerGroup.models
      .filter((model) => runtimeCatalogModelSupportsCapability(model, capability))
      .map((model) => normalizeConfiguredProviderModelId(providerId, model.modelId || model.token))
      .filter(Boolean)
  );
}

function configuredRuntimeProviderPrefixes(providerId: KnownProviderId): string[] {
  if (providerId === "holaboss") {
    return ["openai/", "google/", "anthropic/", "holaboss/", "holaboss_model_proxy/"];
  }
  return [`${providerId}/`];
}

function runtimeProviderStorageId(providerId: KnownProviderId): string {
  return providerId === "holaboss" ? "holaboss_model_proxy" : providerId;
}

function configuredBackgroundModelId(providerId: KnownProviderId, value: string): string {
  return normalizeConfiguredProviderModelId(providerId, value.trim());
}

function backgroundTaskProviderDraftId(value: string): BackgroundTasksDraftProviderId {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (normalized === "holaboss_model_proxy" || normalized === "holaboss") {
    return "holaboss";
  }
  return isKnownProviderId(normalized) ? normalized : "";
}

function backgroundTaskProviderStorageId(providerId: BackgroundTasksDraftProviderId): string {
  if (!providerId) {
    return "";
  }
  return runtimeProviderStorageId(providerId);
}

function backgroundTaskDefaultModel(
  providerId: BackgroundTasksDraftProviderId,
  runtimeConfig: RuntimeConfigPayload | null,
): string {
  if (!providerId) {
    return "";
  }
  if (providerId === "holaboss") {
    return configuredBackgroundModelId(
      providerId,
      runtimeConfig?.defaultBackgroundModel ?? "",
    );
  }
  return KNOWN_PROVIDER_TEMPLATES[providerId].defaultBackgroundModel ?? "";
}

function backgroundTaskModelPlaceholder(
  providerId: BackgroundTasksDraftProviderId,
  runtimeConfig: RuntimeConfigPayload | null,
): string {
  const fallbackModel = backgroundTaskDefaultModel(providerId, runtimeConfig);
  return fallbackModel ? `Default: ${fallbackModel}` : "Select a model";
}

function backgroundTaskProviderLabel(providerId: BackgroundTasksDraftProviderId): string {
  if (!providerId) {
    return "";
  }
  return KNOWN_PROVIDER_TEMPLATES[providerId].label;
}

function backgroundTaskModelSuggestions(
  providerId: BackgroundTasksDraftProviderId,
  providerDrafts: ProviderDraftMap,
  runtimeConfig: RuntimeConfigPayload | null,
): string[] {
  if (!providerId) {
    return [];
  }
  const template = KNOWN_PROVIDER_TEMPLATES[providerId];
  const managedCatalogModels =
    providerId === "holaboss"
      ? configuredRuntimeProviderModelIds(runtimeConfig, providerId, "chat")
      : [];
  if (providerId === "holaboss") {
    return managedCatalogModels;
  }
  return uniqueValues([
    ...managedCatalogModels,
    ...parseModelsText(providerDrafts[providerId].modelsText),
    ...template.defaultModels,
    ...(template.defaultBackgroundModel ? [template.defaultBackgroundModel] : []),
  ]);
}

function isImageGenerationProviderId(value: string): value is ImageGenerationDraftProviderId {
  return value === "" || IMAGE_GENERATION_PROVIDER_IDS.includes(value as (typeof IMAGE_GENERATION_PROVIDER_IDS)[number]);
}

function imageGenerationProviderDraftId(value: string): ImageGenerationDraftProviderId {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (normalized === "holaboss_model_proxy" || normalized === "holaboss") {
    return "holaboss";
  }
  return isImageGenerationProviderId(normalized) ? normalized : "";
}

function imageGenerationProviderStorageId(providerId: ImageGenerationDraftProviderId): string {
  if (!providerId) {
    return "";
  }
  return runtimeProviderStorageId(providerId);
}

function configuredImageGenerationModelId(providerId: ImageGenerationDraftProviderId, value: string): string {
  return normalizeConfiguredProviderModelId(providerId, value.trim());
}

function imageGenerationDefaultModel(
  providerId: ImageGenerationDraftProviderId,
  runtimeConfig: RuntimeConfigPayload | null,
): string {
  if (!providerId) {
    return "";
  }
  if (providerId === "holaboss") {
    return configuredImageGenerationModelId(
      providerId,
      runtimeConfig?.defaultImageModel ?? "",
    );
  }
  return KNOWN_PROVIDER_TEMPLATES[providerId].defaultImageModel ?? "";
}

function imageGenerationModelPlaceholder(
  providerId: ImageGenerationDraftProviderId,
  runtimeConfig: RuntimeConfigPayload | null,
): string {
  const fallbackModel = imageGenerationDefaultModel(providerId, runtimeConfig);
  return fallbackModel ? `Default: ${fallbackModel}` : "Select a model";
}

function imageGenerationProviderLabel(providerId: ImageGenerationDraftProviderId): string {
  if (!providerId) {
    return "";
  }
  return KNOWN_PROVIDER_TEMPLATES[providerId].label;
}

function imageGenerationModelSuggestions(
  providerId: ImageGenerationDraftProviderId,
  runtimeConfig: RuntimeConfigPayload | null,
): string[] {
  if (!providerId) {
    return [];
  }
  const template = KNOWN_PROVIDER_TEMPLATES[providerId];
  const managedCatalogImageModels =
    providerId === "holaboss"
      ? configuredRuntimeProviderModelIds(runtimeConfig, providerId, "image_generation")
      : [];
  if (providerId === "holaboss") {
    return managedCatalogImageModels;
  }
  return uniqueValues([
    ...managedCatalogImageModels,
    ...(managedCatalogImageModels.length === 0 && template.defaultImageModel ? [template.defaultImageModel] : []),
    ...(managedCatalogImageModels.length === 0 ? template.imageModelSuggestions : []),
  ]);
}

function deriveConfiguredBackgroundTasksDraft(
  document: Record<string, unknown>,
  runtimeConfig: RuntimeConfigPayload | null,
): BackgroundTasksDraft {
  const runtimePayload = asRecord(document.runtime);
  const backgroundTasksPayload = asRecord(
    runtimePayload.background_tasks ?? runtimePayload.backgroundTasks,
  );
  const providerId = backgroundTaskProviderDraftId(
    firstNonEmptyString(
      backgroundTasksPayload.provider as string | undefined,
      backgroundTasksPayload.provider_id as string | undefined,
      backgroundTasksPayload.providerId as string | undefined,
    ),
  );
  return {
    providerId,
    model: providerId
      ? configuredBackgroundModelId(
          providerId,
          firstNonEmptyString(
            backgroundTasksPayload.model as string | undefined,
            backgroundTasksPayload.model_id as string | undefined,
            backgroundTasksPayload.modelId as string | undefined,
            providerId === "holaboss"
              ? backgroundTaskDefaultModel(providerId, runtimeConfig)
              : "",
          ),
        )
      : "",
  };
}

function deriveConfiguredImageGenerationDraft(
  document: Record<string, unknown>,
  runtimeConfig: RuntimeConfigPayload | null,
): ImageGenerationDraft {
  const runtimePayload = asRecord(document.runtime);
  const imageGenerationPayload = asRecord(
    runtimePayload.image_generation ?? runtimePayload.imageGeneration,
  );
  const providerId = imageGenerationProviderDraftId(
    firstNonEmptyString(
      imageGenerationPayload.provider as string | undefined,
      imageGenerationPayload.provider_id as string | undefined,
      imageGenerationPayload.providerId as string | undefined,
    ),
  );
  return {
    providerId,
    model: providerId
      ? configuredImageGenerationModelId(
          providerId,
          firstNonEmptyString(
            imageGenerationPayload.model as string | undefined,
            imageGenerationPayload.model_id as string | undefined,
            imageGenerationPayload.modelId as string | undefined,
            providerId === "holaboss"
              ? imageGenerationDefaultModel(providerId, runtimeConfig)
              : "",
          ),
        )
      : "",
  };
}

function deriveLegacyBackgroundTasksDraft(document: Record<string, unknown>): BackgroundTasksDraft {
  const providersPayload = asRecord(document.providers);
  const matches: BackgroundTasksDraft[] = [];
  for (const providerId of KNOWN_PROVIDER_ORDER) {
    const runtimeProviderId = runtimeProviderStorageId(providerId);
    const providerPayload = asRecord(
      providerId === "holaboss"
        ? providersPayload.holaboss_model_proxy ?? providersPayload.holaboss
        : providersPayload[runtimeProviderId]
    );
    const optionsPayload = asRecord(providerPayload.options);
    const model = configuredBackgroundModelId(
      providerId,
      firstNonEmptyString(
        providerPayload.background_model as string | undefined,
        providerPayload.backgroundModel as string | undefined,
        optionsPayload.background_model as string | undefined,
        optionsPayload.backgroundModel as string | undefined,
      ),
    );
    if (!model) {
      continue;
    }
    matches.push({
      providerId,
      model,
    });
  }
  if (matches.length === 1) {
    return matches[0];
  }
  return createDefaultBackgroundTasksDraft();
}

function deriveLegacyImageGenerationDraft(document: Record<string, unknown>): ImageGenerationDraft {
  const providersPayload = asRecord(document.providers);
  const matches: ImageGenerationDraft[] = [];
  for (const providerId of IMAGE_GENERATION_PROVIDER_IDS) {
    const runtimeProviderId = runtimeProviderStorageId(providerId);
    const providerPayload = asRecord(
      providerId === "holaboss"
        ? providersPayload.holaboss_model_proxy ?? providersPayload.holaboss
        : providersPayload[runtimeProviderId]
    );
    const optionsPayload = asRecord(providerPayload.options);
    const model = configuredImageGenerationModelId(
      providerId,
      firstNonEmptyString(
        providerPayload.image_model as string | undefined,
        providerPayload.imageModel as string | undefined,
        optionsPayload.image_model as string | undefined,
        optionsPayload.imageModel as string | undefined,
      ),
    );
    if (!model) {
      continue;
    }
    matches.push({
      providerId,
      model,
    });
  }
  return matches[0] ?? createDefaultImageGenerationDraft();
}

function ProviderBrandIcon({ providerId }: { providerId: KnownProviderId }) {
  if (providerId === "holaboss") {
    return <img src={holabossLogoUrl} alt="" className="h-4 w-4 object-contain" aria-hidden="true" />;
  }
  const iconMarkup = providerBrandIconMarkup(providerId);
  if (iconMarkup) {
    return (
      <span
        aria-hidden="true"
        className="block h-4 w-4 text-foreground/92 [&_svg]:h-full [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: iconMarkup }}
      />
    );
  }
  return null;
}

function deriveProviderDraftsFromDocument(
  document: Record<string, unknown>,
  runtimeConfig: RuntimeConfigPayload | null
): {
  drafts: ProviderDraftMap;
  sandboxId: string;
  backgroundTasks: BackgroundTasksDraft;
  imageGeneration: ImageGenerationDraft;
} {
  const runtimePayload = asRecord(document.runtime);
  const providersPayload = asRecord(document.providers);
  const modelsPayload = asRecord(document.models);
  const integrationsPayload = asRecord(document.integrations);
  const holabossIntegration = asRecord(integrationsPayload.holaboss);
  const drafts = createDefaultProviderDrafts();

  for (const providerId of KNOWN_PROVIDER_ORDER) {
    const template = KNOWN_PROVIDER_TEMPLATES[providerId];
    const runtimeProviderId = runtimeProviderStorageId(providerId);
    const providerPayload = asRecord(
      providerId === "holaboss"
        ? providersPayload.holaboss_model_proxy ?? providersPayload.holaboss
        : providersPayload[runtimeProviderId]
    );
    const optionsPayload = asRecord(providerPayload.options);

    const baseUrl = firstNonEmptyString(
      providerPayload.base_url as string | undefined,
      providerPayload.baseURL as string | undefined,
      optionsPayload.baseURL as string | undefined,
      optionsPayload.base_url as string | undefined,
      providerId === "holaboss" ? runtimeConfig?.modelProxyBaseUrl ?? "" : "",
      template.defaultBaseUrl
    );
    const apiKey = firstNonEmptyString(
      providerPayload.api_key as string | undefined,
      providerPayload.auth_token as string | undefined,
      optionsPayload.apiKey as string | undefined,
      optionsPayload.api_key as string | undefined,
      optionsPayload.authToken as string | undefined,
      optionsPayload.auth_token as string | undefined,
      providerId === "holaboss" ? (holabossIntegration.auth_token as string | undefined) : ""
    );
    const modelIds: string[] = [];
    if (providerId !== "holaboss") {
      for (const [token, rawModel] of Object.entries(modelsPayload)) {
        const modelPayload = asRecord(rawModel);
        let modelProvider = firstNonEmptyString(
          modelPayload.provider as string | undefined,
          modelPayload.provider_id as string | undefined
        );
        let modelId = firstNonEmptyString(
          modelPayload.model as string | undefined,
          modelPayload.model_id as string | undefined
        );
        if (!modelProvider && token.includes("/")) {
          const [prefix, ...rest] = token.split("/");
          if (prefix.trim() === providerId && rest.length > 0) {
            modelProvider = providerId;
            modelId = modelId || rest.join("/");
          }
        }
        if (modelProvider === providerId && modelId.trim()) {
          modelIds.push(normalizeConfiguredProviderModelId(providerId, modelId));
        }
      }
    }
    const normalizedModelIds =
      providerId === "holaboss"
        ? configuredRuntimeProviderModelIds(runtimeConfig, providerId)
        : uniqueValues(modelIds);
    const fallbackDefaultModel = firstNonEmptyString(runtimePayload.default_model as string | undefined, runtimeConfig?.defaultModel ?? "");
    if (providerId !== "holaboss" && normalizedModelIds.length === 0) {
      for (const providerPrefix of configuredRuntimeProviderPrefixes(providerId)) {
        if (fallbackDefaultModel.startsWith(providerPrefix)) {
          normalizedModelIds.push(fallbackDefaultModel.slice(providerPrefix.length).trim());
          break;
        }
      }
    }
    drafts[providerId] = {
      enabled:
        Object.keys(providerPayload).length > 0 ||
        (providerId === "holaboss" && Boolean((runtimeConfig?.modelProxyBaseUrl || "").trim())),
      baseUrl,
      apiKey,
      modelsText: (normalizedModelIds.length > 0 ? normalizedModelIds : template.defaultModels).join(", "),
    };
  }

  const configuredBackgroundTasks = deriveConfiguredBackgroundTasksDraft(
    document,
    runtimeConfig,
  );
  const backgroundTasks = configuredBackgroundTasks.providerId
    ? configuredBackgroundTasks
    : deriveLegacyBackgroundTasksDraft(document);
  const configuredImageGeneration = deriveConfiguredImageGenerationDraft(
    document,
    runtimeConfig,
  );
  const imageGeneration = configuredImageGeneration.providerId
    ? configuredImageGeneration
    : deriveLegacyImageGenerationDraft(document);

  return {
    drafts,
    sandboxId: firstNonEmptyString(runtimePayload.sandbox_id as string | undefined, runtimeConfig?.sandboxId ?? ""),
    backgroundTasks,
    imageGeneration,
  };
}

function sessionUserId(session: AuthSession | null): string {
  if (!session || typeof session !== "object") {
    return "";
  }

  const maybeUser = "user" in session ? session.user : null;
  if (!maybeUser || typeof maybeUser !== "object") {
    return "";
  }

  return typeof maybeUser.id === "string" ? maybeUser.id : "";
}

function sessionEmail(session: AuthSession | null): string {
  if (!session || typeof session !== "object") {
    return "";
  }

  const maybeUser = "user" in session ? session.user : null;
  if (!maybeUser || typeof maybeUser !== "object") {
    return "";
  }

  return typeof maybeUser.email === "string" ? maybeUser.email : "";
}

function sessionDisplayName(session: AuthSession | null): string {
  if (!session || typeof session !== "object") {
    return "";
  }

  const maybeUser = "user" in session ? session.user : null;
  if (!maybeUser || typeof maybeUser !== "object") {
    return "";
  }

  return typeof maybeUser.name === "string" ? maybeUser.name.trim() : "";
}

function sessionInitials(session: AuthSession | null): string {
  const name = sessionDisplayName(session);
  if (name) {
    const initials = name
      .split(/\s+/)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
    if (initials) {
      return initials;
    }
  }

  const email = sessionEmail(session);
  return (email[0] ?? "H").toUpperCase();
}

export function AuthPanel({ view = "full" }: AuthPanelProps) {
  const sessionState = useDesktopAuthSession();
  const billingState = useDesktopBilling();
  const { runtimeConfig: sharedRuntimeConfig } = useWorkspaceDesktop();
  const session = sessionState.data;
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigPayload | null>(null);
  const [runtimeConfigDocument, setRuntimeConfigDocument] = useState("");
  const [hasLoadedRuntimeConfigDocument, setHasLoadedRuntimeConfigDocument] = useState(false);
  const [hydratedRuntimeConfigDocument, setHydratedRuntimeConfigDocument] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<ProviderDraftMap>(() => createDefaultProviderDrafts());
  const [backgroundTasksDraft, setBackgroundTasksDraft] = useState<BackgroundTasksDraft>(() =>
    createDefaultBackgroundTasksDraft(),
  );
  const [imageGenerationDraft, setImageGenerationDraft] = useState<ImageGenerationDraft>(() =>
    createDefaultImageGenerationDraft(),
  );
  const [expandedProviderId, setExpandedProviderId] = useState<KnownProviderId | null>(null);
  const [sandboxId, setSandboxId] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isStartingSignIn, setIsStartingSignIn] = useState(false);
  const [isSavingRuntimeConfigDocument, setIsSavingRuntimeConfigDocument] = useState(false);
  const [isExchangingRuntimeBinding, setIsExchangingRuntimeBinding] = useState(false);
  const [isProviderDraftDirty, setIsProviderDraftDirty] = useState(false);
  const [providerDraftRevision, setProviderDraftRevision] = useState(0);
  const [failedAutosaveRevision, setFailedAutosaveRevision] = useState<number | null>(null);
  const [providerSaveStatus, setProviderSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const latestProviderDraftRevisionRef = useRef(0);
  const effectiveRuntimeConfig = sharedRuntimeConfig ?? runtimeConfig;

  async function refreshRuntimeConfig() {
    if (!window.electronAPI) {
      return;
    }
    const [config, document] = await Promise.all([
      window.electronAPI.runtime.getConfig(),
      window.electronAPI.runtime.getConfigDocument()
    ]);
    setRuntimeConfig(config);
    setRuntimeConfigDocument(document);
    setHasLoadedRuntimeConfigDocument(true);
    setSandboxId(config.sandboxId ?? `desktop:${crypto.randomUUID()}`);
  }

  async function handleReloadRuntimeSettings() {
    setIsProviderDraftDirty(false);
    setFailedAutosaveRevision(null);
    setProviderSaveStatus("idle");
    setAuthError("");
    setAuthMessage("");
    await refreshRuntimeConfig();
  }

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    let cancelled = false;
    void Promise.all([
      window.electronAPI.runtime.getConfig(),
      window.electronAPI.runtime.getConfigDocument()
    ]).then(([config, document]) => {
      if (cancelled) {
        return;
      }
      setRuntimeConfig(config);
      setRuntimeConfigDocument(document);
      setHasLoadedRuntimeConfigDocument(true);
      setSandboxId(config.sandboxId ?? `desktop:${crypto.randomUUID()}`);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    const unsubscribe = window.electronAPI.runtime.onConfigChange((config) => {
      setRuntimeConfig(config);
      setSandboxId(config.sandboxId ?? `desktop:${crypto.randomUUID()}`);
      setAuthError("");
      void window.electronAPI.runtime.getConfigDocument().then((document) => {
        setRuntimeConfigDocument(document);
        setHasLoadedRuntimeConfigDocument(true);
      });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }
    void refreshRuntimeConfig();
  }, [session]);

  useEffect(() => {
    if (sessionState.error) {
      setAuthError(sessionState.error.message);
    }
  }, [sessionState.error]);

  useEffect(() => {
    const derived = deriveProviderDraftsFromDocument(
      parseRuntimeConfigDocument(runtimeConfigDocument),
      effectiveRuntimeConfig,
    );
    setSandboxId(
      derived.sandboxId ||
        effectiveRuntimeConfig?.sandboxId ||
        `desktop:${crypto.randomUUID()}`,
    );
    if (isProviderDraftDirty) {
      return;
    }
    setProviderDrafts(derived.drafts);
    setBackgroundTasksDraft(derived.backgroundTasks);
    setImageGenerationDraft(derived.imageGeneration);
    setFailedAutosaveRevision(null);
    setHydratedRuntimeConfigDocument(runtimeConfigDocument);
  }, [effectiveRuntimeConfig, isProviderDraftDirty, runtimeConfigDocument]);

  useEffect(() => {
    if (
      !window.electronAPI ||
      !hasLoadedRuntimeConfigDocument ||
      isProviderDraftDirty ||
      isSavingRuntimeConfigDocument
    ) {
      return;
    }

    const document = parseRuntimeConfigDocument(runtimeConfigDocument);
    const runtimePayload = asRecord(document.runtime);
    const backgroundTasksPayload = asRecord(
      runtimePayload.background_tasks ?? runtimePayload.backgroundTasks,
    );
    const imageGenerationPayload = asRecord(
      runtimePayload.image_generation ?? runtimePayload.imageGeneration,
    );
    const shouldAutoselectHolabossBackgroundDefault =
      backgroundTaskProviderDraftId(
        firstNonEmptyString(
          backgroundTasksPayload.provider as string | undefined,
          backgroundTasksPayload.provider_id as string | undefined,
          backgroundTasksPayload.providerId as string | undefined,
        ),
      ) === "holaboss" &&
      !firstNonEmptyString(
        backgroundTasksPayload.model as string | undefined,
        backgroundTasksPayload.model_id as string | undefined,
        backgroundTasksPayload.modelId as string | undefined,
      ) &&
      Boolean(backgroundTasksDraft.model.trim());
    const shouldAutoselectHolabossImageDefault =
      imageGenerationProviderDraftId(
        firstNonEmptyString(
          imageGenerationPayload.provider as string | undefined,
          imageGenerationPayload.provider_id as string | undefined,
          imageGenerationPayload.providerId as string | undefined,
        ),
      ) === "holaboss" &&
      !firstNonEmptyString(
        imageGenerationPayload.model as string | undefined,
        imageGenerationPayload.model_id as string | undefined,
        imageGenerationPayload.modelId as string | undefined,
      ) &&
      Boolean(imageGenerationDraft.model.trim());

    if (
      !shouldAutoselectHolabossBackgroundDefault &&
      !shouldAutoselectHolabossImageDefault
    ) {
      return;
    }

    markProviderSettingsDirty();
  }, [
    backgroundTasksDraft.model,
    hasLoadedRuntimeConfigDocument,
    imageGenerationDraft.model,
    isProviderDraftDirty,
    isSavingRuntimeConfigDocument,
    runtimeConfigDocument,
  ]);

  const isSignedIn = Boolean(sessionUserId(session));
  const providerEnabled = (providerId: KnownProviderId) =>
    providerId === "holaboss" ? isSignedIn : providerDrafts[providerId].enabled;
  const connectedProviderIds = KNOWN_PROVIDER_ORDER.filter((providerId) => providerEnabled(providerId));
  const availableProviderIds = KNOWN_PROVIDER_ORDER.filter((providerId) => !providerEnabled(providerId));
  const backgroundProviderConnected =
    backgroundTasksDraft.providerId !== "" &&
    connectedProviderIds.includes(backgroundTasksDraft.providerId);
  const backgroundProviderSuggestions = backgroundTaskModelSuggestions(
    backgroundTasksDraft.providerId,
    providerDrafts,
    effectiveRuntimeConfig,
  );
  const backgroundProviderOptions = backgroundTasksDraft.providerId
    && !connectedProviderIds.includes(backgroundTasksDraft.providerId)
      ? [backgroundTasksDraft.providerId, ...connectedProviderIds]
      : connectedProviderIds;
  const backgroundTaskUsesManagedModelPicker = backgroundTasksDraft.providerId === "holaboss";
  const backgroundTaskModelOptions = uniqueValues([
    backgroundTasksDraft.model.trim(),
    ...backgroundProviderSuggestions,
  ]);
  const connectedImageProviderIds = IMAGE_GENERATION_PROVIDER_IDS.filter((providerId) =>
    connectedProviderIds.includes(providerId),
  );
  const imageGenerationProviderConnected =
    imageGenerationDraft.providerId !== "" &&
    connectedImageProviderIds.includes(imageGenerationDraft.providerId);
  const imageGenerationUsesManagedModelPicker = imageGenerationDraft.providerId === "holaboss";
  const imageGenerationProviderSuggestions = imageGenerationModelSuggestions(
    imageGenerationDraft.providerId,
    effectiveRuntimeConfig,
  );
  const imageGenerationModelOptions = uniqueValues([
    imageGenerationDraft.model.trim(),
    ...imageGenerationProviderSuggestions,
  ]);
  const imageGenerationProviderOptions = imageGenerationDraft.providerId
    && !connectedImageProviderIds.includes(imageGenerationDraft.providerId)
      ? [imageGenerationDraft.providerId, ...connectedImageProviderIds]
      : connectedImageProviderIds;

  const showAccountSection = view !== "runtime";
  const showRuntimeSection = view !== "account";
  const runtimeOnlyView = !showAccountSection && showRuntimeSection;
  const runtimeBindingReady =
    Boolean(effectiveRuntimeConfig?.authTokenPresent) &&
    Boolean((effectiveRuntimeConfig?.sandboxId || "").trim()) &&
    Boolean((effectiveRuntimeConfig?.modelProxyBaseUrl || "").trim());
  const isFinishingSetup = isSignedIn && !runtimeBindingReady && !authError;
  const statusTone = authError ? "error" : runtimeBindingReady ? "ready" : isFinishingSetup ? "syncing" : "idle";

  const statusBadgeLabel = sessionState.isPending
    ? "Checking session"
    : authError
      ? "Needs attention"
      : runtimeBindingReady
        ? "Connected"
        : isSignedIn
          ? "Finishing setup"
          : "Signed out";

  const badgeClassName =
    statusTone === "error"
      ? "border-rose-400/35 bg-rose-500/10 text-rose-400"
      : statusTone === "ready"
        ? "border-neon-green/35 bg-neon-green/10 text-neon-green"
        : statusTone === "syncing"
          ? "border-amber-300/35 bg-amber-400/10 text-amber-300"
          : "border-border/45 bg-muted/40 text-muted-foreground";

  const providerAutosaveMessage =
    providerSaveStatus === "saving"
      ? "Saving changes..."
      : providerSaveStatus === "saved"
        ? "Changes saved automatically"
        : providerSaveStatus === "error"
          ? "Autosave failed. Edit again to retry."
          : "Changes save automatically";

  const infoRows = [
    {
      label: "Profile",
      value: isSignedIn ? "Connected" : "Sign in required"
    },
    {
      label: "Runtime",
      value: runtimeBindingReady ? "Ready on this desktop" : isSignedIn ? "Finishing setup" : "Offline"
    }
  ];

  useEffect(() => {
    if (!hasLoadedRuntimeConfigDocument) {
      return;
    }
    if (hydratedRuntimeConfigDocument !== runtimeConfigDocument) {
      return;
    }
    if (isProviderDraftDirty || backgroundTasksDraft.providerId || connectedProviderIds.length === 0) {
      return;
    }
    applyBackgroundTaskProviderSelection(connectedProviderIds[0] ?? "");
  }, [
    backgroundTasksDraft.providerId,
    connectedProviderIds,
    hasLoadedRuntimeConfigDocument,
    hydratedRuntimeConfigDocument,
    isProviderDraftDirty,
    runtimeConfigDocument,
  ]);

  useEffect(() => {
    if (!hasLoadedRuntimeConfigDocument) {
      return;
    }
    if (hydratedRuntimeConfigDocument !== runtimeConfigDocument) {
      return;
    }
    if (isProviderDraftDirty || imageGenerationDraft.providerId || connectedImageProviderIds.length === 0) {
      return;
    }
    applyImageGenerationProviderSelection(connectedImageProviderIds[0] ?? "");
  }, [
    connectedImageProviderIds,
    hasLoadedRuntimeConfigDocument,
    hydratedRuntimeConfigDocument,
    imageGenerationDraft.providerId,
    isProviderDraftDirty,
    runtimeConfigDocument,
  ]);

  async function handleStartSignIn() {
    setIsStartingSignIn(true);
    setAuthError("");
    setAuthMessage("");
    try {
      await sessionState.requestAuth();
      setAuthMessage("Sign-in opened in the browser. Complete the flow on the Holaboss sign-in page.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to start sign-in.");
    } finally {
      setIsStartingSignIn(false);
    }
  }

  async function handleRefreshSession() {
    setAuthError("");
    await sessionState.refetch();
  }

  async function handleSignOut() {
    setAuthError("");
    setAuthMessage("");
    try {
      await sessionState.signOut();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to sign out.");
    }
  }

  function markProviderSettingsDirty() {
    setIsProviderDraftDirty(true);
    setFailedAutosaveRevision(null);
    setProviderSaveStatus("idle");
    setAuthError("");
    setAuthMessage("");
    setProviderDraftRevision((current) => {
      const nextRevision = current + 1;
      latestProviderDraftRevisionRef.current = nextRevision;
      return nextRevision;
    });
  }

  function updateProviderDraft(providerId: KnownProviderId, update: Partial<ProviderDraft>) {
    setProviderDrafts((current) => ({
      ...current,
      [providerId]: {
        ...current[providerId],
        ...update
      }
    }));
    markProviderSettingsDirty();
  }

  function updateBackgroundTasksDraft(update: Partial<BackgroundTasksDraft>) {
    setBackgroundTasksDraft((current) => ({
      ...current,
      ...update,
    }));
    markProviderSettingsDirty();
  }

  function applyBackgroundTaskProviderSelection(providerId: BackgroundTasksDraftProviderId) {
    updateBackgroundTasksDraft({
      providerId,
      model: backgroundTaskDefaultModel(providerId, effectiveRuntimeConfig),
    });
  }

  function updateImageGenerationDraft(update: Partial<ImageGenerationDraft>) {
    setImageGenerationDraft((current) => ({
      ...current,
      ...update,
    }));
    markProviderSettingsDirty();
  }

  function applyImageGenerationProviderSelection(providerId: ImageGenerationDraftProviderId) {
    updateImageGenerationDraft({
      providerId,
      model: imageGenerationDefaultModel(providerId, effectiveRuntimeConfig),
    });
  }

  async function persistRuntimeProviderSettings(
    draftsSnapshot: ProviderDraftMap,
    backgroundTasksSnapshot: BackgroundTasksDraft,
    imageGenerationSnapshot: ImageGenerationDraft,
    draftRevision: number,
    source: "autosave" | "manual",
  ) {
    if (!window.electronAPI) {
      return;
    }

    setIsSavingRuntimeConfigDocument(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const currentDocument = parseRuntimeConfigDocument(runtimeConfigDocument);
      const currentRuntime = asRecord(currentDocument.runtime);
      const currentProviders = asRecord(currentDocument.providers);
      const currentModels = asRecord(currentDocument.models);

      const nextProviders: Record<string, unknown> = {};
      for (const [providerId, providerPayload] of Object.entries(currentProviders)) {
        const normalizedProviderId = providerId.trim();
        if (!isKnownProviderId(normalizedProviderId) && normalizedProviderId !== "holaboss_model_proxy") {
          nextProviders[providerId] = providerPayload;
        }
      }

      const nextModels: Record<string, unknown> = {};
      for (const [token, modelPayload] of Object.entries(currentModels)) {
        const parsedModelPayload = asRecord(modelPayload);
        const modelProviderId = firstNonEmptyString(
          parsedModelPayload.provider as string | undefined,
          parsedModelPayload.provider_id as string | undefined,
          token.includes("/") ? token.split("/")[0]?.trim() : ""
        );
        if (modelProviderId && !isKnownProviderId(modelProviderId)) {
          nextModels[token] = modelPayload;
        }
      }

      const enabledProviders = enabledProviderIdsForDrafts(draftsSnapshot, isSignedIn);

      for (const providerId of enabledProviders) {
        const providerTemplate = KNOWN_PROVIDER_TEMPLATES[providerId];
        const providerDraft = draftsSnapshot[providerId];
        const runtimeProviderId = runtimeProviderStorageId(providerId);
        const existingProviderPayload = asRecord(
          currentProviders[runtimeProviderId] ?? (providerId === "holaboss" ? currentProviders.holaboss : undefined)
        );
        const existingProviderOptions = asRecord(existingProviderPayload.options);
        const providerOptions =
          Object.keys(existingProviderOptions).length > 0
            ? { ...existingProviderOptions }
            : null;
        const providerPayload: Record<string, unknown> =
          providerId === "holaboss"
            ? { ...existingProviderPayload }
            : { kind: providerTemplate.kind };
        if (!firstNonEmptyString(providerPayload.kind as string | undefined)) {
          providerPayload.kind = providerTemplate.kind;
        }
        if (providerId !== "holaboss") {
          const normalizedBaseUrl = firstNonEmptyString(
            providerDraft.baseUrl,
            existingProviderPayload.base_url as string | undefined,
            existingProviderPayload.baseURL as string | undefined,
            existingProviderOptions.base_url as string | undefined,
            existingProviderOptions.baseURL as string | undefined,
          );
          const normalizedApiKey = firstNonEmptyString(
            providerDraft.apiKey,
            existingProviderPayload.api_key as string | undefined,
            existingProviderPayload.auth_token as string | undefined,
            existingProviderOptions.api_key as string | undefined,
            existingProviderOptions.apiKey as string | undefined,
          );
          if (normalizedBaseUrl) {
            providerPayload.base_url = normalizedBaseUrl;
          }
          if (normalizedApiKey) {
            providerPayload.api_key = normalizedApiKey;
          }
        }
        delete providerPayload.background_model;
        delete providerPayload.backgroundModel;
        delete providerPayload.image_model;
        delete providerPayload.imageModel;
        if (providerOptions) {
          delete providerOptions.background_model;
          delete providerOptions.backgroundModel;
          delete providerOptions.image_model;
          delete providerOptions.imageModel;
          if (Object.keys(providerOptions).length > 0) {
            providerPayload.options = providerOptions;
          } else {
            delete providerPayload.options;
          }
        }
        if (
          providerId === "holaboss" &&
          Object.keys(existingProviderPayload).length === 0 &&
          Object.keys(providerPayload).length === 1 &&
          providerPayload.kind === providerTemplate.kind
        ) {
          continue;
        }
        nextProviders[runtimeProviderId] = providerPayload;

        if (providerId !== "holaboss") {
          const configuredModels = parseModelsText(providerDraft.modelsText);
          const modelIds =
            configuredModels.length > 0
              ? configuredModels
              : providerTemplate.defaultModels.length > 0
                ? [providerTemplate.defaultModels[0]]
                : [];
          for (const modelId of modelIds) {
            const token = `${providerId}/${modelId}`;
            nextModels[token] = {
              provider: providerId,
              model: modelId
            };
          }
        }
      }

      const resolvedSandboxId =
        sandboxId.trim() ||
        firstNonEmptyString(
          currentRuntime.sandbox_id as string | undefined,
          runtimeConfig?.sandboxId ?? "",
          `desktop:${crypto.randomUUID()}`
        );
      const normalizedBackgroundProviderId = backgroundTaskProviderStorageId(backgroundTasksSnapshot.providerId);
      const normalizedBackgroundModel = backgroundTasksSnapshot.providerId
        ? configuredBackgroundModelId(backgroundTasksSnapshot.providerId, backgroundTasksSnapshot.model)
        : "";
      const normalizedImageGenerationProviderId = imageGenerationProviderStorageId(imageGenerationSnapshot.providerId);
      const normalizedImageGenerationModel = imageGenerationSnapshot.providerId
        ? configuredImageGenerationModelId(imageGenerationSnapshot.providerId, imageGenerationSnapshot.model)
        : "";
      const nextRuntime: Record<string, unknown> = {
        ...currentRuntime,
        sandbox_id: resolvedSandboxId
      };
      delete nextRuntime.backgroundTasks;
      delete nextRuntime.imageGeneration;
      if (normalizedBackgroundProviderId) {
        nextRuntime.background_tasks = {
          provider: normalizedBackgroundProviderId,
          model: normalizedBackgroundModel || null,
        };
      } else {
        delete nextRuntime.background_tasks;
        delete nextRuntime.backgroundTasks;
      }
      if (normalizedImageGenerationProviderId) {
        nextRuntime.image_generation = {
          provider: normalizedImageGenerationProviderId,
          model: normalizedImageGenerationModel || null,
        };
      } else {
        delete nextRuntime.image_generation;
        delete nextRuntime.imageGeneration;
      }
      const nextDocument = {
        ...currentDocument,
        runtime: nextRuntime,
        providers: nextProviders,
        models: nextModels
      };
      const nextDocumentText = `${JSON.stringify(nextDocument, null, 2)}\n`;
      const nextConfig = await window.electronAPI.runtime.setConfigDocument(nextDocumentText);
      setRuntimeConfig(nextConfig);
      setRuntimeConfigDocument(nextDocumentText);
      setSandboxId(resolvedSandboxId);
      if (latestProviderDraftRevisionRef.current === draftRevision) {
        setIsProviderDraftDirty(false);
        setFailedAutosaveRevision(null);
        setProviderSaveStatus("saved");
      }
      if (source === "manual") {
        setAuthMessage("Runtime provider settings saved. The runtime was restarted with the new settings.");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save runtime provider settings.");
      if (source === "autosave" && latestProviderDraftRevisionRef.current === draftRevision) {
        setFailedAutosaveRevision(draftRevision);
        setProviderSaveStatus("error");
      }
    } finally {
      setIsSavingRuntimeConfigDocument(false);
    }
  }

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }
    if (!isProviderDraftDirty || isSavingRuntimeConfigDocument) {
      return;
    }
    if (failedAutosaveRevision === providerDraftRevision) {
      return;
    }

    setProviderSaveStatus("saving");
    const timeoutId = window.setTimeout(() => {
      void persistRuntimeProviderSettings(
        providerDrafts,
        backgroundTasksDraft,
        imageGenerationDraft,
        providerDraftRevision,
        "autosave",
      );
    }, PROVIDER_AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    failedAutosaveRevision,
    isProviderDraftDirty,
    isSavingRuntimeConfigDocument,
    providerDraftRevision,
    providerDrafts,
    backgroundTasksDraft,
    imageGenerationDraft,
    runtimeConfig,
    runtimeConfigDocument,
    sandboxId,
    isSignedIn
  ]);

  async function handleExchangeRuntimeBinding() {
    if (!window.electronAPI) {
      return;
    }
    if (!isSignedIn) {
      setAuthError("Sign in first.");
      setAuthMessage("");
      return;
    }

    const resolvedSandboxId = sandboxId.trim() || `desktop:${crypto.randomUUID()}`;
    setIsExchangingRuntimeBinding(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const nextConfig = await window.electronAPI.runtime.exchangeBinding(resolvedSandboxId);
      setRuntimeConfig(nextConfig);
      setSandboxId(nextConfig.sandboxId ?? resolvedSandboxId);
      const nextDocument = await window.electronAPI.runtime.getConfigDocument();
      setRuntimeConfigDocument(nextDocument);
      setAuthMessage("Runtime binding refreshed and local runtime config updated.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to exchange runtime binding.");
    } finally {
      setIsExchangingRuntimeBinding(false);
    }
  }

  function renderProviderDrawerContent(providerId: KnownProviderId): ReactNode {
    if (!providerEnabled(providerId)) {
      return (
        <div className="rounded-[12px] border border-border/40 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Connect to edit settings.
        </div>
      );
    }

    const template = KNOWN_PROVIDER_TEMPLATES[providerId];
    const draft = providerDrafts[providerId];
    if (providerId === "holaboss") {
      return (
        <div className="grid gap-2">
          <div className="rounded-[12px] border border-border/35 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Catalog, base URL, and credentials come from your Holaboss runtime binding.
          </div>
        </div>
      );
    }
    return (
      <div className="grid gap-2">
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Base URL</span>
          <input
            className="auth-settings-control theme-control-surface h-9 rounded-[10px] border border-border/45 px-2.5 text-sm text-foreground outline-none transition"
            value={draft.baseUrl}
            onChange={(event) => updateProviderDraft(providerId, { baseUrl: event.target.value })}
            placeholder={template.defaultBaseUrl}
            spellCheck={false}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">API Key</span>
          <input
            className="auth-settings-control theme-control-surface h-9 rounded-[10px] border border-border/45 px-2.5 text-sm text-foreground outline-none transition"
            type="password"
            value={draft.apiKey}
            onChange={(event) => updateProviderDraft(providerId, { apiKey: event.target.value })}
            placeholder={template.apiKeyPlaceholder}
            spellCheck={false}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Models</span>
          <textarea
            className="auth-settings-control theme-control-surface min-h-[60px] rounded-[10px] border border-border/45 px-2.5 py-2 text-sm leading-5 text-foreground outline-none transition"
            value={draft.modelsText}
            onChange={(event) => updateProviderDraft(providerId, { modelsText: event.target.value })}
            placeholder={template.defaultModels.join(", ")}
            spellCheck={false}
          />
        </label>
      </div>
    );
  }

  function renderProviderCard(providerId: KnownProviderId) {
    const template = KNOWN_PROVIDER_TEMPLATES[providerId];
    const isHolabossProvider = providerId === "holaboss";
    const isEnabled = providerEnabled(providerId);
    const isExpandable = isEnabled;
    const isExpanded = isExpandable && expandedProviderId === providerId;
    const statusText = isHolabossProvider
      ? runtimeBindingReady
        ? "Managed and ready on this desktop."
        : isSignedIn
          ? "Signed in. Refresh runtime binding to finish setup."
          : "Sign in to enable the managed provider."
      : isEnabled
        ? "Connected. Expand to edit settings."
        : "Not connected.";
    const actionButtonClassName =
      "inline-flex h-9 min-w-[128px] shrink-0 items-center justify-center rounded-[10px] px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50";
    const actionBadgeClassName =
      "inline-flex h-9 min-w-[128px] shrink-0 items-center justify-center rounded-full border px-3 text-xs uppercase tracking-[0.14em]";

    return (
      <div
        key={providerId}
        className={`theme-control-surface overflow-hidden rounded-[14px] border transition ${
          isExpanded
            ? "border-primary/35 bg-card/96 shadow-[0_0_0_1px_rgb(var(--color-primary)/0.08)]"
            : "border-border/55 bg-card/92 hover:border-border/75"
        }`}
      >
        <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-border/55 bg-background/80 text-foreground">
              <ProviderBrandIcon providerId={providerId} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{template.label}</div>
              <div className="mt-1 text-sm leading-6 text-foreground/82">{template.description}</div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground/95">{statusText}</div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 md:flex-col md:items-end md:justify-center">
            {isHolabossProvider ? (
              isEnabled ? (
                <div className={`${actionBadgeClassName} border-primary/30 bg-primary/10 text-primary`}>
                  Enabled
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleStartSignIn()}
                  disabled={isStartingSignIn}
                  className={`${actionButtonClassName} border border-neon-green/40 bg-neon-green/10 text-neon-green hover:bg-neon-green/16`}
                >
                  {isStartingSignIn ? "Opening..." : "Sign in"}
                </button>
              )
            ) : isEnabled ? (
              <>
                <button
                  type="button"
                  onClick={() => setExpandedProviderId((current) => (current === providerId ? null : providerId))}
                  className={`${actionButtonClassName} border border-border/45 text-foreground hover:border-primary/35`}
                >
                  {isExpanded ? "Hide" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateProviderDraft(providerId, { enabled: false });
                    setExpandedProviderId((current) => (current === providerId ? null : current));
                  }}
                  className={`${actionButtonClassName} border border-border/45 text-foreground hover:border-destructive/40 hover:text-destructive`}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const shouldSeedBackgroundTasks =
                    !backgroundTasksDraft.providerId && connectedProviderIds.length === 0;
                  const shouldSeedImageGeneration =
                    !imageGenerationDraft.providerId &&
                    connectedImageProviderIds.length === 0 &&
                    isImageGenerationProviderId(providerId);
                  updateProviderDraft(providerId, { enabled: true });
                  if (shouldSeedBackgroundTasks) {
                    applyBackgroundTaskProviderSelection(providerId);
                  }
                  if (shouldSeedImageGeneration) {
                    applyImageGenerationProviderSelection(providerId);
                  }
                  setExpandedProviderId(providerId);
                }}
                className={`${actionButtonClassName} border border-border/55 text-foreground hover:border-neon-green/35 hover:text-neon-green`}
              >
                Connect
              </button>
            )}
          </div>
        </div>

        {isExpanded && isEnabled && (
          <div className="border-t border-border/35 px-4 pb-4 pt-3">
            {renderProviderDrawerContent(providerId)}
          </div>
        )}
      </div>
    );
  }

  const runtimeProviderSettings = (
    <div className="theme-subtle-surface mt-3 grid gap-4 rounded-[20px] border border-border/40 p-4">
      <div className="rounded-[18px] border border-border/40 bg-card/80 p-4">
        <div className="text-sm font-medium text-foreground">Connected providers</div>
        <div className="mt-3 grid gap-3">
          <div className="rounded-[14px] border border-border/35 bg-muted/25 p-3">
            <div className="text-sm font-medium text-foreground">Background tasks</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Used for memory recall and post-run tasks.
            </div>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1">
                <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Provider</span>
                <Select
                  value={backgroundTasksDraft.providerId}
                  onValueChange={(value) =>
                    applyBackgroundTaskProviderSelection(
                      backgroundTaskProviderDraftId(value ?? ""),
                    )
                  }
                  disabled={backgroundProviderOptions.length === 0}
                >
                  <SelectTrigger className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {backgroundProviderOptions.map((providerId) => {
                      const isConnected = connectedProviderIds.includes(providerId);
                      const label = isConnected
                        ? backgroundTaskProviderLabel(providerId)
                        : `${backgroundTaskProviderLabel(providerId)} (not connected)`;
                      return (
                        <SelectItem key={providerId} value={providerId}>
                          {label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Model</span>
                {backgroundTaskUsesManagedModelPicker ? (
                  <Select
                    value={backgroundTasksDraft.model || undefined}
                    onValueChange={(value) =>
                      updateBackgroundTasksDraft({ model: value ?? "" })
                    }
                    disabled={!backgroundTasksDraft.providerId}
                  >
                    <SelectTrigger className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}>
                      <SelectValue
                        placeholder={backgroundTaskModelPlaceholder(
                          backgroundTasksDraft.providerId,
                          effectiveRuntimeConfig,
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {backgroundTaskModelOptions.map((modelId) => (
                        <SelectItem key={modelId} value={modelId}>
                          {modelId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <input
                      className="auth-settings-control theme-control-surface h-9 rounded-[10px] border border-border/45 px-2.5 text-sm text-foreground outline-none transition"
                      value={backgroundTasksDraft.model}
                      onChange={(event) => updateBackgroundTasksDraft({ model: event.target.value })}
                      placeholder={backgroundTaskModelPlaceholder(
                        backgroundTasksDraft.providerId,
                        effectiveRuntimeConfig,
                      )}
                      spellCheck={false}
                      list={
                        backgroundTasksDraft.providerId
                          ? `background-task-models-${backgroundTasksDraft.providerId}`
                          : undefined
                      }
                      disabled={!backgroundTasksDraft.providerId}
                    />
                    {backgroundTasksDraft.providerId ? (
                      <datalist id={`background-task-models-${backgroundTasksDraft.providerId}`}>
                        {backgroundProviderSuggestions.map((modelId) => (
                          <option key={modelId} value={modelId} />
                        ))}
                      </datalist>
                    ) : null}
                  </>
                )}
              </label>

              {backgroundTasksDraft.providerId && !backgroundProviderConnected ? (
                <div className="rounded-[12px] border border-border/35 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  Selected provider is not connected. Background tasks stay disabled until you reconnect it or choose another provider.
                </div>
              ) : null}
              {backgroundTasksDraft.providerId && !backgroundTasksDraft.model.trim() ? (
                <div className="rounded-[12px] border border-border/35 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  Select a model to enable background tasks.
                </div>
              ) : null}
            </div>
          </div>
          <div className="rounded-[14px] border border-border/35 bg-muted/25 p-3">
            <div className="text-sm font-medium text-foreground">Image generation</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Used when the agent generates new images into the workspace.
            </div>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1">
                <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Provider</span>
                <Select
                  value={imageGenerationDraft.providerId}
                  onValueChange={(value) =>
                    applyImageGenerationProviderSelection(
                      imageGenerationProviderDraftId(value ?? ""),
                    )
                  }
                  disabled={imageGenerationProviderOptions.length === 0}
                >
                  <SelectTrigger className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {imageGenerationProviderOptions.map((providerId) => {
                      const isConnected = connectedImageProviderIds.includes(providerId);
                      const label = isConnected
                        ? imageGenerationProviderLabel(providerId)
                        : `${imageGenerationProviderLabel(providerId)} (not connected)`;
                      return (
                        <SelectItem key={providerId} value={providerId}>
                          {label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Model</span>
                {imageGenerationUsesManagedModelPicker ? (
                  <Select
                    value={imageGenerationDraft.model || undefined}
                    onValueChange={(value) =>
                      updateImageGenerationDraft({ model: value ?? "" })
                    }
                    disabled={!imageGenerationDraft.providerId}
                  >
                    <SelectTrigger className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}>
                      <SelectValue
                        placeholder={imageGenerationModelPlaceholder(
                          imageGenerationDraft.providerId,
                          effectiveRuntimeConfig,
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {imageGenerationModelOptions.map((modelId) => (
                        <SelectItem key={modelId} value={modelId}>
                          {modelId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <input
                      className="auth-settings-control theme-control-surface h-9 rounded-[10px] border border-border/45 px-2.5 text-sm text-foreground outline-none transition"
                      value={imageGenerationDraft.model}
                      onChange={(event) => updateImageGenerationDraft({ model: event.target.value })}
                      placeholder={imageGenerationModelPlaceholder(
                        imageGenerationDraft.providerId,
                        effectiveRuntimeConfig,
                      )}
                      spellCheck={false}
                      list={
                        imageGenerationDraft.providerId
                          ? `image-generation-models-${imageGenerationDraft.providerId}`
                          : undefined
                      }
                      disabled={!imageGenerationDraft.providerId}
                    />
                    {imageGenerationDraft.providerId ? (
                      <datalist id={`image-generation-models-${imageGenerationDraft.providerId}`}>
                        {imageGenerationProviderSuggestions.map((modelId) => (
                          <option key={modelId} value={modelId} />
                        ))}
                      </datalist>
                    ) : null}
                  </>
                )}
              </label>

              {imageGenerationDraft.providerId && !imageGenerationProviderConnected ? (
                <div className="rounded-[12px] border border-border/35 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  Selected provider is not connected. Image generation stays disabled until you reconnect it or choose another provider.
                </div>
              ) : null}
              {imageGenerationDraft.providerId && !imageGenerationDraft.model.trim() ? (
                <div className="rounded-[12px] border border-border/35 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  Select a model to enable image generation.
                </div>
              ) : null}
            </div>
          </div>
          {connectedProviderIds.length === 0 ? (
            <div className="rounded-[12px] border border-border/35 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              No connected providers.
            </div>
          ) : (
            connectedProviderIds.map((providerId) => renderProviderCard(providerId))
          )}
        </div>
      </div>

      <div className="rounded-[18px] border border-border/40 bg-card/80 p-4">
        <div className="text-sm font-medium text-foreground">Available providers</div>
        <div className="mt-3 grid gap-2">
          {availableProviderIds.length === 0 ? (
            <div className="rounded-[12px] border border-border/35 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              All providers are connected.
            </div>
          ) : (
            availableProviderIds.map((providerId) => renderProviderCard(providerId))
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[18px] border border-border/40 bg-card/70 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 text-sm text-muted-foreground">{providerAutosaveMessage}</div>

        <div className="flex flex-wrap gap-2">
          <button
            className="theme-control-surface rounded-[14px] border border-border/45 px-3 py-2 text-sm text-foreground transition hover:border-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => void handleReloadRuntimeSettings()}
          >
            Reload settings
          </button>
          <button
            className="theme-control-surface rounded-[14px] border border-border/45 px-3 py-2 text-sm text-foreground transition hover:border-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => void handleExchangeRuntimeBinding()}
            disabled={isExchangingRuntimeBinding || !isSignedIn}
          >
            {isExchangingRuntimeBinding ? "Refreshing..." : "Refresh runtime binding"}
          </button>
        </div>
      </div>
    </div>
  );

  if (view === "account") {
    return (
      <section className="grid w-full max-w-[1080px] gap-5">
        <div className="rounded-[28px] border border-border/35 bg-card/95 px-5 py-5 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-border/30 bg-muted/70 text-2xl font-semibold text-foreground">
                {sessionInitials(session)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[28px] font-semibold tracking-[-0.04em] text-foreground">
                  {isSignedIn
                    ? sessionDisplayName(session) || "Holaboss account"
                    : "Holaboss account"}
                </div>
                <div className="mt-1 truncate text-base text-muted-foreground">
                  {isSignedIn ? sessionEmail(session) || "Signed in" : "Not connected"}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${badgeClassName}`}
                  >
                    <ShieldCheck size={12} />
                    <span>{statusBadgeLabel}</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/40 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/70" />
                    <span>
                      {runtimeBindingReady
                        ? "Runtime ready on this desktop"
                        : isSignedIn
                          ? "Runtime setup in progress"
                          : "Runtime unavailable"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 self-start md:self-auto">
              {isSignedIn ? (
                <>
                  <button
                    type="button"
                    aria-label="Refresh session"
                    onClick={() => void handleRefreshSession()}
                    disabled={sessionState.isPending}
                    className="grid h-11 w-11 place-items-center rounded-[16px] border border-border/45 bg-background text-muted-foreground transition hover:border-primary/35 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sessionState.isPending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Sign out"
                    onClick={() => void handleSignOut()}
                    disabled={!isSignedIn}
                    className="grid h-11 w-11 place-items-center rounded-[16px] border border-destructive/20 bg-destructive/5 text-destructive transition hover:border-destructive/35 hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <LogOut size={16} />
                  </button>
                </>
              ) : (
                <button
                  className="inline-flex h-11 items-center justify-center rounded-full border border-foreground bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void handleStartSignIn()}
                  disabled={isStartingSignIn}
                >
                  {isStartingSignIn ? "Opening sign-in..." : "Sign in"}
                </button>
              )}
            </div>
          </div>

          {isFinishingSetup && !isExchangingRuntimeBinding ? (
            <div className="mt-4 flex flex-col gap-3 rounded-[22px] border border-amber-300/20 bg-amber-400/8 px-4 py-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-amber-300">
                Sign-in completed. Holaboss is finishing local runtime setup.
              </div>
              <button
                className="inline-flex h-10 items-center justify-center rounded-full border border-amber-300/30 px-4 text-sm font-medium text-amber-200 transition hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => void handleExchangeRuntimeBinding()}
                disabled={isExchangingRuntimeBinding}
              >
                {isExchangingRuntimeBinding ? "Refreshing..." : "Retry setup"}
              </button>
            </div>
          ) : null}

          {(authMessage || authError) && (
            <div
              className={`mt-4 rounded-[20px] border px-4 py-3 text-sm ${
                authError
                  ? "border-rose-400/25 bg-rose-500/8 text-rose-400"
                  : "border-neon-green/25 bg-neon-green/8 text-neon-green"
              }`}
            >
              {authError || authMessage}
            </div>
          )}
        </div>

        <BillingSummaryCard
          overview={billingState.overview}
          usage={billingState.usage}
          links={billingState.links}
          isLoading={billingState.isLoading}
          error={billingState.error}
        />
      </section>
    );
  }

  if (runtimeOnlyView) {
    return (
      <div className="w-full">
        {runtimeProviderSettings}
        {(authMessage || authError) && (
          <div
            className={`mt-3 rounded-[16px] border px-4 py-3 text-sm ${
              authError
                ? "border-rose-400/35 bg-rose-500/8 text-rose-400"
                : "border-neon-green/35 bg-neon-green/8 text-neon-green"
            }`}
          >
            {authError || authMessage}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="theme-shell w-full max-w-none overflow-hidden rounded-[24px] border border-border/40 text-sm text-foreground shadow-card">
      {showAccountSection && (
        <>
          <div className="border-b border-panel-border/40 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-lg font-semibold text-primary">
                  {sessionInitials(session)}
                </div>
                <div className="min-w-0">
                  <div className="text-base font-medium text-foreground">
                    {isSignedIn ? sessionDisplayName(session) || "Holaboss account" : "Holaboss account"}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted-foreground">
                    {isSignedIn ? sessionEmail(session) || "Signed in" : "Not connected"}
                  </div>
                </div>
              </div>
              <div className={`shrink-0 rounded-full border px-3 py-1 text-xs tracking-[0.14em] ${badgeClassName}`}>{statusBadgeLabel}</div>
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="grid gap-2">
              {infoRows.map((row) => (
                <div
                  key={row.label}
                  className="theme-subtle-surface flex items-center justify-between gap-3 rounded-[16px] border border-panel-border/35 px-4 py-3"
                >
                  <div className="text-sm text-foreground">{row.label}</div>
                  <div className="max-w-[58%] truncate text-right text-sm text-muted-foreground">{row.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {!isSignedIn && (
                <button
                  className="inline-flex h-10 items-center justify-center rounded-[16px] border border-primary/40 bg-primary/10 px-4 text-sm text-primary transition hover:bg-primary/16 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void handleStartSignIn()}
                  disabled={isStartingSignIn}
                >
                  {isStartingSignIn ? "Opening sign-in..." : "Sign in with browser"}
                </button>
              )}

              {isSignedIn && !runtimeBindingReady && (
                <button
                  className="inline-flex h-10 items-center justify-center rounded-[16px] border border-primary/40 bg-primary/10 px-4 text-sm text-primary transition hover:bg-primary/16 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void handleExchangeRuntimeBinding()}
                  disabled={isExchangingRuntimeBinding}
                >
                  {isExchangingRuntimeBinding ? "Retrying setup..." : "Retry setup"}
                </button>
              )}

              <button
                className="theme-control-surface inline-flex h-10 items-center justify-center rounded-[16px] border border-border/45 px-4 text-sm text-foreground transition hover:border-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => void handleRefreshSession()}
                disabled={sessionState.isPending}
              >
                Refresh session
              </button>

              <button
                className="inline-flex h-10 items-center justify-center rounded-[16px] border border-destructive/30 bg-destructive/10 px-4 text-sm text-destructive transition hover:border-destructive/45 hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => void handleSignOut()}
                disabled={!isSignedIn}
              >
                Sign out
              </button>
            </div>

            {isFinishingSetup && !isExchangingRuntimeBinding && (
              <div className="mt-3 rounded-[16px] border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
                Sign-in completed. Holaboss is finishing local runtime setup.
              </div>
            )}

            {(authMessage || authError) && (
              <div
                className={`mt-3 rounded-[16px] border px-4 py-3 text-sm ${
                  authError
                    ? "border-rose-400/35 bg-rose-500/8 text-rose-400"
                    : "border-neon-green/35 bg-neon-green/8 text-neon-green"
                }`}
              >
                {authError || authMessage}
              </div>
            )}
          </div>
        </>
      )}

      {!showAccountSection && showRuntimeSection && (
        <div className="px-4 py-4">
          {runtimeProviderSettings}
          {(authMessage || authError) && (
            <div
              className={`mt-3 rounded-[16px] border px-4 py-3 text-sm ${
                authError
                  ? "border-rose-400/35 bg-rose-500/8 text-rose-400"
                  : "border-neon-green/35 bg-neon-green/8 text-neon-green"
              }`}
            >
              {authError || authMessage}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
