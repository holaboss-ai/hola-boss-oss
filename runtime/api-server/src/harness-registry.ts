import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  DEFAULT_HARNESS_ID,
  DESKTOP_BROWSER_TOOL_IDS,
  HARNESS_DEFINITIONS,
  RUNTIME_AGENT_TOOL_IDS,
  type HarnessBackendRestartRequest,
  type HarnessBootstrapPayload,
  type HarnessEnsureReadyContext,
  type HarnessHostRequestBuildParams,
  type HarnessModelConfigSyncRequest,
  type HarnessModelConfigSyncResult,
  type HarnessPrepareRunParams,
  type HarnessRuntimeConfigPayload,
  type HarnessRuntimeConfigUpdateContext,
  type HarnessRuntimeStatus,
  type HarnessRuntimeStatusContext,
  type HarnessToolRefPayload,
  type HarnessRunnerRequestLike,
  type RuntimeHarnessAdapter,
} from "../../harnesses/src/index.js";
import { stageOpencodeDesktopBrowserPlugin } from "./opencode-browser-tools.js";
import { stageWorkspaceCommands } from "./opencode-commands.js";
import { opencodeProxyConfigPath, updateOpencodeConfig } from "./opencode-config.js";
import { stageOpencodeRuntimeToolsPlugin } from "./opencode-runtime-tools.js";
import { readOpencodeSidecarBaseUrl, restartOpencodeSidecar } from "./opencode-sidecar.js";
import { stageOpencodeSkills } from "./opencode-skills.js";
import { buildRunnerEnv, resolveOpencodeExecutable } from "./runner-worker.js";

const HB_SANDBOX_ROOT_ENV = "HB_SANDBOX_ROOT";
const OPENCODE_BASE_URL_ENV = "OPENCODE_BASE_URL";
const OPENCODE_SERVER_HOST_ENV = "OPENCODE_SERVER_HOST";
const OPENCODE_SERVER_PORT_ENV = "OPENCODE_SERVER_PORT";
const OPENCODE_READY_TIMEOUT_S_ENV = "OPENCODE_READY_TIMEOUT_S";
const HOLABOSS_HARNESS_RUN_TIMEOUT_S_ENV = "HOLABOSS_HARNESS_RUN_TIMEOUT_S";
const OPENCODE_RUN_TIMEOUT_S_ENV = "OPENCODE_RUN_TIMEOUT_S";

const DEFAULT_OPENCODE_HOST = "127.0.0.1";
const DEFAULT_OPENCODE_PORT = 4096;
const DEFAULT_OPENCODE_READY_TIMEOUT_S = 30;
const DEFAULT_RUN_TIMEOUT_S = 1800;

export {
  DEFAULT_HARNESS_ID,
  type HarnessBackendRestartRequest,
  type HarnessBootstrapPayload,
  type HarnessEnsureReadyContext,
  type HarnessHostRequestBuildParams,
  type HarnessModelConfigSyncRequest,
  type HarnessModelConfigSyncResult,
  type HarnessPrepareRunParams,
  type HarnessRuntimeConfigPayload,
  type HarnessRuntimeConfigUpdateContext,
  type HarnessRuntimeStatus,
  type HarnessRuntimeStatusContext,
  type HarnessToolRefPayload,
  type HarnessRunnerRequestLike,
  type RuntimeHarnessAdapter,
};

export interface RuntimeHarnessBrowserConfig {
  desktopBrowserEnabled: boolean;
  desktopBrowserUrl: string;
  desktopBrowserAuthToken: string;
}

export interface RuntimeHarnessProductConfig {
  authToken: string;
  sandboxId: string;
  modelProxyBaseUrl: string;
  defaultModel: string;
}

export interface RuntimeHarnessPrepareRunContext {
  request: HarnessRunnerRequestLike;
  bootstrap: HarnessBootstrapPayload;
  runtimeConfig: HarnessRuntimeConfigPayload;
  stagedSkillsChanged: boolean;
}

export interface RuntimeHarnessPluginStatus {
  backendConfigPresent: boolean;
  harnessStatus: HarnessRuntimeStatus;
}

export interface RuntimeHarnessPlugin {
  id: string;
  adapter: RuntimeHarnessAdapter;
  stageBrowserTools: (params: {
    workspaceDir: string;
    sessionKind?: string | null;
    browserConfig: RuntimeHarnessBrowserConfig;
  }) => { changed: boolean; toolIds: string[] };
  stageRuntimeTools: (params: { workspaceDir: string }) => { changed: boolean; toolIds: string[] };
  stageCommands: (params: { workspaceDir: string }) => { changed: boolean };
  stageSkills: (params: { workspaceDir: string; runtimeRoot: string }) => {
    changed: boolean;
    skillIds: string[];
  };
  prepareRun: (params: RuntimeHarnessPrepareRunContext) => Promise<void>;
  describeRuntimeStatus: (params: {
    configLoaded: boolean;
    probeBackendReadiness: (target: string) => Promise<boolean>;
  }) => Promise<RuntimeHarnessPluginStatus>;
  handleRuntimeConfigUpdated: (params: {
    productConfig: RuntimeHarnessProductConfig;
    ensureSelectedHarnessReady: () => Promise<void>;
  }) => Promise<void>;
  ensureReady: (fetchImpl: typeof fetch) => Promise<void>;
  backendBaseUrl: (params: { workspaceId: string; workspaceDir: string }) => string;
  timeoutSeconds: () => number;
}

