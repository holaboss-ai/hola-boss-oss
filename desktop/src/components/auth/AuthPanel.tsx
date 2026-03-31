import { useEffect, useState } from "react";
import {
  useDesktopAuthSession,
  type AuthSession
} from "@/lib/auth/authClient";

type AuthPanelView = "full" | "account" | "runtime";

interface AuthPanelProps {
  view?: AuthPanelView;
}

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

export function AuthPanel({ view = "full" }: AuthPanelProps) {
  const sessionState = useDesktopAuthSession();
  const session = sessionState.data;
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigPayload | null>(null);
  const [runtimeConfigDocument, setRuntimeConfigDocument] = useState("");
  const [sandboxId, setSandboxId] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isStartingSignIn, setIsStartingSignIn] = useState(false);
  const [isSavingRuntimeConfigDocument, setIsSavingRuntimeConfigDocument] = useState(false);
  const [isExchangingRuntimeBinding, setIsExchangingRuntimeBinding] = useState(false);

  async function refreshRuntimeConfig() {
    if (!window.electronAPI) {
      return;
    }
    const [config, document] = await Promise.all([
      window.electronAPI.runtime.getConfig(),
      window.electronAPI.runtime.getConfigDocument()
    ]);
    setRuntimeConfig(config);
    setRuntimeConfigDocument(document);
    setSandboxId(config.sandboxId ?? `desktop:${crypto.randomUUID()}`);
  }

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    let cancelled = false;
    void Promise.all([
      window.electronAPI.runtime.getConfig(),
      window.electronAPI.runtime.getConfigDocument()
    ]).then(([config, document]) => {
      if (cancelled) {
        return;
      }
      setRuntimeConfig(config);
      setRuntimeConfigDocument(document);
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
      setSandboxId(config.sandboxId ?? `desktop:${crypto.randomUUID()}`);
      setAuthError("");
      void window.electronAPI.runtime.getConfigDocument().then((document) => {
        setRuntimeConfigDocument(document);
      });
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
    if (sessionState.error) {
      setAuthError(sessionState.error.message);
    }
  }, [sessionState.error]);

  const isSignedIn = Boolean(sessionUserId(session));
  const showAccountSection = view !== "runtime";
  const showRuntimeSection = view !== "account";
  const runtimeBindingReady =
    Boolean(runtimeConfig?.authTokenPresent) &&
    Boolean((runtimeConfig?.sandboxId || "").trim()) &&
    Boolean((runtimeConfig?.modelProxyBaseUrl || "").trim());
  const isFinishingSetup = isSignedIn && !runtimeBindingReady && !authError;
  const statusTone = authError ? "error" : runtimeBindingReady ? "ready" : isFinishingSetup ? "syncing" : "idle";

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
        ? "border-neon-green/35 bg-neon-green/10 text-neon-green"
        : statusTone === "syncing"
          ? "border-amber-300/35 bg-amber-400/10 text-amber-300"
          : "border-panel-border/45 bg-black/10 text-text-dim/78";

  const infoRows = [
    {
      label: "Profile",
      value: isSignedIn ? "Connected" : "Sign in required"
    },
    {
      label: "Runtime",
      value: runtimeBindingReady ? "Ready on this desktop" : isSignedIn ? "Finishing setup" : "Offline"
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

  async function handleSaveRuntimeConfigDocument() {
    if (!window.electronAPI) {
      return;
    }

    setIsSavingRuntimeConfigDocument(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const nextConfig = await window.electronAPI.runtime.setConfigDocument(runtimeConfigDocument);
      setRuntimeConfig(nextConfig);
      const nextDocument = await window.electronAPI.runtime.getConfigDocument();
      setRuntimeConfigDocument(nextDocument);
      setAuthMessage("Runtime config file saved. The runtime was restarted with the new settings.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save runtime config file.");
    } finally {
      setIsSavingRuntimeConfigDocument(false);
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
      const nextDocument = await window.electronAPI.runtime.getConfigDocument();
      setRuntimeConfigDocument(nextDocument);
      setAuthMessage("Runtime binding refreshed and local runtime config updated.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to exchange runtime binding.");
    } finally {
      setIsExchangingRuntimeBinding(false);
    }
  }

  const runtimeConfigEditor = (
    <div className="theme-subtle-surface mt-3 grid gap-3 rounded-[18px] border border-panel-border/35 p-3">
      <div className="text-[10px] tracking-[0.16em] text-text-dim/76">RUNTIME PRODUCT CONFIG</div>
      <div className="text-[11px] leading-5 text-text-muted/84">
        Edit the runtime config file directly. Provider and model changes update the chat model picker by provider.
      </div>
      {runtimeConfig?.configPath ? (
        <div className="rounded-[12px] border border-panel-border/30 bg-black/10 px-2.5 py-2 font-mono text-[10px] text-text-dim/78">
          {runtimeConfig.configPath}
        </div>
      ) : null}
      <textarea
        className="theme-control-surface min-h-[220px] w-full resize-y rounded-[12px] border border-panel-border/45 px-3 py-2 font-mono text-[11px] leading-6 text-text-main outline-none transition focus:border-neon-green/70"
        value={runtimeConfigDocument}
        onChange={(event) => setRuntimeConfigDocument(event.target.value)}
        spellCheck={false}
      />

      <div className="mt-1 flex flex-wrap gap-2">
        <button
          className="theme-control-surface rounded-[14px] border border-panel-border/45 px-3 py-2 text-[11px] text-text-main transition hover:border-neon-green/35 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => void refreshRuntimeConfig()}
        >
          Reload config file
        </button>
        <button
          className="theme-control-surface rounded-[14px] border border-panel-border/45 px-3 py-2 text-[11px] text-text-main transition hover:border-neon-green/35 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => void handleSaveRuntimeConfigDocument()}
          disabled={isSavingRuntimeConfigDocument}
        >
          {isSavingRuntimeConfigDocument ? "Saving config file..." : "Save config file"}
        </button>
        <button
          className="theme-control-surface rounded-[14px] border border-panel-border/45 px-3 py-2 text-[11px] text-text-main transition hover:border-neon-green/35 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => void handleExchangeRuntimeBinding()}
          disabled={isExchangingRuntimeBinding || !isSignedIn}
        >
          {isExchangingRuntimeBinding ? "Refreshing..." : "Refresh runtime binding"}
        </button>
      </div>

    </div>
  );

  return (
    <section className="theme-shell w-full max-w-none overflow-hidden rounded-[24px] border border-panel-border/40 text-[11px] text-text-main/88 shadow-card">
      {showAccountSection && (
        <>
          <div className="border-b border-panel-border/40 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-neon-green/30 bg-neon-green/10 text-[16px] font-semibold text-neon-green">
                  {sessionInitials(session)}
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-text-main">
                    {isSignedIn ? sessionDisplayName(session) || "Holaboss account" : "Holaboss account"}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-text-muted/80">
                    {isSignedIn ? sessionEmail(session) || "Signed in" : "Not connected"}
                  </div>
                </div>
              </div>
              <div className={`shrink-0 rounded-full border px-3 py-1 text-[10px] tracking-[0.14em] ${badgeClassName}`}>{statusBadgeLabel}</div>
            </div>

            <div className="theme-subtle-surface mt-4 rounded-[18px] border border-panel-border/35 px-4 py-3">
              <div className="text-[13px] text-text-main">{statusTitle}</div>
              <div className="mt-1 text-[11px] leading-5 text-text-muted/82">{statusDescription}</div>
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="grid gap-2">
              {infoRows.map((row) => (
                <div
                  key={row.label}
                  className="theme-subtle-surface flex items-center justify-between gap-3 rounded-[16px] border border-panel-border/35 px-4 py-3"
                >
                  <div className="text-[11px] text-text-main/92">{row.label}</div>
                  <div className="max-w-[58%] truncate text-right text-[11px] text-text-muted/82">{row.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {!isSignedIn && (
                <button
                  className="inline-flex h-[42px] items-center justify-center rounded-[16px] border border-neon-green/40 bg-neon-green/10 px-4 text-[12px] text-neon-green transition hover:bg-neon-green/16 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void handleStartSignIn()}
                  disabled={isStartingSignIn}
                >
                  {isStartingSignIn ? "Opening sign-in..." : "Sign in with browser"}
                </button>
              )}

              {isSignedIn && !runtimeBindingReady && (
                <button
                  className="inline-flex h-[42px] items-center justify-center rounded-[16px] border border-neon-green/40 bg-neon-green/10 px-4 text-[12px] text-neon-green transition hover:bg-neon-green/16 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void handleExchangeRuntimeBinding()}
                  disabled={isExchangingRuntimeBinding}
                >
                  {isExchangingRuntimeBinding ? "Retrying setup..." : "Retry setup"}
                </button>
              )}

              <button
                className="theme-control-surface inline-flex h-[42px] items-center justify-center rounded-[16px] border border-panel-border/45 px-4 text-[12px] text-text-main transition hover:border-neon-green/35 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => void handleRefreshSession()}
                disabled={sessionState.isPending}
              >
                Refresh session
              </button>

              <button
                className="inline-flex h-[42px] items-center justify-center rounded-[16px] border border-[rgba(247,90,84,0.28)] bg-[rgba(247,90,84,0.08)] px-4 text-[12px] text-[rgba(206,92,84,0.96)] transition hover:border-[rgba(247,90,84,0.4)] hover:bg-[rgba(247,90,84,0.12)] disabled:cursor-not-allowed disabled:opacity-50"
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

            {(authMessage || authError) && (
              <div
                className={`mt-3 rounded-[16px] border px-4 py-3 text-[11px] ${
                  authError
                    ? "border-rose-400/35 bg-rose-500/8 text-rose-400"
                    : "border-neon-green/35 bg-neon-green/8 text-neon-green"
                }`}
              >
                {authError || authMessage}
              </div>
            )}
          </div>
        </>
      )}

      {!showAccountSection && showRuntimeSection && (
        <div className="px-4 py-4">
          <div className="text-[12px] uppercase tracking-[0.16em] text-text-dim/72">Runtime</div>
          <div className="mt-1 text-[12px] leading-5 text-text-muted/84">
            Configure model providers and defaults for this desktop runtime.
          </div>
          {runtimeConfigEditor}
          {(authMessage || authError) && (
            <div
              className={`mt-3 rounded-[16px] border px-4 py-3 text-[11px] ${
                authError
                  ? "border-rose-400/35 bg-rose-500/8 text-rose-400"
                  : "border-neon-green/35 bg-neon-green/8 text-neon-green"
              }`}
            >
              {authError || authMessage}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
