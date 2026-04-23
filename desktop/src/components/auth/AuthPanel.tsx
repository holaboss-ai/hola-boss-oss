import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/badge";
import anthropicLogoMarkup from "@/assets/providers/anthropic.svg?raw";
import geminiLogoMarkup from "@/assets/providers/gemini.svg?raw";
import minimaxLogoMarkup from "@/assets/providers/minimax.svg?raw";
import ollamaLogoMarkup from "@/assets/providers/ollama.svg?raw";
import openaiLogoMarkup from "@/assets/providers/openai.svg?raw";
import openrouterLogoMarkup from "@/assets/providers/openrouter.svg?raw";
import * as modelCatalog from "../../../shared/model-catalog.js";
import { BillingSummaryCard } from "@/components/billing/BillingSummaryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useDesktopAuthSession, type AuthSession } from "@/lib/auth/authClient";
import { holabossLogoUrl } from "@/lib/assetPaths";
import { useDesktopBilling } from "@/lib/billing/useDesktopBilling";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";

type AuthPanelView = "full" | "account" | "runtime";

interface AuthPanelProps {
  view?: AuthPanelView;
}

const AUTH_BROWSER_SIGN_IN_MESSAGE =
  "Sign-in opened in the browser. Complete the flow on the Holaboss sign-in page.";

const KNOWN_PROVIDER_ORDER = [
  "holaboss",
  "openai_direct",
  "openai_codex",
  "anthropic_direct",
  "openrouter_direct",
  "gemini_direct",
  "ollama_direct",
  "minimax_direct",
] as const;
type KnownProviderId = (typeof KNOWN_PROVIDER_ORDER)[number];
const AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME =
  "auth-settings-control theme-control-surface relative isolate h-9 w-full overflow-hidden rounded-[10px] border border-border bg-muted px-2.5 text-sm text-foreground shadow-none transition-colors hover:border-border focus-visible:border-border focus-visible:ring-0 focus-visible:ring-transparent aria-invalid:border-border aria-invalid:ring-0";
const PROVIDER_ROW_ACTIONS_CLASS_NAME =
  "flex min-w-[224px] shrink-0 items-center justify-end gap-2";
const PROVIDER_ROW_ACTION_ITEM_CLASS_NAME = "min-w-[104px] justify-center";
const LEGACY_DIRECT_PROVIDER_MODEL_ALIASES: Record<
  string,
  Record<string, string>
> = {
  anthropic_direct: {
    "claude-sonnet-4-5": "claude-sonnet-4-6",
  },
  gemini_direct: {
    "gemini-3.1-pro-preview": "gemini-2.5-pro",
    "gemini-2.5-flash-lite": "gemini-2.5-flash",
    "gemini-3.1-flash-lite-preview": "gemini-2.5-flash",
  },
};

type RuntimeCatalogModelCapability = "chat" | "image_generation" | "embedding";
const RUNTIME_MODEL_CAPABILITY_ALIASES: Record<
  string,
  RuntimeCatalogModelCapability
> = {
  chat: "chat",
  text: "chat",
  completion: "chat",
  completions: "chat",
  responses: "chat",
  embedding: "embedding",
  embeddings: "embedding",
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

const RECALL_EMBEDDING_PROVIDER_IDS = [
  "holaboss",
  "openai_direct",
  "openrouter_direct",
  "gemini_direct",
  "ollama_direct",
  "minimax_direct",
] as const;

type RecallEmbeddingsDraftProviderId =
  | (typeof RECALL_EMBEDDING_PROVIDER_IDS)[number]
  | "";

interface RecallEmbeddingsDraft {
  providerId: RecallEmbeddingsDraftProviderId;
  model: string;
}

const IMAGE_GENERATION_PROVIDER_IDS = [
  "holaboss",
  "openai_direct",
  "openrouter_direct",
  "gemini_direct",
] as const;

type ImageGenerationDraftProviderId =
  | (typeof IMAGE_GENERATION_PROVIDER_IDS)[number]
  | "";

interface ImageGenerationDraft {
  providerId: ImageGenerationDraftProviderId;
  model: string;
}

interface ProviderSettingsSnapshot {
  drafts: ProviderDraftMap;
  backgroundTasks: BackgroundTasksDraft;
  recallEmbeddings: RecallEmbeddingsDraft;
  imageGeneration: ImageGenerationDraft;
}

const KNOWN_PROVIDER_TEMPLATES: Record<KnownProviderId, KnownProviderTemplate> =
  {
    holaboss: {
      id: "holaboss",
      label: "Holaboss Proxy",
      description:
        "Managed by your Holaboss account session and runtime binding.",
      kind: "holaboss_proxy",
      defaultBaseUrl: "",
      defaultModels: [],
      defaultBackgroundModel: null,
      defaultImageModel: null,
      imageModelSuggestions: [],
      apiKeyPlaceholder: "hbrt.v1.your-proxy-token",
    },
    openai_direct: {
      id: "openai_direct",
      label: "OpenAI",
      description: "Direct OpenAI-compatible endpoint with your own API key.",
      kind: "openai_compatible",
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultModels: ["gpt-5.4", "gpt-5.3-codex"],
      defaultBackgroundModel: "gpt-5.4",
      defaultImageModel: "gpt-image-1.5",
      imageModelSuggestions: [
        "gpt-image-1.5",
        "gpt-image-1",
        "gpt-image-1-mini",
        "chatgpt-image-latest",
      ],
      apiKeyPlaceholder: "sk-your-openai-key",
    },
    openai_codex: {
      id: "openai_codex",
      label: "OpenAI Codex",
      description:
        "ChatGPT/Codex OAuth for GPT-5 models without a separate API key.",
      kind: "openai_compatible",
      defaultBaseUrl: "https://chatgpt.com/backend-api/codex",
      defaultModels: ["gpt-5.4", "gpt-5.3-codex"],
      defaultBackgroundModel: "gpt-5.4",
      defaultImageModel: null,
      imageModelSuggestions: [],
      apiKeyPlaceholder: "",
    },
    anthropic_direct: {
      id: "anthropic_direct",
      label: "Anthropic",
      description: "Direct Anthropic native endpoint with your own API key.",
      kind: "anthropic_native",
      defaultBaseUrl: "https://api.anthropic.com",
      defaultModels: [
        "claude-sonnet-4-6",
        "claude-opus-4-6",
        "claude-haiku-4-5",
      ],
      defaultBackgroundModel: "claude-sonnet-4-6",
      defaultImageModel: null,
      imageModelSuggestions: [],
      apiKeyPlaceholder: "sk-ant-your-anthropic-key",
    },
    openrouter_direct: {
      id: "openrouter_direct",
      label: "OpenRouter",
      description: "OpenRouter endpoint for provider-aggregated model access.",
      kind: "openrouter",
      defaultBaseUrl: "https://openrouter.ai/api/v1",
      defaultModels: [
        "openai/gpt-5.4",
        "anthropic/claude-sonnet-4-6",
        "qwen/qwen3.6-plus",
      ],
      defaultBackgroundModel: "openai/gpt-5.4",
      defaultImageModel: "google/gemini-3.1-flash-image-preview",
      imageModelSuggestions: ["google/gemini-3.1-flash-image-preview"],
      apiKeyPlaceholder: "sk-or-your-openrouter-key",
    },
    gemini_direct: {
      id: "gemini_direct",
      label: "Gemini",
      description:
        "Google Gemini OpenAI-compatible endpoint with your own API key.",
      kind: "openai_compatible",
      defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
      defaultBackgroundModel: "gemini-2.5-flash",
      defaultImageModel: "gemini-3.1-flash-image-preview",
      imageModelSuggestions: [
        "gemini-3.1-flash-image-preview",
        "gemini-2.5-flash-image",
      ],
      apiKeyPlaceholder: "AIza...your-gemini-api-key",
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
      apiKeyPlaceholder:
        "Optional. Use 'ollama' for strict OpenAI SDK compatibility.",
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
      apiKeyPlaceholder: "sk-your-minimax-api-key",
    },
  };

const RECALL_EMBEDDING_MODEL_DEFAULTS: Record<
  Exclude<RecallEmbeddingsDraftProviderId, "">,
  string | null
> = {
  holaboss: "text-embedding-3-small",
  openai_direct: "text-embedding-3-small",
  openrouter_direct: "openai/text-embedding-3-small",
  gemini_direct: null,
  ollama_direct: null,
  minimax_direct: null,
};

const RECALL_EMBEDDING_MODEL_SUGGESTIONS: Record<
  Exclude<RecallEmbeddingsDraftProviderId, "">,
  string[]
> = {
  holaboss: ["text-embedding-3-small"],
  openai_direct: ["text-embedding-3-small", "text-embedding-3-large"],
  openrouter_direct: [
    "openai/text-embedding-3-small",
    "openai/text-embedding-3-large",
  ],
  gemini_direct: [],
  ollama_direct: [],
  minimax_direct: [],
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
      modelsText:
        KNOWN_PROVIDER_TEMPLATES.openai_direct.defaultModels.join(", "),
    },
    openai_codex: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.openai_codex.defaultBaseUrl,
      apiKey: "",
      modelsText:
        KNOWN_PROVIDER_TEMPLATES.openai_codex.defaultModels.join(", "),
    },
    anthropic_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.anthropic_direct.defaultBaseUrl,
      apiKey: "",
      modelsText:
        KNOWN_PROVIDER_TEMPLATES.anthropic_direct.defaultModels.join(", "),
    },
    openrouter_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.openrouter_direct.defaultBaseUrl,
      apiKey: "",
      modelsText:
        KNOWN_PROVIDER_TEMPLATES.openrouter_direct.defaultModels.join(", "),
    },
    gemini_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.gemini_direct.defaultBaseUrl,
      apiKey: "",
      modelsText:
        KNOWN_PROVIDER_TEMPLATES.gemini_direct.defaultModels.join(", "),
    },
    ollama_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.ollama_direct.defaultBaseUrl,
      apiKey: "",
      modelsText:
        KNOWN_PROVIDER_TEMPLATES.ollama_direct.defaultModels.join(", "),
    },
    minimax_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.minimax_direct.defaultBaseUrl,
      apiKey: "",
      modelsText:
        KNOWN_PROVIDER_TEMPLATES.minimax_direct.defaultModels.join(", "),
    },
  };
}

function createDefaultBackgroundTasksDraft(): BackgroundTasksDraft {
  return {
    providerId: "",
    model: "",
  };
}

function createDefaultRecallEmbeddingsDraft(): RecallEmbeddingsDraft {
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

function firstNonEmptyString(
  ...values: Array<string | null | undefined>
): string {
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
      .filter(Boolean),
  );
}

