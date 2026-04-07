import { useEffect, useRef, useState, type ReactNode } from "react";
import anthropicLogo from "@/assets/providers/anthropic.svg";
import geminiLogo from "@/assets/providers/gemini.svg";
import minimaxLogo from "@/assets/providers/minimax.svg";
import ollamaLogo from "@/assets/providers/ollama.svg";
import openaiLogo from "@/assets/providers/openai.svg";
import openrouterLogo from "@/assets/providers/openrouter.svg";
import {
  useDesktopAuthSession,
  type AuthSession
} from "@/lib/auth/authClient";
import { holabossLogoUrl } from "@/lib/assetPaths";

type AuthPanelView = "full" | "account" | "runtime";

interface AuthPanelProps {
  view?: AuthPanelView;
}

const KNOWN_PROVIDER_ORDER = ["holaboss", "openai_direct", "anthropic_direct", "openrouter_direct", "gemini_direct", "ollama_direct", "minimax_direct"] as const;
type KnownProviderId = (typeof KNOWN_PROVIDER_ORDER)[number];
const PROVIDER_AUTOSAVE_DELAY_MS = 800;
const LEGACY_DIRECT_PROVIDER_MODEL_ALIASES: Record<string, Record<string, string>> = {
  anthropic_direct: {
    "claude-sonnet-4-5": "claude-sonnet-4-6"
  },
  gemini_direct: {
    "gemini-3.1-pro-preview": "gemini-2.5-pro",
    "gemini-3.1-flash-lite-preview": "gemini-2.5-flash-lite"
  }
};

interface KnownProviderTemplate {
  id: KnownProviderId;
  label: string;
  description: string;
  kind: string;
  defaultBaseUrl: string;
  defaultModels: string[];
  apiKeyPlaceholder: string;
}

interface ProviderDraft {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  modelsText: string;
}

type ProviderDraftMap = Record<KnownProviderId, ProviderDraft>;

const KNOWN_PROVIDER_TEMPLATES: Record<KnownProviderId, KnownProviderTemplate> = {
  holaboss: {
    id: "holaboss",
    label: "Holaboss Proxy",
    description: "Managed by your Holaboss account session and runtime binding.",
    kind: "holaboss_proxy",
    defaultBaseUrl: "",
    defaultModels: ["gpt-5.2", "gpt-5-mini", "gpt-4.1-mini"],
    apiKeyPlaceholder: "hbrt.v1.your-proxy-token"
  },
  openai_direct: {
    id: "openai_direct",
    label: "OpenAI",
    description: "Direct OpenAI-compatible endpoint with your own API key.",
    kind: "openai_compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModels: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"],
    apiKeyPlaceholder: "sk-your-openai-key"
  },
  anthropic_direct: {
    id: "anthropic_direct",
    label: "Anthropic",
    description: "Direct Anthropic native endpoint with your own API key.",
    kind: "anthropic_native",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModels: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
    apiKeyPlaceholder: "sk-ant-your-anthropic-key"
  },
  openrouter_direct: {
    id: "openrouter_direct",
    label: "OpenRouter",
    description: "OpenRouter endpoint for provider-aggregated model access.",
    kind: "openrouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModels: ["openai/gpt-5.4", "anthropic/claude-sonnet-4-5", "deepseek/deepseek-chat-v3-0324"],
    apiKeyPlaceholder: "sk-or-your-openrouter-key"
  },
  gemini_direct: {
    id: "gemini_direct",
    label: "Gemini",
    description: "Google Gemini OpenAI-compatible endpoint with your own API key.",
    kind: "openai_compatible",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    apiKeyPlaceholder: "AIza...your-gemini-api-key"
  },
  ollama_direct: {
    id: "ollama_direct",
    label: "Ollama",
    description: "Local Ollama OpenAI-compatible endpoint.",
    kind: "openai_compatible",
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModels: ["llama3.1:8b", "qwen3:8b", "gpt-oss:20b"],
    apiKeyPlaceholder: "Optional. Use 'ollama' for strict OpenAI SDK compatibility."
  },
  minimax_direct: {
    id: "minimax_direct",
    label: "MiniMax",
    description: "MiniMax OpenAI-compatible endpoint with your own API key.",
    kind: "openai_compatible",
    defaultBaseUrl: "https://api.minimax.io/v1",
    defaultModels: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
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
      modelsText: KNOWN_PROVIDER_TEMPLATES.holaboss.defaultModels.join(", ")
    },
    openai_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.openai_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.openai_direct.defaultModels.join(", ")
    },
    anthropic_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.anthropic_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.anthropic_direct.defaultModels.join(", ")
    },
    openrouter_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.openrouter_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.openrouter_direct.defaultModels.join(", ")
    },
    gemini_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.gemini_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.gemini_direct.defaultModels.join(", ")
    },
    ollama_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.ollama_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.ollama_direct.defaultModels.join(", ")
    },
    minimax_direct: {
      enabled: false,
      baseUrl: KNOWN_PROVIDER_TEMPLATES.minimax_direct.defaultBaseUrl,
      apiKey: "",
      modelsText: KNOWN_PROVIDER_TEMPLATES.minimax_direct.defaultModels.join(", ")
    }
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

