import { randomUUID } from "node:crypto";

import { type RuntimeStateStore } from "@holaboss/runtime-state-store";

import {
  type IntegrationReadinessResult,
  checkIntegrationReadiness
} from "./integration-runtime.js";
import { resolveWorkspaceAppRuntime } from "./workspace-apps.js";

export interface IntegrationCatalogProviderRecord {
  provider_id: string;
  display_name: string;
  description: string;
  auth_modes: string[];
  supports_oss: boolean;
  supports_managed: boolean;
  default_scopes: string[];
  docs_url: string | null;
}

export interface IntegrationConnectionPayload {
  connection_id: string;
  provider_id: string;
  owner_user_id: string;
  workspace_id: string | null;
  account_label: string;
  account_external_id: string | null;
  auth_mode: string;
  granted_scopes: string[];
  status: string;
  secret_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationBindingPayload {
  binding_id: string;
  workspace_id: string;
  target_type: "workspace" | "app" | "agent";
  target_id: string;
  integration_key: string;
  connection_id: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export class IntegrationServiceError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const PHASE_1_INTEGRATION_CATALOG: IntegrationCatalogProviderRecord[] = [
  {
    provider_id: "gmail",
    display_name: "Gmail",
    description: "Read, draft, and send emails through Gmail.",
    auth_modes: ["managed", "oauth_app", "manual_token"],
    supports_oss: true,
    supports_managed: true,
    default_scopes: ["gmail.send", "gmail.readonly"],
    docs_url: null
  },
  {
    provider_id: "googlesheets",
    display_name: "Google Sheets",
    description: "Read and manage spreadsheet data through Google Sheets.",
    auth_modes: ["managed", "oauth_app", "manual_token"],
    supports_oss: true,
    supports_managed: true,
    default_scopes: ["spreadsheets"],
    docs_url: null
  },
  {
    provider_id: "google",
    display_name: "Google",
    description: "Google account (legacy — prefer gmail or googlesheets).",
    auth_modes: ["managed", "oauth_app", "manual_token"],
    supports_oss: true,
    supports_managed: true,
    default_scopes: [],
    docs_url: null
  },
  {
    provider_id: "github",
    display_name: "GitHub",
    description: "Triage PRs, issues, and repository workflows.",
    auth_modes: ["managed", "oauth_app", "manual_token"],
    supports_oss: true,
    supports_managed: true,
    default_scopes: ["repo", "read:org"],
    docs_url: null
  },
  {
    provider_id: "reddit",
    display_name: "Reddit",
    description: "Read and manage Reddit content and moderation workflows.",
    auth_modes: ["managed", "oauth_app", "manual_token"],
    supports_oss: true,
    supports_managed: true,
    default_scopes: ["read", "submit"],
    docs_url: null
  },
  {
    provider_id: "twitter",
    display_name: "Twitter / X",
    description: "Read and publish social updates on X.",
    auth_modes: ["managed", "oauth_app", "manual_token"],
    supports_oss: true,
    supports_managed: true,
    default_scopes: ["tweet.read", "tweet.write"],
    docs_url: null
  },
  {
    provider_id: "linkedin",
    display_name: "LinkedIn",
    description: "Manage LinkedIn content and workflows.",
    auth_modes: ["managed", "oauth_app", "manual_token"],
    supports_oss: true,
    supports_managed: true,
    default_scopes: ["r_liteprofile", "w_member_social"],
    docs_url: null
  }
];

const VALID_TARGET_TYPES = new Set(["workspace", "app", "agent"]);

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new IntegrationServiceError(400, `${fieldName} is required`);
  }
  return value.trim();
}

function lookupProviderDisplayName(providerId: string): string {
  return (
    PHASE_1_INTEGRATION_CATALOG.find((provider) => provider.provider_id === providerId)?.display_name ??
    providerId
  );
}

function optionalBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function validateTargetType(targetType: string): "workspace" | "app" | "agent" {
  const normalized = requiredString(targetType, "target_type");
  if (!VALID_TARGET_TYPES.has(normalized)) {
    throw new IntegrationServiceError(400, "target_type must be workspace, app, or agent");
  }
  return normalized as "workspace" | "app" | "agent";
}

function requireWorkspace(store: RuntimeStateStore, workspaceId: string): void {
  if (!store.getWorkspace(workspaceId)) {
    throw new IntegrationServiceError(404, "workspace not found");
  }
}