function providerCatalogChatModelOptions(
  providerId: KnownProviderId,
): Array<{ modelId: string; label: string }> {
  if (providerId === "holaboss") {
    return [];
  }
  const providerCatalog = modelCatalog.PROVIDER_MODEL_CATALOG[providerId];
  if (!providerCatalog) {
    return [];
  }
  return providerCatalog.models.map((entry) => ({
    modelId: entry.model_id,
    label: entry.label?.trim() || entry.model_id,
  }));
}

function providerModelDisplayLabel(
  providerId: KnownProviderId,
  modelId: string,
): string {
  return (
    modelCatalog
      .catalogMetadataForProviderModel(providerId, modelId)
      ?.label?.trim() || modelId
  );
}

function holabossSupportedModels(
  runtimeConfig: RuntimeConfigPayload | null,
): Array<{ modelId: string; label: string }> {
  const managedGroup = runtimeConfig?.providerModelGroups.find(
    (group) => group.providerId === "holaboss_model_proxy",
  );
  if (!managedGroup) {
    return [];
  }
  return managedGroup.models
    .filter((model) => runtimeCatalogModelSupportsCapability(model, "chat"))
    .map((model) => ({
      modelId: model.modelId,
      label: model.label?.trim() || model.modelId,
    }));
}

function normalizeConfiguredProviderModelId(
  providerId: string,
  modelId: string,
): string {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const normalizedModelId = modelId.trim();
  if (!normalizedProviderId || !normalizedModelId) {
    return normalizedModelId;
  }
  return (
    LEGACY_DIRECT_PROVIDER_MODEL_ALIASES[normalizedProviderId]?.[
      normalizedModelId
    ] ?? normalizedModelId
  );
}

function normalizeRuntimeCatalogModelCapability(
  value: string,
): RuntimeCatalogModelCapability | "" {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized) {
    return "";
  }
  return RUNTIME_MODEL_CAPABILITY_ALIASES[normalized] ?? "";
}

function runtimeCatalogModelCapabilities(
  model: RuntimeProviderModelPayload,
): RuntimeCatalogModelCapability[] {
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

function enabledProviderIdsForDrafts(
  providerDrafts: ProviderDraftMap,
  isSignedIn: boolean,
): KnownProviderId[] {
  return KNOWN_PROVIDER_ORDER.filter((providerId) =>
    providerId === "holaboss" ? isSignedIn : providerDrafts[providerId].enabled,
  );
}

function directProviderRequiresManualFields(
  providerId: KnownProviderId,
): boolean {
  return providerId !== "holaboss" && providerId !== "openai_codex";
}

function providerBrandIconMarkup(providerId: KnownProviderId): string | null {
  if (providerId === "openai_direct" || providerId === "openai_codex") {
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
    (group) => group.providerId.trim() === runtimeProviderId,
  );
  if (!providerGroup) {
    return [];
  }
  return uniqueValues(
    providerGroup.models
      .filter((model) =>
        runtimeCatalogModelSupportsCapability(model, capability),
      )
      .map((model) =>
        normalizeConfiguredProviderModelId(
          providerId,
          model.modelId || model.token,
        ),
      )
      .filter(Boolean),
  );
}

function configuredRuntimeProviderPrefixes(
  providerId: KnownProviderId,
): string[] {
  if (providerId === "holaboss") {
    return [
      "openai/",
      "google/",
      "anthropic/",
      "holaboss/",
      "holaboss_model_proxy/",
    ];
  }
  return [`${providerId}/`];
}

function runtimeProviderStorageId(providerId: KnownProviderId): string {
  return providerId === "holaboss" ? "holaboss_model_proxy" : providerId;
}

function canonicalDraftProviderStorageId(providerId: string): string {
  const normalized = providerId.trim();
  if (!normalized) {
    return "";
  }
  if (normalized === "holaboss" || normalized === "holaboss_model_proxy") {
    return "holaboss_model_proxy";
  }
  return normalized;
}

function configuredBackgroundModelId(
  providerId: KnownProviderId,
  value: string,
): string {
  return normalizeConfiguredProviderModelId(providerId, value.trim());
}

function backgroundTaskProviderDraftId(
  value: string,
): BackgroundTasksDraftProviderId {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (normalized === "holaboss_model_proxy" || normalized === "holaboss") {
    return "holaboss";
  }
  return isKnownProviderId(normalized) ? normalized : "";
}

function backgroundTaskProviderStorageId(
  providerId: BackgroundTasksDraftProviderId,
): string {
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

function backgroundTaskProviderLabel(
  providerId: BackgroundTasksDraftProviderId,
): string {
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
    ...(template.defaultBackgroundModel
      ? [template.defaultBackgroundModel]
      : []),
  ]);
}

function isRecallEmbeddingProviderId(
  value: string,
): value is RecallEmbeddingsDraftProviderId {
  return (
    value === "" ||
    RECALL_EMBEDDING_PROVIDER_IDS.includes(
      value as (typeof RECALL_EMBEDDING_PROVIDER_IDS)[number],
    )
  );
}

function recallEmbeddingsProviderDraftId(
  value: string,
): RecallEmbeddingsDraftProviderId {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (normalized === "holaboss_model_proxy" || normalized === "holaboss") {
    return "holaboss";
  }
  return isRecallEmbeddingProviderId(normalized) ? normalized : "";
}

function recallEmbeddingsProviderStorageId(
  providerId: RecallEmbeddingsDraftProviderId,
): string {
  if (!providerId) {
    return "";
  }
  return runtimeProviderStorageId(providerId);
}

function configuredRecallEmbeddingsModelId(
  providerId: RecallEmbeddingsDraftProviderId,
  value: string,
): string {
  return normalizeConfiguredProviderModelId(providerId, value.trim());
}

function recallEmbeddingsDefaultModel(
  providerId: RecallEmbeddingsDraftProviderId,
  runtimeConfig: RuntimeConfigPayload | null,
): string {
  if (!providerId) {
    return "";
  }
  if (providerId === "holaboss") {
    return (
      runtimeConfig?.defaultEmbeddingModel ??
      RECALL_EMBEDDING_MODEL_DEFAULTS[providerId] ??
      ""
    );
  }
  return RECALL_EMBEDDING_MODEL_DEFAULTS[providerId] ?? "";
}

function recallEmbeddingsModelPlaceholder(
  providerId: RecallEmbeddingsDraftProviderId,
  runtimeConfig: RuntimeConfigPayload | null,
): string {
  const fallbackModel = recallEmbeddingsDefaultModel(providerId, runtimeConfig);
  return fallbackModel ? `Default: ${fallbackModel}` : "Select a model";
}

function recallEmbeddingsProviderLabel(
  providerId: RecallEmbeddingsDraftProviderId,
): string {
  if (!providerId) {
    return "";
  }
  return KNOWN_PROVIDER_TEMPLATES[providerId].label;
}

function recallEmbeddingsModelSuggestions(
  providerId: RecallEmbeddingsDraftProviderId,
  runtimeConfig: RuntimeConfigPayload | null,
): string[] {
  if (!providerId) {
    return [];
  }
  const managedCatalogEmbeddingModels =
    providerId === "holaboss"
      ? configuredRuntimeProviderModelIds(
          runtimeConfig,
          providerId,
          "embedding",
        )
      : [];
  if (providerId === "holaboss") {
    const defaultModel = recallEmbeddingsDefaultModel(
      providerId,
      runtimeConfig,
    );
    return uniqueValues([
      ...managedCatalogEmbeddingModels,
      ...(managedCatalogEmbeddingModels.length === 0 && defaultModel
        ? [defaultModel]
        : []),
      ...RECALL_EMBEDDING_MODEL_SUGGESTIONS[providerId],
    ]);
  }
  return uniqueValues([
    ...(RECALL_EMBEDDING_MODEL_DEFAULTS[providerId]
      ? [RECALL_EMBEDDING_MODEL_DEFAULTS[providerId] as string]
      : []),
    ...RECALL_EMBEDDING_MODEL_SUGGESTIONS[providerId],
  ]);
}

function deriveConfiguredRecallEmbeddingsDraft(
  document: Record<string, unknown>,
  runtimeConfig: RuntimeConfigPayload | null,
): RecallEmbeddingsDraft {
  const runtimePayload = asRecord(document.runtime);
  const recallEmbeddingsPayload = asRecord(
    runtimePayload.recall_embeddings ?? runtimePayload.recallEmbeddings,
  );
  const providerId = recallEmbeddingsProviderDraftId(
    firstNonEmptyString(
      recallEmbeddingsPayload.provider as string | undefined,
      recallEmbeddingsPayload.provider_id as string | undefined,
      recallEmbeddingsPayload.providerId as string | undefined,
    ),
  );
  return {
    providerId,
    model: providerId
      ? configuredRecallEmbeddingsModelId(
          providerId,
          firstNonEmptyString(
            recallEmbeddingsPayload.model as string | undefined,
            recallEmbeddingsPayload.model_id as string | undefined,
            recallEmbeddingsPayload.modelId as string | undefined,
            recallEmbeddingsDefaultModel(providerId, runtimeConfig),
          ),
        )
      : "",
  };
}

function isImageGenerationProviderId(
  value: string,
): value is ImageGenerationDraftProviderId {
  return (
    value === "" ||
    IMAGE_GENERATION_PROVIDER_IDS.includes(
      value as (typeof IMAGE_GENERATION_PROVIDER_IDS)[number],
    )
  );
}

function imageGenerationProviderDraftId(
  value: string,
): ImageGenerationDraftProviderId {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (normalized === "holaboss_model_proxy" || normalized === "holaboss") {
    return "holaboss";
  }
  return isImageGenerationProviderId(normalized) ? normalized : "";
}

function imageGenerationProviderStorageId(
  providerId: ImageGenerationDraftProviderId,
): string {
  if (!providerId) {
    return "";
  }
  return runtimeProviderStorageId(providerId);
}