function enabledProviderIdsForDrafts(providerDrafts: ProviderDraftMap, isSignedIn: boolean): KnownProviderId[] {
  return KNOWN_PROVIDER_ORDER.filter((providerId) =>
    providerId === "holaboss" ? isSignedIn : providerDrafts[providerId].enabled
  );
}

function providerBrandIconAsset(providerId: KnownProviderId): string | null {
  if (providerId === "openai_direct") {
    return openaiLogo;
  }
  if (providerId === "anthropic_direct") {
    return anthropicLogo;
  }
  if (providerId === "openrouter_direct") {
    return openrouterLogo;
  }
  if (providerId === "gemini_direct") {
    return geminiLogo;
  }
  if (providerId === "ollama_direct") {
    return ollamaLogo;
  }
  if (providerId === "minimax_direct") {
    return minimaxLogo;
  }
  return null;
}

function ProviderBrandIcon({ providerId }: { providerId: KnownProviderId }) {
  if (providerId === "holaboss") {
    return <img src={holabossLogoUrl} alt="" className="h-4 w-4 object-contain" aria-hidden="true" />;
  }
  const assetUrl = providerBrandIconAsset(providerId);
  if (assetUrl) {
    return (
      <span
        aria-hidden="true"
        className="block h-4 w-4 bg-foreground/92"
        style={{
          WebkitMaskImage: `url(${assetUrl})`,
          maskImage: `url(${assetUrl})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
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
} {
  const runtimePayload = asRecord(document.runtime);
  const providersPayload = asRecord(document.providers);
  const modelsPayload = asRecord(document.models);
  const integrationsPayload = asRecord(document.integrations);
  const holabossIntegration = asRecord(integrationsPayload.holaboss);
  const drafts = createDefaultProviderDrafts();

  for (const providerId of KNOWN_PROVIDER_ORDER) {
    const template = KNOWN_PROVIDER_TEMPLATES[providerId];
    const providerPayload = asRecord(providersPayload[providerId]);
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
    const normalizedModelIds = uniqueValues(modelIds);
    const fallbackDefaultModel = firstNonEmptyString(runtimePayload.default_model as string | undefined, runtimeConfig?.defaultModel ?? "");
    const fallbackProviderPrefix = `${providerId}/`;
    if (normalizedModelIds.length === 0 && fallbackDefaultModel.startsWith(fallbackProviderPrefix)) {
      normalizedModelIds.push(fallbackDefaultModel.slice(fallbackProviderPrefix.length).trim());
    }
    drafts[providerId] = {
      enabled:
        Object.keys(providerPayload).length > 0 ||
        (providerId === "holaboss" && Boolean((runtimeConfig?.modelProxyBaseUrl || "").trim())),
      baseUrl,
      apiKey,
      modelsText: (normalizedModelIds.length > 0 ? normalizedModelIds : template.defaultModels).join(", ")
    };
  }

  return {
    drafts,
    sandboxId: firstNonEmptyString(runtimePayload.sandbox_id as string | undefined, runtimeConfig?.sandboxId ?? "")
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
  const session = sessionState.data;
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigPayload | null>(null);
  const [runtimeConfigDocument, setRuntimeConfigDocument] = useState("");
  const [providerDrafts, setProviderDrafts] = useState<ProviderDraftMap>(() => createDefaultProviderDrafts());
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
    const derived = deriveProviderDraftsFromDocument(parseRuntimeConfigDocument(runtimeConfigDocument), runtimeConfig);
    setSandboxId(derived.sandboxId || `desktop:${crypto.randomUUID()}`);
    if (isProviderDraftDirty) {
      return;
    }
    setProviderDrafts(derived.drafts);
    setFailedAutosaveRevision(null);
  }, [runtimeConfig, runtimeConfigDocument, isProviderDraftDirty]);

  const isSignedIn = Boolean(sessionUserId(session));
  const providerEnabled = (providerId: KnownProviderId) =>
    providerId === "holaboss" ? isSignedIn : providerDrafts[providerId].enabled;
  const connectedProviderIds = KNOWN_PROVIDER_ORDER.filter((providerId) => providerEnabled(providerId));
  const availableProviderIds = KNOWN_PROVIDER_ORDER.filter((providerId) => !providerEnabled(providerId));

  const showAccountSection = view !== "runtime";
  const showRuntimeSection = view !== "account";
  const runtimeOnlyView = !showAccountSection && showRuntimeSection;
  const runtimeBindingReady =
    Boolean(runtimeConfig?.authTokenPresent) &&
    Boolean((runtimeConfig?.sandboxId || "").trim()) &&
    Boolean((runtimeConfig?.modelProxyBaseUrl || "").trim());
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

  function updateProviderDraft(providerId: KnownProviderId, update: Partial<ProviderDraft>) {
    setProviderDrafts((current) => ({
      ...current,
      [providerId]: {
        ...current[providerId],
        ...update
      }
    }));
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

  async function persistRuntimeProviderSettings(draftsSnapshot: ProviderDraftMap, draftRevision: number, source: "autosave" | "manual") {
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
      const currentIntegrations = asRecord(currentDocument.integrations);
      const currentHolabossIntegration = asRecord(currentIntegrations.holaboss);

      const nextProviders: Record<string, unknown> = {};
      for (const [providerId, providerPayload] of Object.entries(currentProviders)) {
        if (!isKnownProviderId(providerId.trim())) {
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
        const existingProviderPayload = asRecord(currentProviders[providerId]);
        const existingProviderOptions = asRecord(existingProviderPayload.options);
        const providerPayload: Record<string, unknown> = {
          kind: providerTemplate.kind
        };
        const normalizedBaseUrl = firstNonEmptyString(
          providerId === "holaboss" ? (existingProviderPayload.base_url as string | undefined) : "",
          providerId === "holaboss" ? (existingProviderPayload.baseURL as string | undefined) : "",
          providerId === "holaboss" ? (existingProviderOptions.base_url as string | undefined) : "",
          providerId === "holaboss" ? (existingProviderOptions.baseURL as string | undefined) : "",
          providerId === "holaboss" ? (runtimeConfig?.modelProxyBaseUrl ?? "") : "",
          providerDraft.baseUrl
        );
        const normalizedApiKey = firstNonEmptyString(
          providerId === "holaboss" ? (existingProviderPayload.api_key as string | undefined) : "",
          providerId === "holaboss" ? (existingProviderPayload.auth_token as string | undefined) : "",
          providerId === "holaboss" ? (existingProviderOptions.api_key as string | undefined) : "",
          providerId === "holaboss" ? (existingProviderOptions.apiKey as string | undefined) : "",
          providerId === "holaboss" ? (currentHolabossIntegration.auth_token as string | undefined) : "",
          providerDraft.apiKey
        );
        if (normalizedBaseUrl) {
          providerPayload.base_url = normalizedBaseUrl;
        }
        if (normalizedApiKey) {
          providerPayload.api_key = normalizedApiKey;
        }
        nextProviders[providerId] = providerPayload;

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

      const resolvedSandboxId =
        sandboxId.trim() ||
        firstNonEmptyString(
          currentRuntime.sandbox_id as string | undefined,
          runtimeConfig?.sandboxId ?? "",
          `desktop:${crypto.randomUUID()}`
        );
      const nextDocument = {
        ...currentDocument,
        runtime: {
          ...currentRuntime,
          sandbox_id: resolvedSandboxId
        },
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
      void persistRuntimeProviderSettings(providerDrafts, providerDraftRevision, "autosave");
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
    if (providerId === "holaboss") {
      return null;
    }

    if (!providerEnabled(providerId)) {
      return (
        <div className="rounded-[12px] border border-border/40 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Connect to edit settings.
        </div>
      );
    }

    const template = KNOWN_PROVIDER_TEMPLATES[providerId];
    const draft = providerDrafts[providerId];
    return (
      <div className="grid gap-2">
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Base URL</span>
          <input
            className="theme-control-surface h-9 rounded-[10px] border border-border/45 px-2.5 text-sm text-foreground outline-none transition focus:border-primary/55"
            value={draft.baseUrl}
            onChange={(event) => updateProviderDraft(providerId, { baseUrl: event.target.value })}
            placeholder={template.defaultBaseUrl}
            spellCheck={false}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">API Key</span>
          <input
            className="theme-control-surface h-9 rounded-[10px] border border-border/45 px-2.5 text-sm text-foreground outline-none transition focus:border-primary/55"
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
            className="theme-control-surface min-h-[60px] rounded-[10px] border border-border/45 px-2.5 py-2 text-sm leading-5 text-foreground outline-none transition focus:border-primary/55"
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
    const isExpandable = !isHolabossProvider;
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
      "inline-flex h-9 min-w-[96px] shrink-0 items-center justify-center rounded-[10px] px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50";

    return (
      <div
        key={providerId}
        className={`theme-control-surface overflow-hidden rounded-[14px] border transition ${
          isExpanded
            ? "border-primary/35 bg-card/96 shadow-[0_0_0_1px_rgb(var(--color-primary)/0.08)]"
            : "border-border/55 bg-card/92 hover:border-border/75"
        }`}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-4">
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

          <div className="flex shrink-0 items-center gap-2">
            {isHolabossProvider ? (
              isEnabled ? (
                <div className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.14em] text-primary">
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
                  updateProviderDraft(providerId, { enabled: true });
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
      <div className="rounded-[18px] border border-border/40 bg-card/80 px-4 py-3 text-sm text-muted-foreground">
        Manage which providers this desktop runtime can use.
      </div>

      <div className="rounded-[18px] border border-border/40 bg-card/80 p-4">
        <div className="text-sm font-medium text-foreground">Connected providers</div>
        <div className="mt-3 grid gap-2">
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