function normalizeHarnessIdInternal(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || DEFAULT_HARNESS_ID;
}

function firstEnvValue(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] ?? "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function sandboxRootPath(): string {
  return firstEnvValue(HB_SANDBOX_ROOT_ENV) || "/holaboss";
}

function workspaceRootPath(): string {
  return path.join(sandboxRootPath(), "workspace");
}

function opencodeWorkspaceRoot(workspaceDir: string): string {
  return path.resolve(workspaceDir);
}

function opencodeServerHost(): string {
  return firstEnvValue(OPENCODE_SERVER_HOST_ENV) || DEFAULT_OPENCODE_HOST;
}

function opencodeServerPort(): number {
  const raw = firstEnvValue(OPENCODE_SERVER_PORT_ENV) || String(DEFAULT_OPENCODE_PORT);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_OPENCODE_PORT;
  }
  return Math.min(Math.max(parsed, 1), 65535);
}

function opencodeBaseUrl(): string {
  const configured = firstEnvValue(OPENCODE_BASE_URL_ENV).replace(/\/+$/, "");
  if (configured) {
    return configured;
  }
  return `http://${opencodeServerHost()}:${opencodeServerPort()}`;
}

function opencodeBaseUrlForWorkspace(workspaceDir: string): string {
  const configured = firstEnvValue(OPENCODE_BASE_URL_ENV).replace(/\/+$/, "");
  if (configured) {
    return configured;
  }
  const persisted = readOpencodeSidecarBaseUrl(opencodeWorkspaceRoot(workspaceDir));
  if (persisted) {
    return persisted;
  }
  const explicitPort = firstEnvValue(OPENCODE_SERVER_PORT_ENV);
  if (explicitPort) {
    return `http://${opencodeServerHost()}:${opencodeServerPort()}`;
  }
  return "";
}

function opencodeReadyTimeoutSeconds(): number {
  const raw = firstEnvValue(OPENCODE_READY_TIMEOUT_S_ENV) || String(DEFAULT_OPENCODE_READY_TIMEOUT_S);
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_OPENCODE_READY_TIMEOUT_S;
  }
  return Math.max(parsed, 1);
}

function defaultHarnessTimeoutSeconds(): number {
  const raw = firstEnvValue(HOLABOSS_HARNESS_RUN_TIMEOUT_S_ENV, OPENCODE_RUN_TIMEOUT_S_ENV) || String(DEFAULT_RUN_TIMEOUT_S);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RUN_TIMEOUT_S;
  }
  return Math.max(1, Math.min(parsed, 7200));
}

function browserToolsAllowedForSession(sessionKind: string | null | undefined): boolean {
  return typeof sessionKind === "string" && sessionKind.trim().toLowerCase() === "main";
}

function opencodeSidecarFingerprint(runtimeConfig: HarnessRuntimeConfigPayload, workspaceId: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        workspace_id: workspaceId,
        provider_id: runtimeConfig.provider_id,
        model_id: runtimeConfig.model_id,
        mode: runtimeConfig.mode,
        workspace_skill_ids: runtimeConfig.workspace_skill_ids
      }),
      "utf8"
    )
    .digest("hex");
}

function opencodeBootstrapPayload(config: RuntimeHarnessProductConfig): Record<string, unknown> {
  const modelProxyHeaders: Record<string, string> = {};
  if (config.authToken) {
    modelProxyHeaders["X-API-Key"] = config.authToken;
  }
  if (config.sandboxId) {
    modelProxyHeaders["X-Holaboss-Sandbox-Id"] = config.sandboxId;
  }
  return {
    $schema: "https://opencode.ai/config.json",
    provider: {
      openai: {
        npm: "@ai-sdk/openai",
        name: "Holaboss Model Proxy (OpenAI)",
        options: {
          apiKey: config.authToken,
          baseURL: `${config.modelProxyBaseUrl}/openai/v1`,
          headers: modelProxyHeaders
        }
      },
      anthropic: {
        npm: "@ai-sdk/anthropic",
        name: "Holaboss Model Proxy (Anthropic)",
        options: {
          apiKey: config.authToken,
          baseURL: `${config.modelProxyBaseUrl}/anthropic/v1`,
          headers: modelProxyHeaders
        }
      }
    },
    model: config.defaultModel
  };
}

