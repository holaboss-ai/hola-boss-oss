import { type RuntimeStateStore } from "@holaboss/runtime-state-store";

export type BrokerErrorCode =
  | "grant_invalid"
  | "integration_not_bound"
  | "connection_inactive"
  | "token_unavailable";

export class BrokerError extends Error {
  readonly code: BrokerErrorCode;
  readonly statusCode: number;

  constructor(code: BrokerErrorCode, statusCode: number, message: string) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ParsedAppGrant {
  workspaceId: string;
  appId: string;
  nonce: string;
}

export interface TokenExchangeResult {
  token: string;
  provider: string;
  connection_id: string;
}

export function parseAppGrant(grant: string): ParsedAppGrant | null {
  if (typeof grant !== "string" || !grant.startsWith("grant:")) {
    return null;
  }
  const parts = grant.slice("grant:".length).split(":");
  if (parts.length < 3) {
    return null;
  }
  const workspaceId = parts[0]!;
  const appId = parts[1]!;
  const nonce = parts.slice(2).join(":");
  if (!workspaceId || !appId || !nonce) {
    return null;
  }
  return { workspaceId, appId, nonce };
}

export class IntegrationBrokerService {
  readonly store: RuntimeStateStore;

  constructor(store: RuntimeStateStore) {
    this.store = store;
  }

  exchangeToken(params: {
    grant: string;
    provider: string;
  }): TokenExchangeResult {
    const parsed = parseAppGrant(params.grant);
    if (!parsed) {
      throw new BrokerError("grant_invalid", 401, "app grant is malformed");
    }

    const provider = params.provider.trim();
    if (!provider) {
      throw new BrokerError("grant_invalid", 401, "provider is required");
    }

    const binding =
      this.store.getIntegrationBindingByTarget({
        workspaceId: parsed.workspaceId,
        targetType: "app",
        targetId: parsed.appId,
        integrationKey: provider
      }) ??
      this.store.getIntegrationBindingByTarget({
        workspaceId: parsed.workspaceId,
        targetType: "workspace",
        targetId: "default",
        integrationKey: provider
      });

    if (!binding) {
      throw new BrokerError(
        "integration_not_bound",
        404,
        `no ${provider} binding for workspace ${parsed.workspaceId}`
      );
    }

    const connection = this.store.getIntegrationConnection(
      binding.connectionId
    );
    if (!connection) {
      throw new BrokerError(
        "integration_not_bound",
        404,
        `connection ${binding.connectionId} not found`
      );
    }

    if (connection.status.trim().toLowerCase() !== "active") {
      throw new BrokerError(
        "connection_inactive",
        403,
        `${provider} connection is ${connection.status}`
      );
    }

    if (!connection.secretRef) {
      throw new BrokerError(
        "token_unavailable",
        503,
        `${provider} connection has no credential`
      );
    }

    return {
      token: connection.secretRef,
      provider,
      connection_id: connection.connectionId
    };
  }
}
