import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_MODEL_PROXY_BASE_URL,
  DEFAULT_RUNTIME_MODEL,
  useDesktopAuthSession,
  type AuthSession
} from "@/lib/auth/authClient";

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

export function AuthPanel() {
  const sessionState = useDesktopAuthSession();
  const session = sessionState.data;
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigPayload | null>(null);
  const [modelProxyBaseUrl, setModelProxyBaseUrl] = useState(DEFAULT_MODEL_PROXY_BASE_URL);
  const [defaultModel, setDefaultModel] = useState(DEFAULT_RUNTIME_MODEL);
  const [runtimeUserId, setRuntimeUserId] = useState("");
  const [sandboxId, setSandboxId] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isStartingSignIn, setIsStartingSignIn] = useState(false);
  const [isSavingRuntimeConfig, setIsSavingRuntimeConfig] = useState(false);
  const [isExchangingRuntimeBinding, setIsExchangingRuntimeBinding] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  async function refreshRuntimeConfig() {
    if (!window.electronAPI) {
      return;
    }
    const config = await window.electronAPI.runtime.getConfig();
    setRuntimeConfig(config);
    setModelProxyBaseUrl(config.modelProxyBaseUrl ?? DEFAULT_MODEL_PROXY_BASE_URL);
    setDefaultModel(config.defaultModel ?? DEFAULT_RUNTIME_MODEL);
    setRuntimeUserId(config.userId ?? "");
    setSandboxId(config.sandboxId ?? `desktop:${crypto.randomUUID()}`);
  }

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    let cancelled = false;
    void window.electronAPI.runtime.getConfig().then((config) => {
      if (cancelled) {
        return;
      }
      setRuntimeConfig(config);
      setModelProxyBaseUrl(config.modelProxyBaseUrl ?? DEFAULT_MODEL_PROXY_BASE_URL);
      setDefaultModel(config.defaultModel ?? DEFAULT_RUNTIME_MODEL);
      setRuntimeUserId(config.userId ?? "");
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
      setModelProxyBaseUrl(config.modelProxyBaseUrl ?? DEFAULT_MODEL_PROXY_BASE_URL);
      setDefaultModel(config.defaultModel ?? DEFAULT_RUNTIME_MODEL);
      setRuntimeUserId(config.userId ?? "");
      setSandboxId(config.sandboxId ?? `desktop:${crypto.randomUUID()}`);
      setAuthError("");
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
    const nextUserId = sessionUserId(session);
    if (nextUserId) {
      setRuntimeUserId((current) => current || nextUserId);
    }
  }, [session]);

  useEffect(() => {
    if (sessionState.error) {
      setAuthError(sessionState.error.message);
    }
  }, [sessionState.error]);

  const isSignedIn = Boolean(sessionUserId(session));
  const resolvedUserId = runtimeUserId.trim() || sessionUserId(session);
  const runtimeBindingReady =
    Boolean(runtimeConfig?.authTokenPresent) &&
    Boolean((runtimeConfig?.sandboxId || "").trim()) &&
    Boolean((runtimeConfig?.modelProxyBaseUrl || "").trim());
  const isFinishingSetup = isSignedIn && !runtimeBindingReady && !authError;
  const statusTone = authError ? "error" : runtimeBindingReady ? "ready" : isFinishingSetup ? "syncing" : "idle";

  const runtimeSummary = useMemo(() => {
    if (!runtimeConfig) {
      return "runtime config unavailable";
    }

    const parts = [
      runtimeConfig.loadedFromFile ? "runtime config loaded" : "runtime config empty",
      runtimeConfig.authTokenPresent ? "token present" : "token missing",
      runtimeConfig.userId ? `user ${runtimeConfig.userId}` : "user missing",
      runtimeConfig.sandboxId ? `sandbox ${runtimeConfig.sandboxId}` : "sandbox missing"
    ];
    return parts.join(" - ");
  }, [runtimeConfig]);

  const statusBadgeLabel = sessionState.isPending
    ? "Checking session"
    : authError
      ? "Needs attention"
      : runtimeBindingReady
        ? "Connected"
        : isSignedIn
          ? "Finishing setup"
          : "Signed out";

  const statusTitle = !isSignedIn
    ? "Sign in to connect this desktop runtime"
    : runtimeBindingReady
      ? "Desktop runtime is connected"
      : authError
        ? "We couldn't finish desktop setup"
        : "Finishing desktop setup";

  const statusDescription = !isSignedIn
    ? "Use your Holaboss account to connect this desktop app and enable synced product features."
    : runtimeBindingReady
      ? "Your desktop runtime is bound to your Holaboss account and ready to use product features."
      : authError
        ? "Your account session is active, but the desktop runtime binding needs to be refreshed."
        : "Sign-in succeeded. Holaboss is finishing the local runtime setup in the background.";

  const badgeClassName =
    statusTone === "error"
      ? "border-rose-400/35 bg-rose-500/10 text-rose-400"
      : statusTone === "ready"
        ? "border-primary/35 bg-primary/10 text-primary"
        : statusTone === "syncing"
          ? "border-amber-300/35 bg-amber-400/10 text-amber-300"
          : "border-border/45 bg-black/10 text-muted-foreground/78";

  const infoRows = [
    {
      label: "Profile",
      value: isSignedIn ? "Connected" : "Sign in required"
    },
    {
      label: "Runtime",
      value: runtimeBindingReady ? "Ready on this desktop" : isSignedIn ? "Finishing setup" : "Offline"
    },
    {
      label: "Sandbox",
      value: sandboxId.trim() || "Will be assigned automatically"
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

  async function handleSaveRuntimeConfig() {
    if (!window.electronAPI) {
      return;
    }

    setIsSavingRuntimeConfig(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const nextConfig = await window.electronAPI.runtime.setConfig({
        userId: resolvedUserId || null,
        sandboxId: sandboxId.trim() || null,
        modelProxyBaseUrl: modelProxyBaseUrl.trim() || null,
        defaultModel: defaultModel.trim() || null
      });
      setRuntimeConfig(nextConfig);
      setAuthMessage("Runtime config updated. The runtime was restarted with the new settings.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to update runtime config.");
    } finally {
      setIsSavingRuntimeConfig(false);
    }
  }

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
      setRuntimeUserId(nextConfig.userId ?? "");
      setModelProxyBaseUrl(nextConfig.modelProxyBaseUrl ?? DEFAULT_MODEL_PROXY_BASE_URL);
      setDefaultModel(nextConfig.defaultModel ?? DEFAULT_RUNTIME_MODEL);
      setAuthMessage("Runtime binding refreshed and local runtime config updated.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to exchange runtime binding.");
    } finally {
      setIsExchangingRuntimeBinding(false);
    }
  }

  return (
    <section className="theme-shell soft-vignette w-full max-w-[560px] overflow-hidden rounded-[24px] border border-border/40 text-[11px] text-foreground/88 shadow-lg">
      <div className="border-b border-border/40 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-[16px] font-semibold text-primary">
              {sessionInitials(session)}
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-medium text-foreground">
                {isSignedIn ? sessionDisplayName(session) || "Holaboss account" : "Holaboss account"}
              </div>
              <div className="mt-0.5 truncate text-[12px] text-muted-foreground/80">
                {isSignedIn ? sessionEmail(session) || resolvedUserId || "Signed in" : "Not connected"}
              </div>
            </div>
          </div>
          <div className={`shrink-0 rounded-full border px-3 py-1 text-[10px] tracking-[0.14em] ${badgeClassName}`}>{statusBadgeLabel}</div>
        </div>

        <div className="theme-subtle-surface mt-4 rounded-[18px] border border-border/35 px-4 py-3">
          <div className="text-[13px] text-foreground">{statusTitle}</div>
          <div className="mt-1 text-[11px] leading-5 text-muted-foreground/82">{statusDescription}</div>
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="grid gap-2">
          {infoRows.map((row) => (
            <div
              key={row.label}
              className="theme-subtle-surface flex items-center justify-between gap-3 rounded-[16px] border border-border/35 px-4 py-3"
            >
              <div className="text-[11px] text-foreground/92">{row.label}</div>
              <div className="max-w-[58%] truncate text-right text-[11px] text-muted-foreground/82">{row.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!isSignedIn && (
            <button
              className="inline-flex h-[42px] items-center justify-center rounded-[16px] border border-primary/40 bg-primary/10 px-4 text-[12px] text-primary transition hover:bg-primary/16 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={() => void handleStartSignIn()}
              disabled={isStartingSignIn}
            >
              {isStartingSignIn ? "Opening sign-in..." : "Sign in with browser"}
            </button>
          )}

          {isSignedIn && !runtimeBindingReady && (
            <button
              className="inline-flex h-[42px] items-center justify-center rounded-[16px] border border-primary/40 bg-primary/10 px-4 text-[12px] text-primary transition hover:bg-primary/16 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={() => void handleExchangeRuntimeBinding()}
              disabled={isExchangingRuntimeBinding}
            >
              {isExchangingRuntimeBinding ? "Retrying setup..." : "Retry setup"}
            </button>
          )}

          <button
            className="theme-control-surface inline-flex h-[42px] items-center justify-center rounded-[16px] border border-border/45 px-4 text-[12px] text-foreground transition hover:border-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => void handleRefreshSession()}
            disabled={sessionState.isPending}
          >
            Refresh session
          </button>

          <button
            className="theme-control-surface inline-flex h-[42px] items-center justify-center rounded-[16px] border border-border/45 px-4 text-[12px] text-foreground transition hover:border-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => void handleSignOut()}
            disabled={!isSignedIn}
          >
            Sign out
          </button>
        </div>

        {isFinishingSetup && !isExchangingRuntimeBinding && (
          <div className="mt-3 rounded-[16px] border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-[11px] text-amber-300">
            Sign-in completed. Holaboss is finishing local runtime setup.
          </div>
        )}

        {runtimeBindingReady && !authMessage && !authError && (
          <div className="mt-3 rounded-[16px] border border-primary/18 bg-primary/8 px-4 py-3 text-[11px] text-primary">
            Connected. Remote proactive and marketplace features are available on this desktop runtime.
          </div>
        )}

        {(authMessage || authError) && (
          <div
            className={`mt-3 rounded-[16px] border px-4 py-3 text-[11px] ${
              authError
                ? "border-rose-400/35 bg-rose-500/8 text-rose-400"
                : "border-primary/35 bg-primary/8 text-primary"
            }`}
          >
            {authError || authMessage}
          </div>
        )}

        <div className="mt-4 border-t border-border/45 pt-3">
          <button
            className="theme-control-surface flex w-full items-center justify-between rounded-[16px] border border-border/45 px-4 py-3 text-left text-[11px] text-foreground transition hover:border-primary/35"
            type="button"
            onClick={() => setIsAdvancedOpen((current) => !current)}
          >
            <span>Advanced runtime settings</span>
            <span className="text-muted-foreground">{isAdvancedOpen ? "Hide" : "Show"}</span>
          </button>

          {isAdvancedOpen && (
            <div className="theme-subtle-surface mt-3 grid gap-2 rounded-[18px] border border-border/35 p-3">
              <div className="text-[10px] tracking-[0.16em] text-muted-foreground/76">RUNTIME PRODUCT CONFIG</div>

              <label className="grid gap-1">
                <span className="text-[10px] tracking-[0.12em] text-muted-foreground/76">Runtime sandbox ID</span>
                <input
                  className="theme-control-surface rounded-lg border border-border/45 px-3 py-2 text-[12px] text-foreground outline-none transition focus:border-primary/70"
                  type="text"
                  value={sandboxId}
                  onChange={(event) => setSandboxId(event.target.value)}
                  placeholder="desktop:<stable-id>"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[10px] tracking-[0.12em] text-muted-foreground/76">Runtime user ID</span>
                <input
                  className="theme-control-surface rounded-lg border border-border/45 px-3 py-2 text-[12px] text-foreground outline-none transition focus:border-primary/70"
                  type="text"
                  value={runtimeUserId}
                  onChange={(event) => setRuntimeUserId(event.target.value)}
                  placeholder="user id"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[10px] tracking-[0.12em] text-muted-foreground/76">Model proxy base URL</span>
                <input
                  className="theme-control-surface rounded-lg border border-border/45 px-3 py-2 text-[12px] text-foreground outline-none transition focus:border-primary/70"
                  type="url"
                  value={modelProxyBaseUrl}
                  onChange={(event) => setModelProxyBaseUrl(event.target.value)}
                  placeholder={DEFAULT_MODEL_PROXY_BASE_URL}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[10px] tracking-[0.12em] text-muted-foreground/76">Default model</span>
                <input
                  className="theme-control-surface rounded-lg border border-border/45 px-3 py-2 text-[12px] text-foreground outline-none transition focus:border-primary/70"
                  type="text"
                  value={defaultModel}
                  onChange={(event) => setDefaultModel(event.target.value)}
                  placeholder={DEFAULT_RUNTIME_MODEL}
                />
              </label>

              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  className="theme-control-surface rounded-[14px] border border-border/45 px-3 py-2 text-[11px] text-foreground transition hover:border-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void handleExchangeRuntimeBinding()}
                  disabled={isExchangingRuntimeBinding || !isSignedIn}
                >
                  {isExchangingRuntimeBinding ? "Refreshing..." : "Refresh runtime binding"}
                </button>
                <button
                  className="theme-control-surface rounded-[14px] border border-border/45 px-3 py-2 text-[11px] text-foreground transition hover:border-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void handleSaveRuntimeConfig()}
                  disabled={isSavingRuntimeConfig}
                >
                  {isSavingRuntimeConfig ? "Saving runtime config..." : "Save runtime config"}
                </button>
              </div>

              <div className="text-[10px] leading-4 text-muted-foreground/78">{runtimeSummary}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
