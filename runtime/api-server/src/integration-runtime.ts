import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  type IntegrationBindingRecord,
  type IntegrationConnectionRecord,
  type RuntimeStateStore
} from "@holaboss/runtime-state-store";

import { type ResolvedApplicationRuntime } from "./workspace-apps.js";

export const DEFAULT_INTEGRATION_BROKER_URL = "http://127.0.0.1:8080/api/v1/integrations";

export interface IntegrationRuntimeResolution {
  workspaceId: string | null;
  appId: string;
  brokerUrl: string;
  appGrant: string | null;
  env: NodeJS.ProcessEnv;
  bindings: IntegrationBindingRecord[];
  connections: IntegrationConnectionRecord[];
}

function toProviderEnvKey(provider: string): string {
  return provider.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function resolveWorkspaceIdFromAppDir(store: RuntimeStateStore, appDir?: string): string | null {
  if (!appDir) {
    return null;
  }
  const normalizedAppDir = path.resolve(appDir);
  for (const workspace of store.listWorkspaces()) {
    const workspaceDir = path.resolve(store.workspaceDir(workspace.id));
    const relative = path.relative(workspaceDir, normalizedAppDir);
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return workspace.id;
    }
  }
  return null;
}

function resolveBindingForRequirement(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  appId: string;
  integrationKey: string;
}): IntegrationBindingRecord | null {
  return (
    params.store.getIntegrationBindingByTarget({
      workspaceId: params.workspaceId,
      targetType: "app",
      targetId: params.appId,
      integrationKey: params.integrationKey
    }) ??
    params.store.getIntegrationBindingByTarget({
      workspaceId: params.workspaceId,
      targetType: "workspace",
      targetId: "default",
      integrationKey: params.integrationKey
    })
  );
}

export function resolveIntegrationRuntime(params: {
  store: RuntimeStateStore;
  appId: string;
  resolvedApp?: ResolvedApplicationRuntime;
  appDir?: string;
  workspaceId?: string;
  integrationBrokerUrl?: string;
}): IntegrationRuntimeResolution {
  const resolvedApp = params.resolvedApp;
  const requirements = resolvedApp?.integrations ?? [];
  const brokerUrl = params.integrationBrokerUrl ?? DEFAULT_INTEGRATION_BROKER_URL;
  const workspaceId = params.workspaceId ?? resolveWorkspaceIdFromAppDir(params.store, params.appDir);
  const env: NodeJS.ProcessEnv = {};
  const bindings: IntegrationBindingRecord[] = [];
  const connections: IntegrationConnectionRecord[] = [];

  if (requirements.length === 0 || !workspaceId) {
    return {
      workspaceId,
      appId: params.appId,
      brokerUrl,
      appGrant: null,
      env,
      bindings,
      connections
    };
  }

  env.HOLABOSS_INTEGRATION_BROKER_URL = brokerUrl;
  env.HOLABOSS_APP_GRANT = `grant:${workspaceId}:${params.appId}:${randomUUID()}`;

  let platformIntegrationToken = "";
  for (const requirement of requirements) {
    const binding = resolveBindingForRequirement({
      store: params.store,
      workspaceId,
      appId: params.appId,
      integrationKey: requirement.key
    });
    if (!binding) {
      continue;
    }
    const connection = params.store.getIntegrationConnection(binding.connectionId);
    if (!connection) {
      continue;
    }
    bindings.push(binding);
    connections.push(connection);

    env[`WORKSPACE_${toProviderEnvKey(requirement.provider)}_INTEGRATION_ID`] = connection.connectionId;
    if (!platformIntegrationToken && requirement.credentialSource === "platform" && connection.secretRef) {
      platformIntegrationToken = connection.secretRef;
    }
  }

  if (platformIntegrationToken) {
    env.PLATFORM_INTEGRATION_TOKEN = platformIntegrationToken;
  }

  return {
    workspaceId,
    appId: params.appId,
    brokerUrl,
    appGrant: env.HOLABOSS_APP_GRANT ?? null,
    env,
    bindings,
    connections
  };
}
