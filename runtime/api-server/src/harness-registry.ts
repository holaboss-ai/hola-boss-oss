import {
  DEFAULT_HARNESS_ID,
  HARNESS_DEFINITIONS,
  type HarnessBackendRestartRequest,
  type HarnessBootstrapPayload,
  type HarnessEnsureReadyContext,
  type HarnessHostRequestBuildParams,
  type HarnessModelConfigSyncRequest,
  type HarnessModelConfigSyncResult,
  type HarnessPrepareRunParams,
  type HarnessRuntimeConfigUpdateContext,
  type HarnessRuntimeStatus,
  type HarnessRuntimeStatusContext,
  type HarnessToolRefPayload,
  type RuntimeHarnessAdapter,
} from "../../harnesses/src/index.js";

export {
  DEFAULT_HARNESS_ID,
  type HarnessBackendRestartRequest,
  type HarnessBootstrapPayload,
  type HarnessEnsureReadyContext,
  type HarnessHostRequestBuildParams,
  type HarnessModelConfigSyncRequest,
  type HarnessModelConfigSyncResult,
  type HarnessPrepareRunParams,
  type HarnessRuntimeConfigUpdateContext,
  type HarnessRuntimeStatus,
  type HarnessRuntimeStatusContext,
  type HarnessToolRefPayload,
  type RuntimeHarnessAdapter,
};

function normalizeHarnessIdInternal(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || DEFAULT_HARNESS_ID;
}

export function normalizeHarnessId(value: unknown): string {
  return normalizeHarnessIdInternal(value);
}

const HARNESS_ADAPTERS = HARNESS_DEFINITIONS.map((definition) => definition.runtimeAdapter);

export function listRuntimeHarnessAdapters(): readonly RuntimeHarnessAdapter[] {
  return HARNESS_ADAPTERS;
}

export function resolveRuntimeHarnessAdapter(harnessId: unknown): RuntimeHarnessAdapter | null {
  const normalized = normalizeHarnessIdInternal(harnessId);
  return HARNESS_ADAPTERS.find((adapter) => adapter.id === normalized) ?? null;
}

export function requireRuntimeHarnessAdapter(harnessId: unknown): RuntimeHarnessAdapter {
  const adapter = resolveRuntimeHarnessAdapter(harnessId);
  if (!adapter) {
    throw new Error(`unsupported harness: ${normalizeHarnessIdInternal(harnessId)}`);
  }
  return adapter;
}