function configuredImageGenerationModelId(
  providerId: ImageGenerationDraftProviderId,
  value: string,
): string {
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

function imageGenerationProviderLabel(
  providerId: ImageGenerationDraftProviderId,
): string {
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
      ? configuredRuntimeProviderModelIds(
          runtimeConfig,
          providerId,
          "image_generation",
        )
      : [];
  if (providerId === "holaboss") {
    return managedCatalogImageModels;
  }
  return uniqueValues([
    ...managedCatalogImageModels,
    ...(managedCatalogImageModels.length === 0 && template.defaultImageModel
      ? [template.defaultImageModel]
      : []),
    ...(managedCatalogImageModels.length === 0
      ? template.imageModelSuggestions
      : []),
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

function deriveLegacyBackgroundTasksDraft(
  document: Record<string, unknown>,
): BackgroundTasksDraft {
  const providersPayload = asRecord(document.providers);
  const matches: BackgroundTasksDraft[] = [];
  for (const providerId of KNOWN_PROVIDER_ORDER) {
    const runtimeProviderId = runtimeProviderStorageId(providerId);
    const providerPayload = asRecord(
      providerId === "holaboss"
        ? (providersPayload.holaboss_model_proxy ?? providersPayload.holaboss)
        : providersPayload[runtimeProviderId],
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

function deriveLegacyImageGenerationDraft(
  document: Record<string, unknown>,
): ImageGenerationDraft {
  const providersPayload = asRecord(document.providers);
  const matches: ImageGenerationDraft[] = [];
  for (const providerId of IMAGE_GENERATION_PROVIDER_IDS) {
    const runtimeProviderId = runtimeProviderStorageId(providerId);
    const providerPayload = asRecord(
      providerId === "holaboss"
        ? (providersPayload.holaboss_model_proxy ?? providersPayload.holaboss)
        : providersPayload[runtimeProviderId],
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
    return (
      <img
        src={holabossLogoUrl}
        alt=""
        className="h-4 w-4 object-contain"
        aria-hidden="true"
      />
    );
  }
  const iconMarkup = providerBrandIconMarkup(providerId);
  if (iconMarkup) {
    return (
      <span
        aria-hidden="true"
        className="block h-4 w-4 text-foreground [&_svg]:h-full [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: iconMarkup }}
      />
    );
  }
  return null;
}

function deriveProviderDraftsFromDocument(
  document: Record<string, unknown>,
  runtimeConfig: RuntimeConfigPayload | null,
): {
  drafts: ProviderDraftMap;
  sandboxId: string;
  backgroundTasks: BackgroundTasksDraft;
  recallEmbeddings: RecallEmbeddingsDraft;
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
        ? (providersPayload.holaboss_model_proxy ?? providersPayload.holaboss)
        : providersPayload[runtimeProviderId],
    );
    const optionsPayload = asRecord(providerPayload.options);

    const baseUrl = firstNonEmptyString(
      providerPayload.base_url as string | undefined,
      providerPayload.baseURL as string | undefined,
      optionsPayload.baseURL as string | undefined,
      optionsPayload.base_url as string | undefined,
      providerId === "holaboss" ? (runtimeConfig?.modelProxyBaseUrl ?? "") : "",
      template.defaultBaseUrl,
    );
    const apiKey = firstNonEmptyString(
      providerPayload.api_key as string | undefined,
      providerPayload.auth_token as string | undefined,
      optionsPayload.apiKey as string | undefined,
      optionsPayload.api_key as string | undefined,
      optionsPayload.authToken as string | undefined,
      optionsPayload.auth_token as string | undefined,
      providerId === "holaboss"
        ? (holabossIntegration.auth_token as string | undefined)
        : "",
    );
    const modelIds: string[] = [];
    if (providerId !== "holaboss") {
      for (const [token, rawModel] of Object.entries(modelsPayload)) {
        const modelPayload = asRecord(rawModel);
        let modelProvider = firstNonEmptyString(
          modelPayload.provider as string | undefined,
          modelPayload.provider_id as string | undefined,
        );
        let modelId = firstNonEmptyString(
          modelPayload.model as string | undefined,
          modelPayload.model_id as string | undefined,
        );
        if (!modelProvider && token.includes("/")) {
          const [prefix, ...rest] = token.split("/");
          if (prefix.trim() === providerId && rest.length > 0) {
            modelProvider = providerId;
            modelId = modelId || rest.join("/");
          }
        }
        if (modelProvider === providerId && modelId.trim()) {
          modelIds.push(
            normalizeConfiguredProviderModelId(providerId, modelId),
          );
        }
      }
    }
    const normalizedModelIds =
      providerId === "holaboss"
        ? configuredRuntimeProviderModelIds(runtimeConfig, providerId)
        : uniqueValues(modelIds);
    const fallbackDefaultModel = firstNonEmptyString(
      runtimePayload.default_model as string | undefined,
      runtimeConfig?.defaultModel ?? "",
    );
    if (providerId !== "holaboss" && normalizedModelIds.length === 0) {
      for (const providerPrefix of configuredRuntimeProviderPrefixes(
        providerId,
      )) {
        if (fallbackDefaultModel.startsWith(providerPrefix)) {
          normalizedModelIds.push(
            fallbackDefaultModel.slice(providerPrefix.length).trim(),
          );
          break;
        }
      }
    }
    drafts[providerId] = {
      enabled:
        Object.keys(providerPayload).length > 0 ||
        (providerId === "holaboss" &&
          Boolean((runtimeConfig?.modelProxyBaseUrl || "").trim())),
      baseUrl,
      apiKey: providerId === "openai_codex" ? "" : apiKey,
      modelsText: (normalizedModelIds.length > 0
        ? normalizedModelIds
        : template.defaultModels
      ).join(", "),
    };
  }

  const configuredBackgroundTasks = deriveConfiguredBackgroundTasksDraft(
    document,
    runtimeConfig,
  );
  const backgroundTasks = configuredBackgroundTasks.providerId
    ? configuredBackgroundTasks
    : deriveLegacyBackgroundTasksDraft(document);
  const recallEmbeddings = deriveConfiguredRecallEmbeddingsDraft(
    document,
    runtimeConfig,
  );
  const configuredImageGeneration = deriveConfiguredImageGenerationDraft(
    document,
    runtimeConfig,
  );
  const imageGeneration = configuredImageGeneration.providerId
    ? configuredImageGeneration
    : deriveLegacyImageGenerationDraft(document);

  return {
    drafts,
    sandboxId: firstNonEmptyString(
      runtimePayload.sandbox_id as string | undefined,
      runtimeConfig?.sandboxId ?? "",
    ),
    backgroundTasks,
    recallEmbeddings,
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

function sessionAvatarUser(session: AuthSession | null): {
  id?: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
} | null {
  if (!session || typeof session !== "object" || !("user" in session)) {
    return null;
  }
  const maybeUser = session.user;
  if (!maybeUser || typeof maybeUser !== "object") {
    return null;
  }
  const u = maybeUser as Record<string, unknown>;
  return {
    id: typeof u.id === "string" ? u.id : undefined,
    email: typeof u.email === "string" ? u.email : null,
    name: typeof u.name === "string" ? u.name : null,
    image: typeof u.image === "string" ? u.image : null,
  };
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
  const [runtimeConfig, setRuntimeConfig] =
    useState<RuntimeConfigPayload | null>(null);
  const [runtimeConfigDocument, setRuntimeConfigDocument] = useState("");
  const [hasLoadedRuntimeConfigDocument, setHasLoadedRuntimeConfigDocument] =
    useState(false);
  const [hydratedRuntimeConfigDocument, setHydratedRuntimeConfigDocument] =
    useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<ProviderDraftMap>(() =>
    createDefaultProviderDrafts(),
  );
  const [backgroundTasksDraft, setBackgroundTasksDraft] =
    useState<BackgroundTasksDraft>(() => createDefaultBackgroundTasksDraft());
  const [recallEmbeddingsDraft, setRecallEmbeddingsDraft] =
    useState<RecallEmbeddingsDraft>(() => createDefaultRecallEmbeddingsDraft());
  const [imageGenerationDraft, setImageGenerationDraft] =
    useState<ImageGenerationDraft>(() => createDefaultImageGenerationDraft());
  const [showAdvancedRuntimeSettings, setShowAdvancedRuntimeSettings] =
    useState(false);
  const [expandedProviderId, setExpandedProviderId] =
    useState<KnownProviderId | null>(null);
  const [sandboxId, setSandboxId] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isStartingSignIn, setIsStartingSignIn] = useState(false);
  const [isSavingRuntimeConfigDocument, setIsSavingRuntimeConfigDocument] =
    useState(false);
  const [isExchangingRuntimeBinding, setIsExchangingRuntimeBinding] =
    useState(false);
  const [connectingProviderId, setConnectingProviderId] =
    useState<KnownProviderId | null>(null);
  const [disconnectingProviderId, setDisconnectingProviderId] =
    useState<KnownProviderId | null>(null);
  const [isProviderDraftDirty, setIsProviderDraftDirty] = useState(false);
  const [providerSaveStatus, setProviderSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const effectiveRuntimeConfig = sharedRuntimeConfig ?? runtimeConfig;
  const hasHydratedProviderDrafts =
    hasLoadedRuntimeConfigDocument &&
    hydratedRuntimeConfigDocument === runtimeConfigDocument;

  async function refreshRuntimeConfig() {
    if (!window.electronAPI) {
      return;
    }
    const [config, document] = await Promise.all([
      window.electronAPI.runtime.getConfig(),
      window.electronAPI.runtime.getConfigDocument(),
    ]);
    setRuntimeConfig(config);
    setRuntimeConfigDocument(document);
    setHasLoadedRuntimeConfigDocument(true);
    setSandboxId(config.sandboxId ?? `desktop:${crypto.randomUUID()}`);
  }

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    let cancelled = false;
    void Promise.all([
      window.electronAPI.runtime.getConfig(),
      window.electronAPI.runtime.getConfigDocument(),
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
    setRecallEmbeddingsDraft(derived.recallEmbeddings);
    setImageGenerationDraft(derived.imageGeneration);
    setHydratedRuntimeConfigDocument(runtimeConfigDocument);
  }, [effectiveRuntimeConfig, isProviderDraftDirty, runtimeConfigDocument]);

  useEffect(() => {
    if (
      !window.electronAPI ||
      !hasHydratedProviderDrafts ||
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
    hasHydratedProviderDrafts,
    imageGenerationDraft.model,
    isProviderDraftDirty,
    isSavingRuntimeConfigDocument,
    runtimeConfigDocument,
  ]);

  const isSignedIn = Boolean(sessionUserId(session));
  const persistedProviderDrafts = deriveProviderDraftsFromDocument(
    parseRuntimeConfigDocument(runtimeConfigDocument),
    effectiveRuntimeConfig,
  ).drafts;
  const providerConnected = (providerId: KnownProviderId) =>
    providerId === "holaboss"
      ? isSignedIn
      : persistedProviderDrafts[providerId].enabled;
  const providerDraftEnabled = (providerId: KnownProviderId) =>
    providerId === "holaboss" ? isSignedIn : providerDrafts[providerId].enabled;
  const connectedProviderIds = KNOWN_PROVIDER_ORDER.filter((providerId) =>
    providerConnected(providerId),
  );
  const availableProviderIds = KNOWN_PROVIDER_ORDER.filter(
    (providerId) => !providerConnected(providerId),
  );
  const backgroundProviderConnected =
    backgroundTasksDraft.providerId !== "" &&
    connectedProviderIds.includes(backgroundTasksDraft.providerId);
  const backgroundProviderSuggestions = backgroundTaskModelSuggestions(
    backgroundTasksDraft.providerId,
    providerDrafts,
    effectiveRuntimeConfig,
  );
  const backgroundProviderOptions =
    backgroundTasksDraft.providerId &&
    !connectedProviderIds.includes(backgroundTasksDraft.providerId)
      ? [backgroundTasksDraft.providerId, ...connectedProviderIds]
      : connectedProviderIds;
  const backgroundTaskModelOptions = uniqueValues([
    backgroundTasksDraft.model.trim(),
    ...backgroundProviderSuggestions,
  ]);
  const connectedRecallEmbeddingProviderIds =
    RECALL_EMBEDDING_PROVIDER_IDS.filter((providerId) =>
      connectedProviderIds.includes(providerId),
    );
  const recallEmbeddingsProviderConnected =
    recallEmbeddingsDraft.providerId !== "" &&
    connectedRecallEmbeddingProviderIds.includes(
      recallEmbeddingsDraft.providerId,
    );
  const recallEmbeddingsProviderSuggestions = recallEmbeddingsModelSuggestions(
    recallEmbeddingsDraft.providerId,
    effectiveRuntimeConfig,
  );
  const recallEmbeddingsModelOptions = uniqueValues([
    recallEmbeddingsDraft.model.trim(),
    ...recallEmbeddingsProviderSuggestions,
  ]);
  const recallEmbeddingsProviderOptions =
    recallEmbeddingsDraft.providerId &&
    !connectedRecallEmbeddingProviderIds.includes(
      recallEmbeddingsDraft.providerId,
    )
      ? [
          recallEmbeddingsDraft.providerId,
          ...connectedRecallEmbeddingProviderIds,
        ]
      : connectedRecallEmbeddingProviderIds;
  const connectedImageProviderIds = IMAGE_GENERATION_PROVIDER_IDS.filter(
    (providerId) => connectedProviderIds.includes(providerId),
  );
  const imageGenerationProviderConnected =
    imageGenerationDraft.providerId !== "" &&
    connectedImageProviderIds.includes(imageGenerationDraft.providerId);
  const imageGenerationProviderSuggestions = imageGenerationModelSuggestions(
    imageGenerationDraft.providerId,
    effectiveRuntimeConfig,
  );
  const imageGenerationModelOptions = uniqueValues([
    imageGenerationDraft.model.trim(),
    ...imageGenerationProviderSuggestions,
  ]);
  const imageGenerationProviderOptions =
    imageGenerationDraft.providerId &&
    !connectedImageProviderIds.includes(imageGenerationDraft.providerId)
      ? [imageGenerationDraft.providerId, ...connectedImageProviderIds]
      : connectedImageProviderIds;
  const hasResolvableImageGenerationModel = connectedImageProviderIds.some(
    (providerId) =>
      Boolean(
        imageGenerationDefaultModel(providerId, effectiveRuntimeConfig).trim(),
      ),
  );
  const hasResolvableRecallEmbeddingsModel =
    connectedRecallEmbeddingProviderIds.some((providerId) =>
      Boolean(
        recallEmbeddingsDefaultModel(providerId, effectiveRuntimeConfig).trim(),
      ),
    );
  const advancedSettingsWarnings = [
    !hasResolvableRecallEmbeddingsModel
      ? "No embedding model can be resolved from the currently connected providers. Recall will stay on the slower staged path until you connect an embedding-capable provider or choose one in Advanced settings."
      : "",
    !hasResolvableImageGenerationModel
      ? "No image generation model can be resolved from the currently connected providers. Image generation will stay disabled until you connect a provider with an image model or choose one in Advanced settings."
      : "",
  ].filter(Boolean);

  useEffect(() => {
    if (isSignedIn || isProviderDraftDirty) {
      return;
    }

    if (backgroundTasksDraft.providerId === "holaboss") {
      setBackgroundTasksDraft({ providerId: "", model: "" });
    }
    if (recallEmbeddingsDraft.providerId === "holaboss") {
      setRecallEmbeddingsDraft({ providerId: "", model: "" });
    }
    if (imageGenerationDraft.providerId === "holaboss") {
      setImageGenerationDraft({ providerId: "", model: "" });
    }
  }, [
    backgroundTasksDraft.providerId,
    imageGenerationDraft.providerId,
    isProviderDraftDirty,
    isSignedIn,
    recallEmbeddingsDraft.providerId,
  ]);

  const showAccountSection = view !== "runtime";
  const showRuntimeSection = view !== "account";
  const runtimeOnlyView = !showAccountSection && showRuntimeSection;
  const runtimeBindingReady =
    Boolean(effectiveRuntimeConfig?.authTokenPresent) &&
    Boolean((effectiveRuntimeConfig?.sandboxId || "").trim()) &&
    Boolean((effectiveRuntimeConfig?.modelProxyBaseUrl || "").trim());
  const isRuntimeSetupPending =
    isSignedIn && !runtimeBindingReady && !authError;
  const showsSetupLoadingState = isRuntimeSetupPending;
  const statusTone = authError
    ? "error"
    : runtimeBindingReady
      ? "ready"
      : isRuntimeSetupPending
        ? "syncing"
        : "idle";

  const statusBadgeLabel = sessionState.isPending
    ? "Checking session"
    : authError
      ? "Needs attention"
      : runtimeBindingReady
        ? "Connected"
        : isSignedIn
          ? "Connecting"
          : "Signed out";

  const badgeClassName =
    statusTone === "error"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : statusTone === "ready"
        ? "border-success/30 bg-success/10 text-success"
        : statusTone === "syncing"
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-border bg-muted text-muted-foreground";

  useEffect(() => {
    if (
      authMessage === AUTH_BROWSER_SIGN_IN_MESSAGE &&
      isSignedIn &&
      !showsSetupLoadingState
    ) {
      setAuthMessage("");
    }
  }, [authMessage, isSignedIn, showsSetupLoadingState]);

  const infoRows = [
    {
      label: "Profile",
      value: isSignedIn ? "Connected" : "Sign in required",
    },
    {
      label: "Runtime",
      value: runtimeBindingReady
        ? "Ready on this desktop"
        : isSignedIn
          ? "Connecting desktop"
          : "Offline",
    },
  ];

  const setupLoadingPanel = (
    <div className="theme-subtle-surface flex flex-col items-center gap-3 rounded-[20px] border border-border px-5 py-8 text-center">
      <div className="flex size-11 items-center justify-center rounded-full border border-primary bg-primary/10 text-primary">
        <Loader2 size={18} className="animate-spin" />
      </div>
      <div className="text-base font-medium text-foreground">
        {isExchangingRuntimeBinding
          ? "Refreshing desktop connection..."
          : "Connecting your account..."}
      </div>
      <div className="max-w-[520px] text-sm leading-6 text-muted-foreground">
        Finalizing your desktop session and runtime binding. This should only
        take a moment.
      </div>
    </div>
  );

  useEffect(() => {
    if (!hasHydratedProviderDrafts) {
      return;
    }
    if (
      isProviderDraftDirty ||
      backgroundTasksDraft.providerId ||
      connectedProviderIds.length === 0
    ) {
      return;
    }
    applyBackgroundTaskProviderSelection(connectedProviderIds[0] ?? "");
  }, [
    backgroundTasksDraft.providerId,
    connectedProviderIds,
    hasHydratedProviderDrafts,
    isProviderDraftDirty,
  ]);

  useEffect(() => {
    if (!hasHydratedProviderDrafts) {
      return;
    }
    if (
      isProviderDraftDirty ||
      recallEmbeddingsDraft.providerId ||
      connectedRecallEmbeddingProviderIds.length === 0
    ) {
      return;
    }
    applyRecallEmbeddingsProviderSelection(
      connectedRecallEmbeddingProviderIds[0] ?? "",
    );
  }, [
    connectedRecallEmbeddingProviderIds,
    hasHydratedProviderDrafts,
    isProviderDraftDirty,
    recallEmbeddingsDraft.providerId,
  ]);

  useEffect(() => {
    if (!hasHydratedProviderDrafts) {
      return;
    }
    if (
      isProviderDraftDirty ||
      imageGenerationDraft.providerId ||
      connectedImageProviderIds.length === 0
    ) {
      return;
    }
    applyImageGenerationProviderSelection(connectedImageProviderIds[0] ?? "");
  }, [
    connectedImageProviderIds,
    hasHydratedProviderDrafts,
    imageGenerationDraft.providerId,
    isProviderDraftDirty,
  ]);

  async function handleStartSignIn() {
    setIsStartingSignIn(true);
    setAuthError("");
    setAuthMessage("");
    try {
      await sessionState.requestAuth();
      setAuthMessage(AUTH_BROWSER_SIGN_IN_MESSAGE);
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Failed to start sign-in.",
      );
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
      setAuthError(
        error instanceof Error ? error.message : "Failed to sign out.",
      );
    }
  }

  function markProviderSettingsDirty() {
    setIsProviderDraftDirty(true);
    setProviderSaveStatus("idle");
    setAuthError("");
    setAuthMessage("");
  }

  function updateProviderDraft(
    providerId: KnownProviderId,
    update: Partial<ProviderDraft>,
  ) {
    setProviderDrafts((current) => ({
      ...current,
      [providerId]: {
        ...current[providerId],
        ...update,
      },
    }));
    markProviderSettingsDirty();
  }

  function updateProviderDraftModels(
    providerId: KnownProviderId,
    modelIds: string[],
  ) {
    updateProviderDraft(providerId, {
      modelsText: uniqueValues(modelIds).join(", "),
    });
  }

  function toggleProviderDraftModel(
    providerId: KnownProviderId,
    modelId: string,
  ) {
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId) {
      return;
    }
    const currentModelIds = parseModelsText(
      providerDrafts[providerId].modelsText,
    );
    updateProviderDraftModels(
      providerId,
      currentModelIds.includes(normalizedModelId)
        ? currentModelIds.filter(
            (currentModelId) => currentModelId !== normalizedModelId,
          )
        : [...currentModelIds, normalizedModelId],
    );
  }

  function removeProviderDraftModel(
    providerId: KnownProviderId,
    modelId: string,
  ) {
    const normalizedModelId = modelId.trim();
    updateProviderDraftModels(
      providerId,
      parseModelsText(providerDrafts[providerId].modelsText).filter(
        (currentModelId) => currentModelId !== normalizedModelId,
      ),
    );
  }

  function updateBackgroundTasksDraft(update: Partial<BackgroundTasksDraft>) {
    setBackgroundTasksDraft((current) => ({
      ...current,
      ...update,
    }));
    markProviderSettingsDirty();
  }

  function applyBackgroundTaskProviderSelection(
    providerId: BackgroundTasksDraftProviderId,
  ) {
    updateBackgroundTasksDraft({
      providerId,
      model: backgroundTaskDefaultModel(providerId, effectiveRuntimeConfig),
    });
  }

  function updateRecallEmbeddingsDraft(update: Partial<RecallEmbeddingsDraft>) {
    setRecallEmbeddingsDraft((current) => ({
      ...current,
      ...update,
    }));
    markProviderSettingsDirty();
  }

  function applyRecallEmbeddingsProviderSelection(
    providerId: RecallEmbeddingsDraftProviderId,
  ) {
    updateRecallEmbeddingsDraft({
      providerId,
      model: recallEmbeddingsDefaultModel(providerId, effectiveRuntimeConfig),
    });
  }

  function updateImageGenerationDraft(update: Partial<ImageGenerationDraft>) {
    setImageGenerationDraft((current) => ({
      ...current,
      ...update,
    }));
    markProviderSettingsDirty();
  }

  function applyImageGenerationProviderSelection(
    providerId: ImageGenerationDraftProviderId,
  ) {
    updateImageGenerationDraft({
      providerId,
      model: imageGenerationDefaultModel(providerId, effectiveRuntimeConfig),
    });
  }

  function persistedProviderSettingsSnapshot(
    documentText = runtimeConfigDocument,
    runtimeConfigSnapshot = effectiveRuntimeConfig,
  ): ProviderSettingsSnapshot {
    const derived = deriveProviderDraftsFromDocument(
      parseRuntimeConfigDocument(documentText),
      runtimeConfigSnapshot,
    );
    return {
      drafts: derived.drafts,
      backgroundTasks: derived.backgroundTasks,
      recallEmbeddings: derived.recallEmbeddings,
      imageGeneration: derived.imageGeneration,
    };
  }

  function providerSettingsSnapshotIsDirty(
    snapshot: ProviderSettingsSnapshot,
    documentText = runtimeConfigDocument,
    runtimeConfigSnapshot = effectiveRuntimeConfig,
  ): boolean {
    const persisted = persistedProviderSettingsSnapshot(
      documentText,
      runtimeConfigSnapshot,
    );
    return (
      JSON.stringify(snapshot.drafts) !== JSON.stringify(persisted.drafts) ||
      JSON.stringify(snapshot.backgroundTasks) !==
        JSON.stringify(persisted.backgroundTasks) ||
      JSON.stringify(snapshot.recallEmbeddings) !==
        JSON.stringify(persisted.recallEmbeddings) ||
      JSON.stringify(snapshot.imageGeneration) !==
        JSON.stringify(persisted.imageGeneration)
    );
  }

  function providerDraftValidationError(providerId: KnownProviderId): string {
    const draft = providerDrafts[providerId];
    const label = KNOWN_PROVIDER_TEMPLATES[providerId].label;
    if (
      providerId !== "holaboss" &&
      parseModelsText(draft.modelsText).length === 0
    ) {
      return `${label} requires at least one model before it can be connected.`;
    }
    if (!directProviderRequiresManualFields(providerId)) {
      return "";
    }
    if (!draft.baseUrl.trim()) {
      return `${label} requires a base URL before it can be connected.`;
    }
    if (!draft.apiKey.trim()) {
      return `${label} requires an API key before it can be connected.`;
    }
    return "";
  }

  function handleCancelProviderEditing(providerId: KnownProviderId) {
    const persisted = persistedProviderSettingsSnapshot();
    const nextDrafts = {
      ...providerDrafts,
      [providerId]: persisted.drafts[providerId],
    };
    setProviderDrafts(nextDrafts);
    setExpandedProviderId((current) =>
      current === providerId ? null : current,
    );
    setAuthError("");
    setAuthMessage("");
    setProviderSaveStatus("idle");
    setIsProviderDraftDirty(
      providerSettingsSnapshotIsDirty({
        drafts: nextDrafts,
        backgroundTasks: backgroundTasksDraft,
        recallEmbeddings: recallEmbeddingsDraft,
        imageGeneration: imageGenerationDraft,
      }),
    );
  }

  async function persistRuntimeProviderSettings(
    draftsSnapshot: ProviderDraftMap,
    backgroundTasksSnapshot: BackgroundTasksDraft,
    recallEmbeddingsSnapshot: RecallEmbeddingsDraft,
    imageGenerationSnapshot: ImageGenerationDraft,
  ): Promise<{
    nextConfig: RuntimeConfigPayload;
    nextDocumentText: string;
  } | null> {
    if (!window.electronAPI) {
      return null;
    }

    setIsSavingRuntimeConfigDocument(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const currentDocumentText =
        await window.electronAPI.runtime.getConfigDocument();
      const currentDocument = parseRuntimeConfigDocument(currentDocumentText);
      const currentRuntime = asRecord(currentDocument.runtime);
      const currentProviders = asRecord(currentDocument.providers);
      const currentModels = asRecord(currentDocument.models);

      const nextProviders: Record<string, unknown> = { ...currentProviders };
      for (const providerId of KNOWN_PROVIDER_ORDER) {
        delete nextProviders[runtimeProviderStorageId(providerId)];
        if (providerId === "holaboss") {
          delete nextProviders.holaboss;
        }
      }

      const nextModels: Record<string, unknown> = { ...currentModels };
      for (const [token, modelPayload] of Object.entries(currentModels)) {
        const parsedModelPayload = asRecord(modelPayload);
        const modelProviderId = firstNonEmptyString(
          parsedModelPayload.provider as string | undefined,
          parsedModelPayload.provider_id as string | undefined,
          token.includes("/") ? token.split("/")[0]?.trim() : "",
        );
        const normalizedModelProviderId =
          canonicalDraftProviderStorageId(modelProviderId);
        if (
          isKnownProviderId(normalizedModelProviderId) ||
          normalizedModelProviderId === "holaboss_model_proxy"
        ) {
          delete nextModels[token];
        }
      }

      const enabledProviders = enabledProviderIdsForDrafts(
        draftsSnapshot,
        isSignedIn,
      );
      const enabledProviderSet = new Set<KnownProviderId>(enabledProviders);

      for (const providerId of enabledProviders) {
        const providerTemplate = KNOWN_PROVIDER_TEMPLATES[providerId];
        const providerDraft = draftsSnapshot[providerId];
        const runtimeProviderId = runtimeProviderStorageId(providerId);
        const existingProviderPayload = asRecord(
          currentProviders[runtimeProviderId] ??
            (providerId === "holaboss" ? currentProviders.holaboss : undefined),
        );
        const existingProviderOptions = asRecord(
          existingProviderPayload.options,
        );
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
              model: modelId,
              ...(modelCatalog.catalogConfigShapeForProviderModel(
                providerId,
                modelId,
              ) ?? {}),
            };
          }
        }
      }

      const resolvedSandboxId =
        sandboxId.trim() ||
        firstNonEmptyString(
          currentRuntime.sandbox_id as string | undefined,
          runtimeConfig?.sandboxId ?? "",
          `desktop:${crypto.randomUUID()}`,
        );
      const enabledBackgroundProviderId =
        backgroundTasksSnapshot.providerId &&
        enabledProviderSet.has(backgroundTasksSnapshot.providerId)
          ? backgroundTasksSnapshot.providerId
          : "";
      const normalizedBackgroundProviderId = backgroundTaskProviderStorageId(
        enabledBackgroundProviderId,
      );
      const normalizedBackgroundModel = enabledBackgroundProviderId
        ? configuredBackgroundModelId(
            enabledBackgroundProviderId,
            backgroundTasksSnapshot.model,
          )
        : "";
      const enabledRecallEmbeddingsProviderId =
        recallEmbeddingsSnapshot.providerId &&
        enabledProviderSet.has(recallEmbeddingsSnapshot.providerId)
          ? recallEmbeddingsSnapshot.providerId
          : "";
      const normalizedRecallEmbeddingsProviderId =
        recallEmbeddingsProviderStorageId(enabledRecallEmbeddingsProviderId);
      const normalizedRecallEmbeddingsModel = enabledRecallEmbeddingsProviderId
        ? configuredRecallEmbeddingsModelId(
            enabledRecallEmbeddingsProviderId,
            recallEmbeddingsSnapshot.model,
          )
        : "";
      const enabledImageGenerationProviderId =
        imageGenerationSnapshot.providerId &&
        enabledProviderSet.has(imageGenerationSnapshot.providerId)
          ? imageGenerationSnapshot.providerId
          : "";
      const normalizedImageGenerationProviderId =
        imageGenerationProviderStorageId(enabledImageGenerationProviderId);
      const normalizedImageGenerationModel = enabledImageGenerationProviderId
        ? configuredImageGenerationModelId(
            enabledImageGenerationProviderId,
            imageGenerationSnapshot.model,
          )
        : "";
      const nextRuntime: Record<string, unknown> = {
        ...currentRuntime,
        sandbox_id: resolvedSandboxId,
      };
      delete nextRuntime.backgroundTasks;
      delete nextRuntime.recallEmbeddings;
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
      if (normalizedRecallEmbeddingsProviderId) {
        nextRuntime.recall_embeddings = {
          provider: normalizedRecallEmbeddingsProviderId,
          model: normalizedRecallEmbeddingsModel || null,
        };
      } else {
        delete nextRuntime.recall_embeddings;
        delete nextRuntime.recallEmbeddings;
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
        models: nextModels,
      };
      const nextDocumentText = `${JSON.stringify(nextDocument, null, 2)}\n`;
      const nextConfig =
        await window.electronAPI.runtime.setConfigDocument(nextDocumentText);
      setRuntimeConfig(nextConfig);
      setRuntimeConfigDocument(nextDocumentText);
      setSandboxId(resolvedSandboxId);
      return {
        nextConfig,
        nextDocumentText,
      };
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Failed to save runtime provider settings.",
      );
      setProviderSaveStatus("error");
      return null;
    } finally {
      setIsSavingRuntimeConfigDocument(false);
    }
  }

  async function handleSaveRuntimeSettings(providerId?: KnownProviderId) {
    if (!window.electronAPI) {
      return;
    }

    const persisted = persistedProviderSettingsSnapshot();
    const draftsToSave = providerId
      ? {
          ...persisted.drafts,
          [providerId]: providerDrafts[providerId],
        }
      : providerDrafts;
    const backgroundTasksToSave = providerId
      ? persisted.backgroundTasks
      : backgroundTasksDraft;
    const recallEmbeddingsToSave = providerId
      ? persisted.recallEmbeddings
      : recallEmbeddingsDraft;
    const imageGenerationToSave = providerId
      ? persisted.imageGeneration
      : imageGenerationDraft;
    const providersToValidate = providerId
      ? [providerId]
      : KNOWN_PROVIDER_ORDER;

    for (const currentProviderId of providersToValidate) {
      if (!draftsToSave[currentProviderId].enabled) {
        continue;
      }
      const validationError = providerDraftValidationError(currentProviderId);
      if (validationError) {
        setAuthError(validationError);
        setAuthMessage("");
        setProviderSaveStatus("error");
        return;
      }
    }

    setProviderSaveStatus("saving");
    const result = await persistRuntimeProviderSettings(
      draftsToSave,
      backgroundTasksToSave,
      recallEmbeddingsToSave,
      imageGenerationToSave,
    );
    if (!result) {
      return;
    }

    const nextSnapshot: ProviderSettingsSnapshot = providerId
      ? {
          drafts: {
            ...providerDrafts,
            [providerId]: draftsToSave[providerId],
          },
          backgroundTasks: backgroundTasksDraft,
          recallEmbeddings: recallEmbeddingsDraft,
          imageGeneration: imageGenerationDraft,
        }
      : {
          drafts: providerDrafts,
          backgroundTasks: backgroundTasksDraft,
          recallEmbeddings: recallEmbeddingsDraft,
          imageGeneration: imageGenerationDraft,
        };
    const hasRemainingUnsavedChanges = providerSettingsSnapshotIsDirty(
      nextSnapshot,
      result.nextDocumentText,
      result.nextConfig,
    );
    setIsProviderDraftDirty(hasRemainingUnsavedChanges);
    setProviderSaveStatus(hasRemainingUnsavedChanges ? "idle" : "saved");
    if (providerId) {
      setExpandedProviderId((current) =>
        current === providerId ? null : current,
      );
      setAuthMessage(
        hasRemainingUnsavedChanges
          ? `${KNOWN_PROVIDER_TEMPLATES[providerId].label} settings saved. Other changes are still unsaved.`
          : `${KNOWN_PROVIDER_TEMPLATES[providerId].label} settings saved.`,
      );
      return;
    }
    setAuthMessage(
      "Runtime provider settings saved. The runtime was restarted with the new settings.",
    );
  }

  async function handleDisconnectRuntimeProvider(providerId: KnownProviderId) {
    if (!window.electronAPI || providerId === "holaboss") {
      return;
    }

    const persistedBeforeDisconnect = persistedProviderSettingsSnapshot();
    const draftsToSave = {
      ...persistedBeforeDisconnect.drafts,
      [providerId]: {
        ...persistedBeforeDisconnect.drafts[providerId],
        enabled: false,
      },
    };

    setDisconnectingProviderId(providerId);
    setProviderSaveStatus("saving");
    const result = await persistRuntimeProviderSettings(
      draftsToSave,
      persistedBeforeDisconnect.backgroundTasks,
      persistedBeforeDisconnect.recallEmbeddings,
      persistedBeforeDisconnect.imageGeneration,
    );
    setDisconnectingProviderId(null);
    if (!result) {
      return;
    }

    const persistedAfterDisconnect = persistedProviderSettingsSnapshot(
      result.nextDocumentText,
      result.nextConfig,
    );
    const nextProviderDrafts = {
      ...providerDrafts,
      [providerId]: persistedAfterDisconnect.drafts[providerId],
    };
    const nextBackgroundTasksDraft =
      JSON.stringify(backgroundTasksDraft) ===
      JSON.stringify(persistedBeforeDisconnect.backgroundTasks)
        ? persistedAfterDisconnect.backgroundTasks
        : backgroundTasksDraft;
    const nextImageGenerationDraft =
      JSON.stringify(imageGenerationDraft) ===
      JSON.stringify(persistedBeforeDisconnect.imageGeneration)
        ? persistedAfterDisconnect.imageGeneration
        : imageGenerationDraft;
    const nextRecallEmbeddingsDraft =
      JSON.stringify(recallEmbeddingsDraft) ===
      JSON.stringify(persistedBeforeDisconnect.recallEmbeddings)
        ? persistedAfterDisconnect.recallEmbeddings
        : recallEmbeddingsDraft;
    const nextSnapshot: ProviderSettingsSnapshot = {
      drafts: nextProviderDrafts,
      backgroundTasks: nextBackgroundTasksDraft,
      recallEmbeddings: nextRecallEmbeddingsDraft,
      imageGeneration: nextImageGenerationDraft,
    };
    const hasRemainingUnsavedChanges = providerSettingsSnapshotIsDirty(
      nextSnapshot,
      result.nextDocumentText,
      result.nextConfig,
    );

    setProviderDrafts(nextProviderDrafts);
    setBackgroundTasksDraft(nextBackgroundTasksDraft);
    setRecallEmbeddingsDraft(nextRecallEmbeddingsDraft);
    setImageGenerationDraft(nextImageGenerationDraft);
    setExpandedProviderId((current) =>
      current === providerId ? null : current,
    );
    setIsProviderDraftDirty(hasRemainingUnsavedChanges);
    setProviderSaveStatus(hasRemainingUnsavedChanges ? "idle" : "saved");
    setAuthMessage(
      hasRemainingUnsavedChanges
        ? `${KNOWN_PROVIDER_TEMPLATES[providerId].label} disconnected. Other changes are still unsaved.`
        : `${KNOWN_PROVIDER_TEMPLATES[providerId].label} disconnected. The runtime was restarted with the new settings.`,
    );
  }

  async function handleConnectCodexProvider(providerId: KnownProviderId) {
    if (!window.electronAPI || providerId !== "openai_codex") {
      return;
    }
    if (isProviderDraftDirty) {
      setAuthError(
        "Save or discard your other runtime provider edits before connecting OpenAI Codex.",
      );
      setAuthMessage("");
      return;
    }

    setConnectingProviderId(providerId);
    setProviderSaveStatus("saving");
    setAuthError("");
    setAuthMessage(
      "OpenAI Codex sign-in is starting in your browser. The device code will be copied to your clipboard.",
    );
    try {
      const nextConfig = await window.electronAPI.runtime.connectCodexOAuth();
      const nextDocumentText =
        await window.electronAPI.runtime.getConfigDocument();
      const persisted = persistedProviderSettingsSnapshot(
        nextDocumentText,
        nextConfig,
      );
      setRuntimeConfig(nextConfig);
      setRuntimeConfigDocument(nextDocumentText);
      setSandboxId(nextConfig.sandboxId ?? sandboxId);
      setProviderDrafts(persisted.drafts);
      setBackgroundTasksDraft(persisted.backgroundTasks);
      setRecallEmbeddingsDraft(persisted.recallEmbeddings);
      setImageGenerationDraft(persisted.imageGeneration);
      setExpandedProviderId(providerId);
      setIsProviderDraftDirty(false);
      setProviderSaveStatus("saved");
      setAuthMessage(
        "OpenAI Codex connected. Future access token refreshes are managed locally on this desktop.",
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Failed to connect OpenAI Codex.",
      );
      setAuthMessage("");
      setProviderSaveStatus("error");
    } finally {
      setConnectingProviderId(null);
    }
  }

  async function handleExchangeRuntimeBinding() {
    if (!window.electronAPI) {
      return;
    }
    if (!isSignedIn) {
      setAuthError("Sign in first.");
      setAuthMessage("");
      return;
    }

    const resolvedSandboxId =
      sandboxId.trim() || `desktop:${crypto.randomUUID()}`;
    setIsExchangingRuntimeBinding(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const nextConfig =
        await window.electronAPI.runtime.exchangeBinding(resolvedSandboxId);
      setRuntimeConfig(nextConfig);
      setSandboxId(nextConfig.sandboxId ?? resolvedSandboxId);
      const nextDocument = await window.electronAPI.runtime.getConfigDocument();
      setRuntimeConfigDocument(nextDocument);
      setAuthMessage(
        "Runtime binding refreshed and local runtime config updated.",
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Failed to exchange runtime binding.",
      );
    } finally {
      setIsExchangingRuntimeBinding(false);
    }
  }

  function renderProviderModelSelection(
    providerId: KnownProviderId,
    draft: ProviderDraft,
  ): ReactNode {
    const selectedModelIds = parseModelsText(draft.modelsText);
    const catalogModelOptions = providerCatalogChatModelOptions(providerId);
    const unknownSelectedModelIds = selectedModelIds.filter(
      (modelId) =>
        !catalogModelOptions.some((option) => option.modelId === modelId),
    );

    return (
      <label className="grid gap-1">
        <span className="text-xs uppercase text-muted-foreground">Models</span>
        <div className="grid gap-2">
          {catalogModelOptions.length > 0 ? (
            <div className="grid gap-2">
              <div className="grid gap-1.5">
                {catalogModelOptions.map((option) => {
                  const selected = selectedModelIds.includes(option.modelId);
                  return (
                    <div
                      key={option.modelId}
                      className={`rounded-lg border px-2.5 py-1.5 text-left transition ${
                        selected
                          ? "border-primary bg-primary/[0.06] text-foreground"
                          : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium leading-4">
                            {option.label}
                          </div>
                          {option.label !== option.modelId ? (
                            <div className="truncate pt-0.5 text-xs leading-4 text-muted-foreground">
                              {option.modelId}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 pl-1">
                          <span className="text-xs font-medium uppercase text-muted-foreground">
                            {selected ? "On" : "Off"}
                          </span>
                          <Switch
                            checked={selected}
                            aria-label={`Toggle ${option.label}`}
                            onCheckedChange={() =>
                              toggleProviderDraftModel(
                                providerId,
                                option.modelId,
                              )
                            }
                            className="mt-0.5"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
              Add models in <code>desktop/shared/model-catalog.ts</code> to
              configure this provider.
            </div>
          )}

          {selectedModelIds.length === 0 ? (
            <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
              Select at least one configured model before saving.
            </div>
          ) : null}

          {unknownSelectedModelIds.length > 0 ? (
            <div className="grid gap-2">
              <div className="text-xs leading-5 text-muted-foreground">
                Some saved models are not in the local catalog. Add them in{" "}
                <code>desktop/shared/model-catalog.ts</code> to make them
                selectable again.
              </div>
              <div className="flex flex-wrap gap-2">
                {unknownSelectedModelIds.map((modelId) => (
                  <Badge
                    key={modelId}
                    variant="outline"
                    className="flex items-center gap-1 border-border bg-muted pr-1 text-foreground"
                  >
                    <span className="max-w-[220px] truncate">
                      {providerModelDisplayLabel(providerId, modelId)}
                    </span>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        removeProviderDraftModel(providerId, modelId)
                      }
                      aria-label={`Remove ${modelId}`}
                    >
                      <X size={12} />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </label>
    );
  }

  function renderProviderDrawerContent(providerId: KnownProviderId): ReactNode {
    if (!providerDraftEnabled(providerId)) {
      return (
        <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
          Click Connect to configure settings.
        </div>
      );
    }

    const template = KNOWN_PROVIDER_TEMPLATES[providerId];
    const draft = providerDrafts[providerId];
    if (providerId === "holaboss") {
      const supportedModels = holabossSupportedModels(effectiveRuntimeConfig);
      return (
        <div className="grid gap-2">
          <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
            Catalog, base URL, and credentials come from your Holaboss runtime
            binding.
          </div>
          {supportedModels.length > 0 ? (
            <div className="grid gap-2">
              <div className="text-xs uppercase text-muted-foreground">
                Supported models
              </div>
              <div className="grid gap-1.5">
                {supportedModels.map((option) => (
                  <div
                    key={option.modelId}
                    className="rounded-lg bg-card ring-1 ring-border px-2.5 py-1.5 text-left"
                  >
                    <div className="truncate text-sm font-medium leading-4 text-foreground">
                      {option.label}
                    </div>
                    {option.label !== option.modelId ? (
                      <div className="truncate pt-0.5 text-xs leading-4 text-muted-foreground">
                        {option.modelId}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
              No managed models are available yet. Refresh your runtime binding
              to load the latest Holaboss catalog.
            </div>
          )}
        </div>
      );
    }
    if (providerId === "openai_codex") {
      return (
        <div className="grid gap-2">
          <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
            Sign in with your ChatGPT account in the browser. holaOS keeps the
            active Codex access token refreshed locally for this desktop.
          </div>
          <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2">
            <div className="text-xs uppercase text-muted-foreground">
              Base URL
            </div>
            <div className="pt-1 font-mono text-sm text-foreground">
              {template.defaultBaseUrl}
            </div>
          </div>
          {renderProviderModelSelection(providerId, draft)}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSaveRuntimeSettings(providerId)}
              disabled={isSavingRuntimeConfigDocument}
            >
              {isSavingRuntimeConfigDocument ? "Saving..." : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCancelProviderEditing(providerId)}
              disabled={isSavingRuntimeConfigDocument}
            >
              Cancel
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="grid gap-2">
        <label className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">
            Base URL
          </span>
          <Input
            value={draft.baseUrl}
            onChange={(event) =>
              updateProviderDraft(providerId, { baseUrl: event.target.value })
            }
            placeholder={template.defaultBaseUrl}
            spellCheck={false}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">
            API Key
          </span>
          <Input
            type="password"
            value={draft.apiKey}
            onChange={(event) =>
              updateProviderDraft(providerId, { apiKey: event.target.value })
            }
            placeholder={template.apiKeyPlaceholder}
            spellCheck={false}
          />
        </label>
        {renderProviderModelSelection(providerId, draft)}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSaveRuntimeSettings(providerId)}
            disabled={isSavingRuntimeConfigDocument}
          >
            {isSavingRuntimeConfigDocument ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCancelProviderEditing(providerId)}
            disabled={isSavingRuntimeConfigDocument}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  function renderProviderRow(providerId: KnownProviderId, isLast: boolean) {
    const template = KNOWN_PROVIDER_TEMPLATES[providerId];
    const isHolabossProvider = providerId === "holaboss";
    const isCodexProvider = providerId === "openai_codex";
    const isConnected = providerConnected(providerId);
    const draftEnabled = providerDraftEnabled(providerId);
    const isConnecting = connectingProviderId === providerId;
    const isDisconnecting = disconnectingProviderId === providerId;
    const hasPendingConnection = !isConnected && draftEnabled;
    const isExpandable =
      isHolabossProvider || isCodexProvider
        ? isConnected
        : draftEnabled || isConnected;
    const isExpanded = isExpandable && expandedProviderId === providerId;

    return (
      <div key={providerId} className={isLast ? "" : "border-b border-border"}>
        <div className="flex items-center gap-3 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-foreground">
            <ProviderBrandIcon providerId={providerId} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">
              {template.label}
            </div>
          </div>

          <div className={PROVIDER_ROW_ACTIONS_CLASS_NAME}>
            {isHolabossProvider ? (
              isConnected ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                    onClick={() =>
                      setExpandedProviderId((current) =>
                        current === providerId ? null : providerId,
                      )
                    }
                    disabled={isSavingRuntimeConfigDocument}
                  >
                    {isExpanded ? "Hide" : "Show"}
                  </Button>
                  <Badge
                    variant="outline"
                    className={`border-primary bg-primary/10 text-primary ${PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}`}
                  >
                    Enabled
                  </Badge>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                  onClick={() => void handleStartSignIn()}
                  disabled={isStartingSignIn}
                >
                  {isStartingSignIn ? "Opening..." : "Sign in"}
                </Button>
              )
            ) : isCodexProvider ? (
              isConnected ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                    onClick={() =>
                      setExpandedProviderId((current) =>
                        current === providerId ? null : providerId,
                      )
                    }
                    disabled={isSavingRuntimeConfigDocument}
                  >
                    {isExpanded ? "Hide" : "Edit"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                    onClick={() =>
                      void handleDisconnectRuntimeProvider(providerId)
                    }
                    disabled={isSavingRuntimeConfigDocument || isConnecting}
                  >
                    {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                  onClick={() => void handleConnectCodexProvider(providerId)}
                  disabled={isSavingRuntimeConfigDocument || isConnecting}
                >
                  {isConnecting ? "Connecting..." : "Connect"}
                </Button>
              )
            ) : isConnected ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                  onClick={() =>
                    setExpandedProviderId((current) =>
                      current === providerId ? null : providerId,
                    )
                  }
                  disabled={isSavingRuntimeConfigDocument}
                >
                  {isExpanded ? "Hide" : "Edit"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                  onClick={() =>
                    void handleDisconnectRuntimeProvider(providerId)
                  }
                  disabled={isSavingRuntimeConfigDocument}
                >
                  {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                </Button>
              </>
            ) : hasPendingConnection ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                  onClick={() =>
                    setExpandedProviderId((current) =>
                      current === providerId ? null : providerId,
                    )
                  }
                  disabled={isSavingRuntimeConfigDocument}
                >
                  {isExpanded ? "Hide" : "Edit"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                  onClick={() => {
                    updateProviderDraft(providerId, { enabled: false });
                    setExpandedProviderId((current) =>
                      current === providerId ? null : current,
                    );
                  }}
                  disabled={isSavingRuntimeConfigDocument}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className={PROVIDER_ROW_ACTION_ITEM_CLASS_NAME}
                onClick={() => {
                  updateProviderDraft(providerId, { enabled: true });
                  setExpandedProviderId(providerId);
                }}
                disabled={isSavingRuntimeConfigDocument}
              >
                Connect
              </Button>
            )}
          </div>
        </div>

        {isExpanded && isExpandable && (
          <div className="pb-3 pl-11">
            {renderProviderDrawerContent(providerId)}
          </div>
        )}
      </div>
    );
  }

  const allProviderIds = [...connectedProviderIds, ...availableProviderIds];

  const runtimeProviderSettings = (
    <div className="grid gap-6">
      {advancedSettingsWarnings.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl bg-warning/10 px-4 py-3 ring-1 ring-warning/25">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-foreground">
              Provider model resolution needs attention
            </div>
            <div className="mt-1 grid gap-1 text-xs leading-5 text-muted-foreground">
              {advancedSettingsWarnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <section>
        <div className="text-base font-medium text-foreground">
          Model providers
        </div>
        <div className="mt-3 overflow-hidden rounded-xl bg-card ring-1 ring-border p-4">
          {allProviderIds.map((providerId, index) =>
            renderProviderRow(providerId, index === allProviderIds.length - 1),
          )}
        </div>
      </section>

      <section>
        <div className="text-base font-medium text-foreground">
          Advanced settings
        </div>
        <div className="mt-3 overflow-hidden rounded-xl bg-card ring-1 ring-border">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent"
            onClick={() =>
              setShowAdvancedRuntimeSettings((current) => !current)
            }
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                Provider routing
              </div>
              <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Pick providers for background tasks, recall embeddings, and
                image generation
              </div>
            </div>
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${showAdvancedRuntimeSettings ? "rotate-180" : ""}`}
            />
          </button>

          {showAdvancedRuntimeSettings ? (
            <>
              <div className="h-px bg-border" />
              <div className="px-4 py-4">
                <div className="grid gap-4">
                  <div className="rounded-xl bg-card ring-1 ring-border p-3">
                    <div className="text-sm font-medium text-foreground">
                      Background tasks
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Used for memory recall and evolve tasks.
                    </div>
                    <div className="mt-3 grid gap-2">
                      <label className="grid gap-1">
                        <span className="text-xs uppercase text-muted-foreground">
                          Provider
                        </span>
                        <Select
                          value={backgroundTasksDraft.providerId}
                          onValueChange={(value) =>
                            applyBackgroundTaskProviderSelection(
                              backgroundTaskProviderDraftId(value ?? ""),
                            )
                          }
                          disabled={backgroundProviderOptions.length === 0}
                        >
                          <SelectTrigger
                            className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {backgroundProviderOptions.map((providerId) => {
                              const isConnected =
                                connectedProviderIds.includes(providerId);
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
                        <span className="text-xs uppercase text-muted-foreground">
                          Model
                        </span>
                        <Select
                          value={backgroundTasksDraft.model || undefined}
                          onValueChange={(value) =>
                            updateBackgroundTasksDraft({ model: value ?? "" })
                          }
                          disabled={
                            !backgroundTasksDraft.providerId ||
                            backgroundTaskModelOptions.length === 0
                          }
                        >
                          <SelectTrigger
                            className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}
                          >
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
                      </label>

                      {backgroundTasksDraft.providerId &&
                      !backgroundProviderConnected ? (
                        <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
                          Selected provider is not connected. Background tasks
                          stay disabled until you reconnect it or choose another
                          provider.
                        </div>
                      ) : null}
                      {backgroundTasksDraft.providerId &&
                      !backgroundTasksDraft.model.trim() ? (
                        <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
                          Select a model to enable background tasks.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl bg-card ring-1 ring-border p-3">
                    <div className="text-sm font-medium text-foreground">
                      Recall embeddings
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Used to preselect memory candidates for recall.
                    </div>
                    <div className="mt-2 rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
                      Embedding indexing stays off the user input path. Until
                      embeddings have been indexed separately, recall continues
                      to use the staged path.
                    </div>
                    <div className="mt-3 grid gap-2">
                      <label className="grid gap-1">
                        <span className="text-xs uppercase text-muted-foreground">
                          Provider
                        </span>
                        <Select
                          value={recallEmbeddingsDraft.providerId}
                          onValueChange={(value) =>
                            applyRecallEmbeddingsProviderSelection(
                              recallEmbeddingsProviderDraftId(value ?? ""),
                            )
                          }
                          disabled={
                            recallEmbeddingsProviderOptions.length === 0
                          }
                        >
                          <SelectTrigger
                            className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {recallEmbeddingsProviderOptions.map(
                              (providerId) => {
                                const isConnected =
                                  connectedRecallEmbeddingProviderIds.includes(
                                    providerId,
                                  );
                                const label = isConnected
                                  ? recallEmbeddingsProviderLabel(providerId)
                                  : `${recallEmbeddingsProviderLabel(providerId)} (not connected)`;
                                return (
                                  <SelectItem
                                    key={providerId}
                                    value={providerId}
                                  >
                                    {label}
                                  </SelectItem>
                                );
                              },
                            )}
                          </SelectContent>
                        </Select>
                      </label>

                      <label className="grid gap-1">
                        <span className="text-xs uppercase text-muted-foreground">
                          Model
                        </span>
                        <Select
                          value={recallEmbeddingsDraft.model || undefined}
                          onValueChange={(value) =>
                            updateRecallEmbeddingsDraft({ model: value ?? "" })
                          }
                          disabled={
                            !recallEmbeddingsDraft.providerId ||
                            recallEmbeddingsModelOptions.length === 0
                          }
                        >
                          <SelectTrigger
                            className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}
                          >
                            <SelectValue
                              placeholder={recallEmbeddingsModelPlaceholder(
                                recallEmbeddingsDraft.providerId,
                                effectiveRuntimeConfig,
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {recallEmbeddingsModelOptions.map((modelId) => (
                              <SelectItem key={modelId} value={modelId}>
                                {modelId}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>

                      {recallEmbeddingsDraft.providerId &&
                      !recallEmbeddingsProviderConnected ? (
                        <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
                          Selected provider is not connected. Vector recall
                          stays disabled until you reconnect it or choose
                          another provider.
                        </div>
                      ) : null}
                      {recallEmbeddingsDraft.providerId &&
                      !recallEmbeddingsDraft.model.trim() ? (
                        <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
                          Select a model to enable vector recall.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl bg-card ring-1 ring-border p-3">
                    <div className="text-sm font-medium text-foreground">
                      Image generation
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Used when the agent generates new images into the
                      workspace.
                    </div>
                    <div className="mt-3 grid gap-2">
                      <label className="grid gap-1">
                        <span className="text-xs uppercase text-muted-foreground">
                          Provider
                        </span>
                        <Select
                          value={imageGenerationDraft.providerId}
                          onValueChange={(value) =>
                            applyImageGenerationProviderSelection(
                              imageGenerationProviderDraftId(value ?? ""),
                            )
                          }
                          disabled={imageGenerationProviderOptions.length === 0}
                        >
                          <SelectTrigger
                            className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {imageGenerationProviderOptions.map(
                              (providerId) => {
                                const isConnected =
                                  connectedImageProviderIds.includes(
                                    providerId,
                                  );
                                const label = isConnected
                                  ? imageGenerationProviderLabel(providerId)
                                  : `${imageGenerationProviderLabel(providerId)} (not connected)`;
                                return (
                                  <SelectItem
                                    key={providerId}
                                    value={providerId}
                                  >
                                    {label}
                                  </SelectItem>
                                );
                              },
                            )}
                          </SelectContent>
                        </Select>
                      </label>

                      <label className="grid gap-1">
                        <span className="text-xs uppercase text-muted-foreground">
                          Model
                        </span>
                        <Select
                          value={imageGenerationDraft.model || undefined}
                          onValueChange={(value) =>
                            updateImageGenerationDraft({ model: value ?? "" })
                          }
                          disabled={
                            !imageGenerationDraft.providerId ||
                            imageGenerationModelOptions.length === 0
                          }
                        >
                          <SelectTrigger
                            className={AUTH_PANEL_SELECT_TRIGGER_CLASS_NAME}
                          >
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
                      </label>

                      {imageGenerationDraft.providerId &&
                      !imageGenerationProviderConnected ? (
                        <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
                          Selected provider is not connected. Image generation
                          stays disabled until you reconnect it or choose
                          another provider.
                        </div>
                      ) : null}
                      {imageGenerationDraft.providerId &&
                      !imageGenerationDraft.model.trim() ? (
                        <div className="rounded-xl bg-card ring-1 ring-border px-3 py-2 text-sm text-muted-foreground">
                          Select a model to enable image generation.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );

  if (view === "account") {
    if (showsSetupLoadingState) {
      return (
        <section className="grid w-full gap-5">
          {setupLoadingPanel}
        </section>
      );
    }

    return (
      <section className="grid w-full gap-6">
        <section>
          <div className="text-base font-medium text-foreground">Session</div>

          <div className="mt-3 overflow-hidden rounded-xl bg-card ring-1 ring-border">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  <UserAvatar user={sessionAvatarUser(session)} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="truncate text-sm font-medium text-foreground">
                    {isSignedIn
                      ? sessionDisplayName(session) || "Your account"
                      : "Your account"}
                  </div>
                  {isSignedIn && sessionEmail(session) ? (
                    <div className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
                      {sessionEmail(session)}
                    </div>
                  ) : !isSignedIn ? (
                    <div className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
                      Not connected
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {isSignedIn ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Refresh session"
                      onClick={() => void handleRefreshSession()}
                      disabled={sessionState.isPending}
                    >
                      {sessionState.isPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Sign out"
                      onClick={() => void handleSignOut()}
                      disabled={!isSignedIn}
                    >
                      <LogOut size={14} />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => void handleStartSignIn()}
                    disabled={isStartingSignIn}
                  >
                    {isStartingSignIn ? "Opening sign-in..." : "Sign in"}
                  </Button>
                )}
              </div>
            </div>

            <div className="h-px bg-border" />

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="text-sm font-medium text-foreground">Status</div>
              <Badge
                variant="outline"
                className={
                  statusTone === "error"
                    ? "border-destructive/40 bg-destructive/10 text-[11px] text-destructive"
                    : statusTone === "ready"
                      ? "border-success/40 bg-success/10 text-[11px] text-success"
                      : statusTone === "syncing"
                        ? "border-warning/40 bg-warning/10 text-[11px] text-warning"
                        : "border-border bg-background/60 text-[11px] text-muted-foreground"
                }
              >
                <ShieldCheck size={12} />
                <span>{statusBadgeLabel}</span>
              </Badge>
            </div>

            <div className="h-px bg-border" />

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="text-sm font-medium text-foreground">Runtime</div>
              <Badge
                variant="outline"
                className="border-border bg-background/60 text-[11px] text-muted-foreground"
              >
                <span
                  className={`inline-block size-1.5 rounded-full ${runtimeBindingReady ? "bg-success" : isSignedIn ? "bg-warning" : "bg-muted-foreground"}`}
                />
                <span>
                  {runtimeBindingReady
                    ? "Ready on this desktop"
                    : isSignedIn
                      ? "Setup in progress"
                      : "Unavailable"}
                </span>
              </Badge>
            </div>

            {(authMessage || authError) && (
              <>
                <div className="h-px bg-border" />
                <div className="flex items-start gap-2 px-4 py-3 text-xs leading-5">
                  {authError ? (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                  )}
                  <div
                    className={`min-w-0 flex-1 ${authError ? "text-destructive" : "text-foreground"}`}
                  >
                    {authError || authMessage}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

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
        {showsSetupLoadingState ? setupLoadingPanel : runtimeProviderSettings}
        {!showsSetupLoadingState && (authMessage || authError) && (
          <div
            className={`mt-3 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ring-1 ${
              authError
                ? "bg-destructive/10 ring-destructive/25"
                : "bg-success/10 ring-success/25"
            }`}
          >
            {authError ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            )}
            <div
              className={`min-w-0 flex-1 leading-5 ${authError ? "text-destructive" : "text-foreground"}`}
            >
              {authError || authMessage}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (showsSetupLoadingState) {
    return (
      <section className="theme-shell w-full max-w-none overflow-hidden rounded-[24px] border border-border text-sm text-foreground shadow-card">
        <div className="px-4 py-5">{setupLoadingPanel}</div>
      </section>
    );
  }

  return (
    <section className="theme-shell w-full max-w-none overflow-hidden rounded-[24px] border border-border text-sm text-foreground shadow-card">
      {showAccountSection && (
        <>
          <div className="border-b border-panel-border/40 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-primary bg-primary/10 text-lg font-semibold text-primary">
                  {sessionInitials(session)}
                </div>
                <div className="min-w-0">
                  <div className="text-base font-medium text-foreground">
                    {isSignedIn
                      ? sessionDisplayName(session) || "Your account"
                      : "Your account"}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted-foreground">
                    {isSignedIn
                      ? sessionEmail(session) || "Signed in"
                      : "Not connected"}
                  </div>
                </div>
              </div>
              <div
                className={`shrink-0 rounded-full border px-3 py-1 text-xs ${badgeClassName}`}
              >
                {statusBadgeLabel}
              </div>
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
                  <div className="max-w-[58%] truncate text-right text-sm text-muted-foreground">
                    {row.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {!isSignedIn && (
                <Button
                  onClick={() => void handleStartSignIn()}
                  disabled={isStartingSignIn}
                >
                  {isStartingSignIn
                    ? "Opening sign-in..."
                    : "Sign in with browser"}
                </Button>
              )}

              <Button
                variant="outline"
                onClick={() => void handleRefreshSession()}
                disabled={sessionState.isPending}
              >
                Refresh session
              </Button>

              <Button
                variant="destructive"
                onClick={() => void handleSignOut()}
                disabled={!isSignedIn}
              >
                Sign out
              </Button>
            </div>

            {(authMessage || authError) && (
              <div
                className={`mt-3 rounded-[16px] border px-4 py-3 text-sm ${
                  authError
                    ? "border-destructive/35 bg-destructive/8 text-destructive"
                    : "border-success/30 bg-success/10 text-success"
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
                  ? "border-destructive/35 bg-destructive/8 text-destructive"
                  : "border-success/30 bg-success/10 text-success"
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
