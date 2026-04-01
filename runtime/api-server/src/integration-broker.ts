import { type RuntimeStateStore } from "@holaboss/runtime-state-store";
import { validateSignedGrant } from "./grant-signing.js";

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

export interface ComposioProxyRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  endpoint: string;
  body?: unknown;
}

export interface ComposioProxyResponse {
  data: unknown;
  status: number;
  headers: Record<string, string>;
}

export interface ComposioTokenResolver {
  getAccessToken(connectedAccountId: string, provider: string): Promise<string>;
  proxyRequest(params: { connectedAccountId: string } & ComposioProxyRequest): Promise<ComposioProxyResponse>;
}

export class IntegrationBrokerService {
  readonly store: RuntimeStateStore;
  private readonly composio: ComposioTokenResolver | null;

  constructor(store: RuntimeStateStore, composio?: ComposioTokenResolver | null) {
    this.store = store;
    this.composio = composio ?? null;
  }

  async exchangeToken(params: {
    grant: string;
    provider: string;
  }): Promise<TokenExchangeResult> {
    const validated = validateSignedGrant(params.grant);
    const parsed = validated
      ? { workspaceId: validated.workspaceId, appId: validated.appId, nonce: validated.nonce }
      : parseAppGrant(params.grant);
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

    if (connection.authMode === "composio") {
      if (!connection.accountExternalId) {
        throw new BrokerError(
          "token_unavailable",
          503,
          `${provider} composio connection has no linked account`
        );
      }
      if (!this.composio) {
        throw new BrokerError(
          "token_unavailable",
          503,
          `composio token resolver is not configured`
        );
      }
      try {
        const token = await this.composio.getAccessToken(
          connection.accountExternalId,
          provider
        );
        return { token, provider, connection_id: connection.connectionId };
      } catch (error) {
        throw new BrokerError(
          "token_unavailable",
          503,
          `composio token resolution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (!connection.secretRef) {
      throw new BrokerError(
        "token_unavailable",
        503,
        `${provider} connection has no credential`
      );
    }

    const token = await this.resolveTokenWithRefresh(connection);
    return { token, provider, connection_id: connection.connectionId };
  }

  async proxyProviderRequest(params: {
    grant: string;
    provider: string;
    request: ComposioProxyRequest;
  }): Promise<ComposioProxyResponse> {
    const validated = validateSignedGrant(params.grant);
    const parsed = validated
      ? { workspaceId: validated.workspaceId, appId: validated.appId, nonce: validated.nonce }
      : parseAppGrant(params.grant);
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
      throw new BrokerError("integration_not_bound", 404, `no ${provider} binding for workspace ${parsed.workspaceId}`);
    }

    const connection = this.store.getIntegrationConnection(binding.connectionId);
    if (!connection) {
      throw new BrokerError("integration_not_bound", 404, `connection ${binding.connectionId} not found`);
    }

    if (connection.status.trim().toLowerCase() !== "active") {
      throw new BrokerError("connection_inactive", 403, `${provider} connection is ${connection.status}`);
    }

    if (connection.authMode === "composio") {
      if (!connection.accountExternalId) {
        throw new BrokerError("token_unavailable", 503, `${provider} composio connection has no linked account`);
      }
      if (!this.composio) {
        throw new BrokerError("token_unavailable", 503, "composio resolver is not configured");
      }
      return this.composio.proxyRequest({
        connectedAccountId: connection.accountExternalId,
        ...params.request
      });
    }

    throw new BrokerError("token_unavailable", 503, `proxy is only supported for composio connections, got auth_mode: ${connection.authMode}`);
  }

  private async resolveTokenWithRefresh(connection: {
    connectionId: string;
    providerId: string;
    secretRef: string | null;
    status: string;
    ownerUserId: string;
    accountLabel: string;
    authMode: string;
    grantedScopes: string[];
    accountExternalId: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<string> {
    const secretRef = connection.secretRef;
    if (!secretRef) throw new BrokerError("token_unavailable", 503, "connection has no credential");

    let parsed: { access_token?: string; refresh_token?: string; expires_at?: string } | null = null;
    try { parsed = JSON.parse(secretRef); } catch { return secretRef; }
    if (!parsed?.access_token) return secretRef;

    if (parsed.expires_at && parsed.refresh_token) {
      const expiresAt = new Date(parsed.expires_at).getTime();
      if (Date.now() > expiresAt - 60_000) {
        const refreshed = await this.refreshToken(connection, parsed.refresh_token);
        if (refreshed) return refreshed;
      }
    }
    return parsed.access_token;
  }

  private async refreshToken(connection: {
    connectionId: string;
    providerId: string;
    secretRef: string | null;
    status: string;
    ownerUserId: string;
    accountLabel: string;
    authMode: string;
    grantedScopes: string[];
    accountExternalId: string | null;
    createdAt: string;
    updatedAt: string;
  }, refreshToken: string): Promise<string | null> {
    const config = this.store.getOAuthAppConfig(connection.providerId);
    if (!config) return null;
    try {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret
        }).toString()
      });
      if (!response.ok) return null;
      const tokens = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number };
      const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
      const newPayload = JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? refreshToken,
        expires_at: expiresAt,
        token_type: "Bearer"
      });
      this.store.upsertIntegrationConnection({
        connectionId: connection.connectionId,
        providerId: connection.providerId,
        ownerUserId: connection.ownerUserId,
        accountLabel: connection.accountLabel,
        authMode: connection.authMode,
        grantedScopes: connection.grantedScopes,
        status: "active",
        secretRef: newPayload,
        accountExternalId: connection.accountExternalId
      });
      return tokens.access_token;
    } catch { return null; }
  }
}
