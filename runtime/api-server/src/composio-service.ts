const DEFAULT_BASE_URL = "https://backend.composio.dev";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ComposioConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface ConnectLinkResult {
  authConfigId: string;
  authConfigCreated: boolean;
  connectedAccountId: string;
  redirectUrl: string;
  expiresAt: string | null;
}

export interface ConnectedAccount {
  id: string;
  status: string;
  authConfigId: string | null;
  toolkitSlug: string | null;
  userId: string | null;
}

export interface ProxyResponse<TData = unknown> {
  data: TData | null;
  status: number;
  headers: Record<string, string>;
}


// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface AuthConfigListItem {
  id?: string;
  status?: string;
  is_composio_managed?: boolean;
  toolkit?: { slug?: string | null } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requiredString(value: string | undefined | null, fieldName: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    "x-api-key": requiredString(apiKey, "apiKey"),
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new Error(`Composio returned an empty response with status ${response.status}`);
  }
  return JSON.parse(text) as T;
}

function resolveBaseUrl(base?: string): string {
  return (base?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// ComposioService
// ---------------------------------------------------------------------------

export class ComposioService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ComposioConfig) {
    this.apiKey = requiredString(config.apiKey, "apiKey");
    this.baseUrl = resolveBaseUrl(config.baseUrl);
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  // -------------------------------------------------------------------------
  // createConnectLink
  // -------------------------------------------------------------------------

  /**
   * Finds or creates a Composio-managed auth config for the given toolkit,
   * then creates a connect link (OAuth redirect URL) for the user.
   */
  async createConnectLink(params: {
    toolkitSlug: string;
    userId: string;
    callbackUrl?: string;
  }): Promise<ConnectLinkResult> {
    const toolkitSlug = requiredString(params.toolkitSlug, "toolkitSlug");
    const userId = requiredString(params.userId, "userId");

    // Step 1: Find existing managed auth config
    const configs = await this.listManagedAuthConfigs(toolkitSlug);
    const existing = configs.find(
      (config) =>
        config.status?.toUpperCase() === "ENABLED" &&
        config.is_composio_managed === true &&
        config.toolkit?.slug?.toLowerCase() === toolkitSlug.toLowerCase()
    );

    // Step 2: Create one if none exists
    const authConfigCreated = !existing;
    const authConfigId =
      existing?.id ?? (await this.createManagedAuthConfig(toolkitSlug));

    // Step 3: Create connect link
    const response = await this.fetchImpl(`${this.baseUrl}/api/v3/connected_accounts/link`, {
      method: "POST",
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify({
        auth_config_id: authConfigId,
        user_id: userId,
        ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {})
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to create connect link: ${response.status} ${body}`);
    }
    const payload = await parseJson<{
      redirect_url?: string;
      expires_at?: string | null;
      connected_account_id?: string;
    }>(response);

    return {
      authConfigId,
      authConfigCreated,
      connectedAccountId: requiredString(payload.connected_account_id, "connectedAccountId"),
      redirectUrl: requiredString(payload.redirect_url, "redirectUrl"),
      expiresAt: payload.expires_at ?? null
    };
  }

  // -------------------------------------------------------------------------
  // getConnectedAccount
  // -------------------------------------------------------------------------

  /**
   * Gets a connected account by ID, returns normalized data with status.
   */
  async getConnectedAccount(connectedAccountId: string): Promise<ConnectedAccount> {
    const id = requiredString(connectedAccountId, "connectedAccountId");
    const response = await this.fetchImpl(`${this.baseUrl}/api/v3/connected_accounts/${id}`, {
      headers: buildHeaders(this.apiKey)
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to get connected account: ${response.status} ${body}`);
    }
    const payload = await parseJson<{
      id?: string;
      status?: string;
      auth_config?: { id?: string } | null;
      toolkit?: { slug?: string } | null;
      user_id?: string;
    }>(response);
    return {
      id: payload.id ?? id,
      status: (payload.status ?? "unknown").toUpperCase(),
      authConfigId: payload.auth_config?.id ?? null,
      toolkitSlug: payload.toolkit?.slug ?? null,
      userId: payload.user_id ?? null
    };
  }

  // -------------------------------------------------------------------------
  // proxyRequest
  // -------------------------------------------------------------------------

  /**
   * Sends a proxy request through a connected account, returns
   * `{ data, status, headers }` envelope.
   */
  async proxyRequest<TData = unknown>(params: {
    connectedAccountId: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    endpoint: string;
    body?: unknown;
  }): Promise<ProxyResponse<TData>> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/v3/tools/execute/proxy`, {
      method: "POST",
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify({
        connected_account_id: requiredString(params.connectedAccountId, "connectedAccountId"),
        endpoint: requiredString(params.endpoint, "endpoint"),
        method: params.method,
        ...(params.body !== undefined ? { body: params.body } : {})
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Proxy request failed: ${response.status} ${body}`);
    }
    const payload = await parseJson<{
      data?: TData | null;
      status?: number;
      headers?: Record<string, string>;
    }>(response);
    return {
      data: payload.data ?? null,
      status: payload.status ?? response.status,
      headers: payload.headers ?? {}
    };
  }

  // -------------------------------------------------------------------------
  // getAccessToken
  // -------------------------------------------------------------------------

  /**
   * Obtains a provider access token from a Composio connected account.
   * Reads `data.access_token` directly from the connected account response.
   * Composio manages token refresh automatically.
   */
  async getAccessToken(
    connectedAccountId: string,
    _provider: string
  ): Promise<string> {
    const id = requiredString(connectedAccountId, "connectedAccountId");
    const response = await this.fetchImpl(`${this.baseUrl}/api/v3/connected_accounts/${id}`, {
      headers: buildHeaders(this.apiKey)
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to get connected account: ${response.status} ${body}`);
    }
    const payload = await parseJson<{
      status?: string;
      data?: { access_token?: string } | null;
    }>(response);

    const status = (payload.status ?? "unknown").toUpperCase();
    if (status !== "ACTIVE") {
      throw new Error(
        `Connected account ${id} is not ACTIVE (status: ${status})`
      );
    }

    const token = payload.data?.access_token;
    if (!token) {
      throw new Error(`Connected account ${id} has no access_token`);
    }

    return token;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async listManagedAuthConfigs(toolkitSlug: string): Promise<AuthConfigListItem[]> {
    const query = new URLSearchParams({
      toolkit_slug: toolkitSlug,
      is_composio_managed: "true",
      show_disabled: "false"
    });
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v3/auth_configs?${query.toString()}`,
      { headers: buildHeaders(this.apiKey) }
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to list auth configs: ${response.status} ${body}`);
    }
    const payload = await parseJson<{ items?: AuthConfigListItem[] }>(response);
    return payload.items ?? [];
  }

  private async createManagedAuthConfig(toolkitSlug: string): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/v3/auth_configs`, {
      method: "POST",
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify({
        toolkit: { slug: toolkitSlug },
        auth_config: { type: "use_composio_managed_auth" }
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to create auth config: ${response.status} ${body}`);
    }
    const payload = await parseJson<{ id?: string; auth_config?: { id?: string } }>(response);
    const authConfigId = payload.id ?? payload.auth_config?.id ?? "";
    return requiredString(authConfigId, "authConfigId");
  }
}
