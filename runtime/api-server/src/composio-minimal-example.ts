import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://backend.composio.dev";

export interface CreateManagedConnectLinkParams {
  apiKey: string;
  toolkitSlug: string;
  userId: string;
  callbackUrl?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface ManagedConnectLinkResult {
  authConfigId: string;
  authConfigCreated: boolean;
  connectedAccountId: string;
  redirectUrl: string;
  expiresAt: string | null;
  userId: string;
}

interface AuthConfigListItem {
  id?: string;
  status?: string;
  is_composio_managed?: boolean;
  toolkit?: { slug?: string | null } | null;
}

function requiredString(value: string, fieldName: string): string {
  const trimmed = value.trim();
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

function baseUrl(base?: string): string {
  return (base?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function listManagedAuthConfigs(params: {
  apiKey: string;
  toolkitSlug: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
}): Promise<AuthConfigListItem[]> {
  const query = new URLSearchParams({
    toolkit_slug: params.toolkitSlug,
    is_composio_managed: "true",
    show_disabled: "false"
  });
  const response = await params.fetchImpl(`${baseUrl(params.baseUrl)}/api/v3/auth_configs?${query.toString()}`, {
    headers: buildHeaders(params.apiKey)
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to list auth configs: ${response.status} ${body}`);
  }
  const payload = await parseJson<{ items?: AuthConfigListItem[] }>(response);
  return payload.items ?? [];
}

async function createManagedAuthConfig(params: {
  apiKey: string;
  toolkitSlug: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const response = await params.fetchImpl(`${baseUrl(params.baseUrl)}/api/v3/auth_configs`, {
    method: "POST",
    headers: buildHeaders(params.apiKey),
    body: JSON.stringify({
      toolkit: { slug: params.toolkitSlug },
      auth_config: {
        type: "use_composio_managed_auth"
      }
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

async function createConnectLink(params: {
  apiKey: string;
  authConfigId: string;
  userId: string;
  callbackUrl?: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
}): Promise<ManagedConnectLinkResult> {
  const response = await params.fetchImpl(`${baseUrl(params.baseUrl)}/api/v3/connected_accounts/link`, {
    method: "POST",
    headers: buildHeaders(params.apiKey),
    body: JSON.stringify({
      auth_config_id: params.authConfigId,
      user_id: params.userId,
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
    authConfigId: params.authConfigId,
    authConfigCreated: false,
    connectedAccountId: requiredString(payload.connected_account_id ?? "", "connectedAccountId"),
    redirectUrl: requiredString(payload.redirect_url ?? "", "redirectUrl"),
    expiresAt: payload.expires_at ?? null,
    userId: params.userId
  };
}

export async function createManagedConnectLink(
  params: CreateManagedConnectLinkParams
): Promise<ManagedConnectLinkResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const toolkitSlug = requiredString(params.toolkitSlug, "toolkitSlug");
  const userId = requiredString(params.userId, "userId");
  const configs = await listManagedAuthConfigs({
    apiKey: params.apiKey,
    toolkitSlug,
    baseUrl: params.baseUrl,
    fetchImpl
  });
  const existing = configs.find(
    (config) =>
      config.status?.toUpperCase() === "ENABLED" &&
      config.is_composio_managed === true &&
      config.toolkit?.slug?.toLowerCase() === toolkitSlug.toLowerCase()
  );
  const authConfigId =
    existing?.id ??
    (await createManagedAuthConfig({
      apiKey: params.apiKey,
      toolkitSlug,
      baseUrl: params.baseUrl,
      fetchImpl
    }));

  const result = await createConnectLink({
    apiKey: params.apiKey,
    authConfigId,
    userId,
    callbackUrl: params.callbackUrl,
    baseUrl: params.baseUrl,
    fetchImpl
  });
  return {
    ...result,
    authConfigCreated: !existing
  };
}

function parseCliArgs(argv: string[]): {
  toolkitSlug: string;
  userId: string;
  callbackUrl?: string;
  baseUrl?: string;
} {
  let toolkitSlug = "gmail";
  let userId = `holaboss-smoke-${Date.now()}`;
  let callbackUrl: string | undefined;
  let apiBaseUrl: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--toolkit" && argv[index + 1]) {
      toolkitSlug = argv[index + 1]!;
      index += 1;
      continue;
    }
    if (value === "--user-id" && argv[index + 1]) {
      userId = argv[index + 1]!;
      index += 1;
      continue;
    }
    if (value === "--callback-url" && argv[index + 1]) {
      callbackUrl = argv[index + 1]!;
      index += 1;
      continue;
    }
    if (value === "--base-url" && argv[index + 1]) {
      apiBaseUrl = argv[index + 1]!;
      index += 1;
    }
  }

  return { toolkitSlug, userId, callbackUrl, baseUrl: apiBaseUrl };
}

async function main(argv: string[]): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY ?? "";
  if (!apiKey.trim()) {
    throw new Error("COMPOSIO_API_KEY is required");
  }

  const args = parseCliArgs(argv);
  const result = await createManagedConnectLink({
    apiKey,
    toolkitSlug: args.toolkitSlug,
    userId: args.userId,
    callbackUrl: args.callbackUrl,
    baseUrl: args.baseUrl
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entryPath = process.argv[1] ? fileURLToPath(new URL(`file://${process.argv[1]}`)) : "";
if (process.argv[1] && fileURLToPath(import.meta.url) === entryPath) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