function writeOpencodeBootstrapConfigIfAvailable(config: RuntimeHarnessProductConfig): void {
  if (!config.authToken || !config.modelProxyBaseUrl) {
    return;
  }
  const configPath = opencodeProxyConfigPath(workspaceRootPath());
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(opencodeBootstrapPayload(config), null, 2)}\n`, "utf8");
}

async function backendIsReady(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(2000)
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function ensureOpencodeBackendReady(fetchImpl: typeof fetch): Promise<void> {
  const readinessUrl = `${opencodeBaseUrl()}/mcp`;
  if (await backendIsReady(readinessUrl, fetchImpl)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(
      resolveOpencodeExecutable(),
      ["serve", "--hostname", opencodeServerHost(), "--port", String(opencodeServerPort())],
      {
        cwd: workspaceRootPath(),
        env: buildRunnerEnv(),
        stdio: "ignore",
        detached: true
      }
    );
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
    const handle = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.unref();
      resolve();
    }, 100);
    handle.unref();
  });

  const deadline = Date.now() + opencodeReadyTimeoutSeconds() * 1000;
  while (Date.now() < deadline) {
    if (await backendIsReady(readinessUrl, fetchImpl)) {
      return;
    }
    await sleep(200);
  }
  throw new Error("OpenCode sidecar did not become ready");
}

const adapterById = new Map(HARNESS_DEFINITIONS.map((definition) => [definition.id, definition.runtimeAdapter]));

function requireBaseAdapter(harnessId: string): RuntimeHarnessAdapter {
  const adapter = adapterById.get(harnessId);
  if (!adapter) {
    throw new Error(`unsupported harness: ${harnessId}`);
  }
  return adapter;
}

const opencodeAdapter = requireBaseAdapter("opencode");
const piAdapter = requireBaseAdapter("pi");

const opencodeRuntimeHarnessPlugin: RuntimeHarnessPlugin = {
  id: "opencode",
  adapter: opencodeAdapter,
  stageBrowserTools(params) {
    const result = stageOpencodeDesktopBrowserPlugin(
      { workspace_dir: params.workspaceDir },
      {
        resolveConfig: () => params.browserConfig
      }
    );
    return {
      changed: result.changed,
      toolIds: browserToolsAllowedForSession(params.sessionKind) ? result.tool_ids : []
    };
  },
  stageRuntimeTools(params) {
    const result = stageOpencodeRuntimeToolsPlugin({
      workspace_dir: params.workspaceDir
    });
    return {
      changed: result.changed,
      toolIds: result.tool_ids
    };
  },
  stageCommands(params) {
    return stageWorkspaceCommands({
      workspace_dir: params.workspaceDir
    });
  },
  stageSkills(params) {
    const result = stageOpencodeSkills({
      workspace_dir: params.workspaceDir,
      runtime_root: params.runtimeRoot
    });
    return {
      changed: result.changed,
      skillIds: result.skill_ids
    };
  },
  async prepareRun(params) {
    const backendBaseUrl = opencodeBaseUrlForWorkspace(params.bootstrap.workspaceDir);
    await opencodeAdapter.prepareRun?.({
      ...params,
      syncModelConfig: (request) => {
        const result = updateOpencodeConfig(request);
        return {
          path: result.path,
          backend_config_changed: result.provider_config_changed,
          model_selection_changed: result.model_selection_changed
        };
      },
      restartBackend: async (request) => {
        await restartOpencodeSidecar({
          workspace_root: request.workspace_root,
          workspace_id: request.workspace_id,
          config_fingerprint: request.backend_fingerprint,
          allow_reuse_existing: request.allow_reuse_existing,
          host: request.host,
          port: request.port,
          ready_timeout_s: request.ready_timeout_s
        });
      },
      backendBaseUrl,
      backendHost: opencodeServerHost(),
      backendPort: firstEnvValue(OPENCODE_SERVER_PORT_ENV) ? opencodeServerPort() : 0,
      backendReadyTimeoutSeconds: opencodeReadyTimeoutSeconds(),
      buildBackendFingerprint: opencodeSidecarFingerprint
    });
  },
  async describeRuntimeStatus(params) {
    const backendConfigPresent = fs.existsSync(opencodeProxyConfigPath(workspaceRootPath()));
    const harnessStatus = await opencodeAdapter.describeRuntimeStatus({
      configLoaded: params.configLoaded,
      backendConfigPresent,
      backendReadinessTarget: `${opencodeBaseUrl()}/mcp`,
      probeBackendReadiness: params.probeBackendReadiness
    });
    return {
      backendConfigPresent,
      harnessStatus
    };
  },
  async handleRuntimeConfigUpdated(params) {
    await opencodeAdapter.handleRuntimeConfigUpdated?.({
      writeBootstrapConfigIfAvailable: () => writeOpencodeBootstrapConfigIfAvailable(params.productConfig),
      ensureSelectedHarnessReady: params.ensureSelectedHarnessReady
    });
  },
  async ensureReady(fetchImpl) {
    await opencodeAdapter.ensureReady?.({
      ensureHarnessBackendReady: () => ensureOpencodeBackendReady(fetchImpl)
    });
  },
  backendBaseUrl(params) {
    return opencodeBaseUrlForWorkspace(params.workspaceDir);
  },
  timeoutSeconds() {
    return defaultHarnessTimeoutSeconds();
  }
};

const piRuntimeHarnessPlugin: RuntimeHarnessPlugin = {
  id: "pi",
  adapter: piAdapter,
  stageBrowserTools(params) {
    const browserEnabled = Boolean(
      browserToolsAllowedForSession(params.sessionKind) &&
      params.browserConfig.desktopBrowserEnabled &&
        params.browserConfig.desktopBrowserUrl.trim() &&
        params.browserConfig.desktopBrowserAuthToken.trim()
    );
    return { changed: false, toolIds: browserEnabled ? [...DESKTOP_BROWSER_TOOL_IDS] : [] };
  },
  stageRuntimeTools() {
    return { changed: false, toolIds: [...RUNTIME_AGENT_TOOL_IDS] };
  },
  stageCommands() {
    return { changed: false };
  },
  stageSkills() {
    return { changed: false, skillIds: [] };
  },
  async prepareRun(params) {
    await piAdapter.prepareRun?.({
      ...params,
      syncModelConfig: () => ({
        path: "",
        backend_config_changed: false,
        model_selection_changed: false
      }),
      restartBackend: async () => {},
      backendBaseUrl: "",
      backendHost: "",
      backendPort: 0,
      backendReadyTimeoutSeconds: 0,
      buildBackendFingerprint: () => ""
    });
  },
  async describeRuntimeStatus(params) {
    const harnessStatus = await piAdapter.describeRuntimeStatus({
      configLoaded: params.configLoaded,
      backendConfigPresent: false,
      backendReadinessTarget: null,
      probeBackendReadiness: params.probeBackendReadiness
    });
    return {
      backendConfigPresent: false,
      harnessStatus
    };
  },
  async handleRuntimeConfigUpdated(params) {
    await piAdapter.handleRuntimeConfigUpdated?.({
      writeBootstrapConfigIfAvailable: () => {
        void params.productConfig;
      },
      ensureSelectedHarnessReady: params.ensureSelectedHarnessReady
    });
  },
  async ensureReady(fetchImpl) {
    await piAdapter.ensureReady?.({
      ensureHarnessBackendReady: async () => {
        void fetchImpl;
      }
    });
  },
  backendBaseUrl(_params) {
    return "";
  },
  timeoutSeconds() {
    return defaultHarnessTimeoutSeconds();
  }
};

const HARNESS_PLUGINS = [opencodeRuntimeHarnessPlugin, piRuntimeHarnessPlugin] as const;
const HARNESS_ADAPTERS = HARNESS_PLUGINS.map((plugin) => plugin.adapter);

export function normalizeHarnessId(value: unknown): string {
  return normalizeHarnessIdInternal(value);
}

export function listRuntimeHarnessAdapters(): readonly RuntimeHarnessAdapter[] {
  return HARNESS_ADAPTERS;
}

export function listRuntimeHarnessPlugins(): readonly RuntimeHarnessPlugin[] {
  return HARNESS_PLUGINS;
}

export function resolveRuntimeHarnessAdapter(harnessId: unknown): RuntimeHarnessAdapter | null {
  return resolveRuntimeHarnessPlugin(harnessId)?.adapter ?? null;
}

export function resolveRuntimeHarnessPlugin(harnessId: unknown): RuntimeHarnessPlugin | null {
  const normalized = normalizeHarnessIdInternal(harnessId);
  return HARNESS_PLUGINS.find((plugin) => plugin.id === normalized) ?? null;
}

export function requireRuntimeHarnessAdapter(harnessId: unknown): RuntimeHarnessAdapter {
  const adapter = resolveRuntimeHarnessAdapter(harnessId);
  if (!adapter) {
    throw new Error(`unsupported harness: ${normalizeHarnessIdInternal(harnessId)}`);
  }
  return adapter;
}

export function requireRuntimeHarnessPlugin(harnessId: unknown): RuntimeHarnessPlugin {
  const plugin = resolveRuntimeHarnessPlugin(harnessId);
  if (!plugin) {
    throw new Error(`unsupported harness: ${normalizeHarnessIdInternal(harnessId)}`);
  }
  return plugin;
}
