/**
 * Renderer-side @holaboss/app-sdk client. Mirrors the main-process pattern in
 * `electron/appSdkClient.ts`: each request reads the latest Better-Auth
 * Cookie header and sets it explicitly. We deliberately do NOT use
 * `credentials: "include"` because Electron renderer fetch + a custom
 * Better-Auth cookie domain is fragile across CSP/origin boundaries — the
 * main-process client documents the same constraint.
 *
 * The cookie and base URL are pulled from `window.electronAPI.auth` once and
 * cached in module-local state. Cache invalidation hooks listen for
 * `auth:authenticated` / `auth:userUpdated` to refresh the cookie when the
 * session rotates.
 */
import {
  createAppClient,
  type RequestConfig,
  type ResponseConfig,
} from "@holaboss/app-sdk/core";

let cachedCookie: string | null = null;
let cachedApiBaseUrl: string | null = null;
let cachedMarketplaceBaseUrl: string | null = null;
let bootstrapPromise: Promise<void> | null = null;

async function bootstrapAuthCache(): Promise<void> {
  if (cachedCookie !== null && cachedApiBaseUrl !== null) {
    return;
  }
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const [cookie, apiBaseUrl, marketplaceBaseUrl] = await Promise.all([
        window.electronAPI.auth.getCookieHeader(),
        window.electronAPI.auth.getApiBaseUrl(),
        window.electronAPI.auth.getMarketplaceBaseUrl(),
      ]);
      cachedCookie = cookie ?? "";
      cachedApiBaseUrl = apiBaseUrl ?? "";
      cachedMarketplaceBaseUrl = marketplaceBaseUrl ?? "";
    })();
  }
  await bootstrapPromise;
}

/**
 * Force the next request to refetch cookie + base URL from main. Called on
 * auth state changes from `installRendererAuthCacheListeners`.
 */
export function invalidateAppSdkAuthCache(): void {
  cachedCookie = null;
  cachedApiBaseUrl = null;
  cachedMarketplaceBaseUrl = null;
  bootstrapPromise = null;
}

/**
 * Wire the cookie cache to Better-Auth lifecycle events so a fresh sign-in or
 * sign-out propagates without a renderer reload. Returns an unsubscribe.
 */
export function installRendererAuthCacheListeners(): () => void {
  const unsubAuthenticated = window.electronAPI.auth.onAuthenticated(() => {
    invalidateAppSdkAuthCache();
  });
  const unsubUserUpdated = window.electronAPI.auth.onUserUpdated(() => {
    invalidateAppSdkAuthCache();
  });
  return () => {
    unsubAuthenticated();
    unsubUserUpdated();
  };
}

let marketplaceClientCache:
  | (<TData, TError = unknown, TVariables = unknown>(
      config: RequestConfig<TVariables>,
    ) => Promise<ResponseConfig<TData>>)
  | null = null;

/**
 * Renderer-side @holaboss/app-sdk client targeting the marketplace BFF.
 * Behaviour matches `electron/appSdkClient.ts#buildAppSdkClient` so the
 * renderer-direct path produces identical errors/diagnostics for 401/403.
 */
export function getMarketplaceAppSdkClient() {
  if (marketplaceClientCache) {
    return marketplaceClientCache;
  }

  marketplaceClientCache = async <TData, TError = unknown, TVariables = unknown>(
    config: RequestConfig<TVariables>,
  ): Promise<ResponseConfig<TData>> => {
    await bootstrapAuthCache();
    const baseURL = cachedMarketplaceBaseUrl ?? "";
    if (!baseURL) {
      throw new Error(
        "Marketplace BFF base URL is not configured — main process did not return one.",
      );
    }
    const cookie = cachedCookie ?? "";

    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (cookie) {
      headers.set("Cookie", cookie);
    }
    for (const [key, value] of new Headers(
      (config.headers as HeadersInit | undefined) ?? undefined,
    ).entries()) {
      headers.set(key, value);
    }

    const base = createAppClient({ baseURL, headers: undefined });

    try {
      return await base<TData, TError, TVariables>({
        ...config,
        baseURL,
        headers,
      });
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? (error as { status?: number }).status
          : undefined;
      if (status === 401 || status === 403) {
        // Best-effort cache reset — the cookie may have rotated.
        invalidateAppSdkAuthCache();
        const hadCookie = cookie.length > 0;
        const diagnostic = hadCookie
          ? `sent Cookie header (${cookie.length} bytes) but server rejected it`
          : "no Cookie header — Better-Auth session missing or expired. Sign in to desktop first.";
        let bodyDump = "";
        const errData = (error as { data?: unknown }).data;
        if (errData !== undefined) {
          try {
            bodyDump = ` body=${JSON.stringify(errData)}`;
          } catch {
            bodyDump = " body=<unserializable>";
          }
        }
        const cookieNames = hadCookie
          ? cookie
              .split(/;\s*/)
              .map((kv) => kv.split("=")[0])
              .filter(Boolean)
              .join(",")
          : "";
        const cookieHint = cookieNames ? ` cookieNames=[${cookieNames}]` : "";
        const message = `Marketplace BFF returned ${status}: ${diagnostic}. Method=${config.method} URL=${config.url}${cookieHint}${bodyDump}`;
        const wrapped = new Error(message) as Error & {
          status?: number;
          originalError?: unknown;
        };
        wrapped.status = status;
        wrapped.originalError = error;
        throw wrapped;
      }
      throw error;
    }
  };

  return marketplaceClientCache;
}

/**
 * Issue a Better-Auth oRPC POST against the Hono API root. Used by billing
 * helpers (`/rpc/quota/myQuota`, `/rpc/billing/myBillingInfo`,
 * `/rpc/quota/myTransactions`) which aren't part of @holaboss/app-sdk's
 * generated surface but still need the same renderer-direct cookie path.
 *
 * Mirrors the legacy main-side `billingFetch` envelope handling.
 */
interface BillingRpcEnvelope<T> {
  json: T;
  meta?: unknown;
}

export async function billingRpcFetch<T>(
  path: string,
  input?: unknown,
): Promise<T> {
  await bootstrapAuthCache();
  const baseURL = cachedApiBaseUrl ?? "";
  if (!baseURL) {
    throw new Error(
      "Remote billing is not configured. Set HOLABOSS_AUTH_BASE_URL outside the public repo.",
    );
  }
  const cookie = cachedCookie ?? "";
  if (!cookie) {
    throw new Error("Not authenticated — sign in first.");
  }

  const response = await fetch(`${baseURL}${path}`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input === undefined ? {} : { json: input }),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      invalidateAppSdkAuthCache();
      throw new Error("Not authenticated — sign in first.");
    }
    const detail = await response.text();
    throw new Error(
      detail || `Desktop billing request failed with status ${response.status}`,
    );
  }

  const payload = (await response.json()) as BillingRpcEnvelope<T> | null;
  if (!payload || !("json" in payload)) {
    throw new Error("Desktop billing received a malformed RPC response.");
  }
  return payload.json;
}