function toIntegrationConnectionPayload(record: {
  connectionId: string;
  providerId: string;
  ownerUserId: string;
  workspaceId: string | null;
  accountLabel: string;
  accountExternalId: string | null;
  authMode: string;
  grantedScopes: string[];
  status: string;
  secretRef: string | null;
  createdAt: string;
  updatedAt: string;
}): IntegrationConnectionPayload {
  return {
    connection_id: record.connectionId,
    provider_id: record.providerId,
    owner_user_id: record.ownerUserId,
    workspace_id: record.workspaceId,
    account_label: record.accountLabel,
    account_external_id: record.accountExternalId,
    auth_mode: record.authMode,
    granted_scopes: record.grantedScopes,
    status: record.status,
    secret_ref: record.secretRef,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function toIntegrationBindingPayload(record: {
  bindingId: string;
  workspaceId: string;
  targetType: string;
  targetId: string;
  integrationKey: string;
  connectionId: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}): IntegrationBindingPayload {
  const targetType = validateTargetType(record.targetType);
  return {
    binding_id: record.bindingId,
    workspace_id: record.workspaceId,
    target_type: targetType,
    target_id: record.targetId,
    integration_key: record.integrationKey,
    connection_id: record.connectionId,
    is_default: record.isDefault,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

export class RuntimeIntegrationService {
  readonly store: RuntimeStateStore;

  constructor(store: RuntimeStateStore) {
    this.store = store;
  }

  getCatalog(): { providers: IntegrationCatalogProviderRecord[] } {
    return { providers: PHASE_1_INTEGRATION_CATALOG };
  }

  listConnections(params: { providerId?: string; ownerUserId?: string; workspaceId?: string } = {}): {
    connections: IntegrationConnectionPayload[];
  } {
    return {
      connections: this.store
        .listIntegrationConnections({
          providerId: params.providerId,
          ownerUserId: params.ownerUserId,
          workspaceId: params.workspaceId
        })
        .map(toIntegrationConnectionPayload)
    };
  }

  listBindings(params: { workspaceId: string }): { bindings: IntegrationBindingPayload[] } {
    const workspaceId = requiredString(params.workspaceId, "workspace_id");
    requireWorkspace(this.store, workspaceId);
    return {
      bindings: this.store.listIntegrationBindings({ workspaceId }).map(toIntegrationBindingPayload)
    };
  }

  upsertBinding(params: {
    workspaceId: string;
    targetType: string;
    targetId: string;
    integrationKey: string;
    connectionId: string;
    isDefault?: boolean;
  }): IntegrationBindingPayload {
    const workspaceId = requiredString(params.workspaceId, "workspace_id");
    const targetType = validateTargetType(params.targetType);
    const targetId = requiredString(params.targetId, "target_id");
    const integrationKey = requiredString(params.integrationKey, "integration_key");
    const connectionId = requiredString(params.connectionId, "connection_id");
    const isDefault = optionalBoolean(params.isDefault, false);
    requireWorkspace(this.store, workspaceId);

    const connection = this.store.getIntegrationConnection(connectionId);
    if (!connection) {
      throw new IntegrationServiceError(404, `integration connection ${connectionId} not found`);
    }
    if (connection.providerId !== integrationKey) {
      throw new IntegrationServiceError(
        400,
        `connection provider ${connection.providerId} does not match integration ${integrationKey}`
      );
    }

    const existing = this.store.getIntegrationBindingByTarget({
      workspaceId,
      targetType,
      targetId,
      integrationKey
    });
    const binding = this.store.upsertIntegrationBinding({
      bindingId: existing?.bindingId ?? randomUUID(),
      workspaceId,
      targetType,
      targetId,
      integrationKey,
      connectionId,
      isDefault
    });

    return toIntegrationBindingPayload(binding);
  }

  deleteBinding(bindingId: string, workspaceId?: string): { deleted: true } {
    const normalizedBindingId = requiredString(bindingId, "binding_id");
    const normalizedWorkspaceId = requiredString(workspaceId, "workspace_id");
    requireWorkspace(this.store, normalizedWorkspaceId);

    const binding = this.store.getIntegrationBinding(normalizedBindingId);
    if (!binding || binding.workspaceId !== normalizedWorkspaceId) {
      throw new IntegrationServiceError(404, "binding not found");
    }

    const deleted = this.store.deleteIntegrationBinding(normalizedBindingId);
    if (!deleted) {
      throw new IntegrationServiceError(404, "binding not found");
    }
    return { deleted: true };
  }

  createConnection(params: {
    providerId: string;
    ownerUserId: string;
    workspaceId?: string | null;
    accountLabel: string;
    authMode: string;
    grantedScopes: string[];
    secretRef?: string;
    accountExternalId?: string;
  }): IntegrationConnectionPayload {
    const providerId = requiredString(params.providerId, "provider_id");
    const ownerUserId = requiredString(params.ownerUserId, "owner_user_id");
    const authMode = requiredString(params.authMode, "auth_mode");
    const rawAccountLabel = typeof params.accountLabel === "string" ? params.accountLabel.trim() : "";
    const accountLabel =
      rawAccountLabel ||
      (authMode === "manual_token" ? `${lookupProviderDisplayName(providerId)} connection` : requiredString(params.accountLabel, "account_label"));

    const workspaceId =
      typeof params.workspaceId === "string" && params.workspaceId.trim().length > 0
        ? params.workspaceId.trim()
        : null;
    if (workspaceId) {
      requireWorkspace(this.store, workspaceId);
    }

    const record = this.store.upsertIntegrationConnection({
      connectionId: randomUUID(),
      providerId,
      ownerUserId,
      workspaceId,
      accountLabel,
      authMode,
      grantedScopes: params.grantedScopes ?? [],
      status: "active",
      secretRef: params.secretRef,
      accountExternalId: params.accountExternalId
    });

    return toIntegrationConnectionPayload(record);
  }

  updateConnection(connectionId: string, params: {
    status?: string;
    secretRef?: string;
    accountLabel?: string;
    grantedScopes?: string[];
    workspaceId?: string | null;
  }): IntegrationConnectionPayload {
    const normalizedId = requiredString(connectionId, "connection_id");
    const existing = this.store.getIntegrationConnection(normalizedId);
    if (!existing) {
      throw new IntegrationServiceError(404, "connection not found");
    }

    let workspaceId: string | null = existing.workspaceId;
    if (params.workspaceId !== undefined) {
      if (params.workspaceId === null || params.workspaceId === "") {
        workspaceId = null;
      } else {
        const trimmed = requiredString(params.workspaceId, "workspace_id");
        requireWorkspace(this.store, trimmed);
        workspaceId = trimmed;
      }
    }

    const record = this.store.upsertIntegrationConnection({
      connectionId: existing.connectionId,
      providerId: existing.providerId,
      ownerUserId: existing.ownerUserId,
      workspaceId,
      accountLabel: params.accountLabel ?? existing.accountLabel,
      authMode: existing.authMode,
      grantedScopes: params.grantedScopes ?? existing.grantedScopes,
      status: params.status ?? existing.status,
      secretRef: params.secretRef !== undefined ? params.secretRef : existing.secretRef,
      accountExternalId: existing.accountExternalId
    });

    return toIntegrationConnectionPayload(record);
  }

  deleteConnection(connectionId: string): { deleted: true } {
    const normalizedId = requiredString(connectionId, "connection_id");
    const existing = this.store.getIntegrationConnection(normalizedId);
    if (!existing) {
      throw new IntegrationServiceError(404, "connection not found");
    }

    const bindings = this.store.listIntegrationBindings({}).filter(
      (b) => b.connectionId === normalizedId
    );

    // Auto-remove orphaned bindings whose workspace no longer exists
    const liveBindings: typeof bindings = [];
    for (const binding of bindings) {
      if (!this.store.getWorkspace(binding.workspaceId)) {
        this.store.deleteIntegrationBinding(binding.bindingId);
      } else {
        liveBindings.push(binding);
      }
    }

    if (liveBindings.length > 0) {
      throw new IntegrationServiceError(
        409,
        `connection is bound to ${liveBindings.length} workspace(s) — remove bindings first`
      );
    }

    this.store.deleteIntegrationConnection(normalizedId);
    return { deleted: true };
  }

  checkReadiness(params: {
    workspaceId: string;
    appId: string;
  }): IntegrationReadinessResult {
    const workspaceId = requiredString(params.workspaceId, "workspace_id");
    const appId = requiredString(params.appId, "app_id");
    requireWorkspace(this.store, workspaceId);

    const workspaceDir = this.store.workspaceDir(workspaceId);
    try {
      const appRuntime = resolveWorkspaceAppRuntime(workspaceDir, appId, {
        store: this.store,
        workspaceId
      });
      return checkIntegrationReadiness({
        store: this.store,
        workspaceId,
        appId,
        resolvedApp: appRuntime.resolvedApp
      });
    } catch {
      return { ready: true, issues: [] };
    }
  }
}
