import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { MarketplaceGallery } from "@/components/marketplace/MarketplaceGallery";
import { KitDetail } from "@/components/marketplace/KitDetail";
import { KitEmoji } from "@/components/marketplace/KitEmoji";

type View = "gallery" | "detail" | "creating" | "connect_integrations";

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  reddit: "Reddit",
  twitter: "Twitter / X",
  linkedin: "LinkedIn"
};

function providerDisplayName(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

export function MarketplacePane() {
  const {
    marketplaceTemplates,
    isLoadingMarketplaceTemplates,
    marketplaceTemplatesError,
    canUseMarketplaceTemplates,
    retryMarketplaceTemplates,
    selectMarketplaceTemplate,
    setTemplateSourceMode,
    createHarnessOptions,
    selectedCreateHarness,
    setSelectedCreateHarness,
    newWorkspaceName,
    setNewWorkspaceName,
    isCreatingWorkspace,
    workspaceErrorMessage,
    createWorkspace,
    pendingIntegrations,
    isResolvingIntegrations,
    resolveIntegrationsBeforeCreate,
    clearPendingIntegrations
  } = useWorkspaceDesktop();

  const [view, setView] = useState<View>("gallery");
  const [detailTemplate, setDetailTemplate] = useState<TemplateMetadataPayload | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState("");

  function handleSelectKit(template: TemplateMetadataPayload) {
    setDetailTemplate(template);
    setView("detail");
  }

  function handleUseKit(template: TemplateMetadataPayload) {
    selectMarketplaceTemplate(template.name);
    setTemplateSourceMode("marketplace");
    if (!newWorkspaceName.trim()) {
      setNewWorkspaceName(template.name);
    }
    setView("creating");
  }

  async function handleCreate() {
    const pending = await resolveIntegrationsBeforeCreate();
    if (pending && pending.missing_providers.length > 0) {
      setView("connect_integrations");
      return;
    }
    void createWorkspace();
  }

  async function handleConnectProvider(provider: string) {
    setConnectingProvider(provider);
    setConnectStatus("Complete authorization in your browser...");
    try {
      const runtimeConfig = await window.electronAPI.runtime.getConfig();
      const userId = runtimeConfig.userId ?? "local";

      const link = await window.electronAPI.workspace.composioConnect({
        provider,
        owner_user_id: userId
      });

      await window.electronAPI.ui.openExternalUrl(link.redirect_url);

      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await window.electronAPI.workspace.composioAccountStatus(link.connected_account_id);
        if (status.status === "ACTIVE") {
          await window.electronAPI.workspace.composioFinalize({
            connected_account_id: link.connected_account_id,
            provider,
            owner_user_id: userId,
            account_label: `${provider} (Managed)`
          });
          setConnectStatus("");
          setConnectingProvider(null);

          const updated = await resolveIntegrationsBeforeCreate();
          if (!updated || updated.missing_providers.length === 0) {
            clearPendingIntegrations();
            setView("creating");
            void createWorkspace();
          }
          return;
        }
      }
      setConnectStatus("Connection timed out. Please try again.");
    } catch (error) {
      setConnectStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setConnectingProvider(null);
    }
  }

  const selectedHarnessOption =
    createHarnessOptions.find((o) => o.id === selectedCreateHarness) ?? createHarnessOptions[0];

  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.03),transparent_24%)]" />
      <div className="relative min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-5xl">
        {view === "gallery" ? (
          <MarketplaceGallery
            mode="browse"
            templates={marketplaceTemplates}
            isLoading={isLoadingMarketplaceTemplates}
            authenticated={canUseMarketplaceTemplates}
            error={marketplaceTemplatesError || undefined}
            onSelectKit={handleSelectKit}
            onRetry={retryMarketplaceTemplates}
            onSignIn={() => void window.electronAPI.auth.requestAuth()}
          />
        ) : view === "detail" && detailTemplate ? (
          <KitDetail
            template={detailTemplate}
            onBack={() => setView("gallery")}
            onSelect={handleUseKit}
            selectDisabled={!canUseMarketplaceTemplates}
            selectDisabledReason="Sign in required"
            onSignIn={() => void window.electronAPI.auth.requestAuth()}
          />
        ) : view === "creating" ? (
          <div className="flex h-full min-h-0 flex-col">
            <button
              type="button"
              onClick={() => setView("detail")}
              className="mb-4 self-start text-[12px] text-text-muted/76 underline transition-colors hover:text-text-main"
            >
              &larr; Back to kit details
            </button>

            {isCreatingWorkspace ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <Loader2 size={18} className="mx-auto animate-spin text-text-dim/60" />
                  <div className="mt-3 text-[13px] font-medium text-text-main">
                    Creating workspace...
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-md">
                <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">
                  Create workspace
                </div>
                <div className="mt-1 text-[20px] font-semibold tracking-[-0.03em] text-text-main">
                  Configure &amp; launch
                </div>

                {detailTemplate ? (
                  <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-3 py-2.5">
                    <KitEmoji emoji={detailTemplate.emoji} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-text-main">{detailTemplate.name}</div>
                      <div className="truncate text-[11px] text-text-muted/72">{detailTemplate.apps.join(", ")}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setView("gallery")}
                      className="shrink-0 text-[11px] text-text-muted/72 underline transition-colors hover:text-text-main"
                    >
                      Change
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">
                      Workspace name
                    </span>
                    <input
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      placeholder="My workspace"
                      className="theme-control-surface h-12 rounded-[18px] border border-panel-border/45 px-4 text-[14px] text-text-main outline-none placeholder:text-text-dim/50"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-[0.22em] text-text-dim/78">
                      Harness
                    </span>
                    <select
                      value={selectedCreateHarness}
                      onChange={(e) => setSelectedCreateHarness(e.target.value)}
                      className="theme-control-surface h-12 rounded-[18px] border border-panel-border/45 px-4 text-[14px] text-text-main outline-none"
                    >
                      {createHarnessOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-[12px] leading-6 text-text-muted/74">
                      {selectedHarnessOption?.description || ""}
                    </span>
                  </label>
                </div>

                {workspaceErrorMessage ? (
                  <div className="mt-3 rounded-[12px] border border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.06)] px-3 py-2 text-[12px] text-[rgba(255,153,102,0.92)]">
                    {workspaceErrorMessage}
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={!newWorkspaceName.trim() || isResolvingIntegrations}
                  onClick={handleCreate}
                  className="mt-5 w-full rounded-[18px] border border-[rgba(247,90,84,0.38)] bg-[rgba(247,90,84,0.9)] px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-[rgba(247,90,84,1)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isResolvingIntegrations ? "Checking integrations..." : "Create workspace"}
                </button>
              </div>
            )}
          </div>
        ) : view === "connect_integrations" && pendingIntegrations ? (
          <div className="flex h-full min-h-0 flex-col">
            <button
              type="button"
              onClick={() => { clearPendingIntegrations(); setView("creating"); }}
              className="mb-4 self-start text-[12px] text-text-muted/76 underline transition-colors hover:text-text-main"
            >
              &larr; Back
            </button>
            <div className="mx-auto w-full max-w-md">
              <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">Connect integrations</div>
              <div className="mt-1 text-[20px] font-semibold tracking-[-0.03em] text-text-main">This workspace needs access</div>
              <div className="mt-2 text-[13px] leading-7 text-text-muted/84">Connect the following accounts to continue.</div>
              <div className="mt-4 grid gap-3">
                {pendingIntegrations.missing_providers.map((provider) => (
                  <div key={provider} className="flex items-center justify-between rounded-[14px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-4 py-3">
                    <div className="text-[13px] font-medium text-text-main">{providerDisplayName(provider)}</div>
                    <button
                      type="button"
                      disabled={connectingProvider !== null}
                      onClick={() => void handleConnectProvider(provider)}
                      className="rounded-[12px] border border-neon-green/35 bg-neon-green/8 px-3 py-1.5 text-[11px] font-medium text-neon-green transition-colors hover:bg-neon-green/14 disabled:opacity-50"
                    >
                      {connectingProvider === provider ? "Connecting..." : "Connect"}
                    </button>
                  </div>
                ))}
                {pendingIntegrations.connected_providers.map((provider) => (
                  <div key={provider} className="flex items-center justify-between rounded-[14px] border border-neon-green/20 bg-neon-green/4 px-4 py-3">
                    <div className="text-[13px] font-medium text-text-main">{providerDisplayName(provider)}</div>
                    <span className="text-[11px] text-neon-green">Connected</span>
                  </div>
                ))}
              </div>
              {connectStatus ? (
                <div className="mt-3 text-[12px] text-text-muted">{connectStatus}</div>
              ) : null}
            </div>
          </div>
        ) : null}
        </div>
      </div>
    </section>
  );
}
