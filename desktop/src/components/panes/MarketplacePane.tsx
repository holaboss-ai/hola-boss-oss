import { AppsGallery } from "@/components/marketplace/AppsGallery";
import { KitDetail } from "@/components/marketplace/KitDetail";
import { KitEmoji } from "@/components/marketplace/KitEmoji";
import { MarketplaceGallery } from "@/components/marketplace/MarketplaceGallery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { Loader2 } from "lucide-react";
import { useState } from "react";

type View = "gallery" | "detail" | "creating" | "connect_integrations";

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  reddit: "Reddit",
  twitter: "Twitter / X",
  linkedin: "LinkedIn",
};

function providerDisplayName(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

interface MarketplacePaneProps {
  initialTab?: "templates" | "apps";
}

export function MarketplacePane({ initialTab = "templates" }: MarketplacePaneProps = {}) {
  const {
    marketplaceTemplates,
    isLoadingMarketplaceTemplates,
    marketplaceTemplatesError,
    canUseMarketplaceTemplates,
    retryMarketplaceTemplates,
    selectMarketplaceTemplate,
    setTemplateSourceMode,
    newWorkspaceName,
    setNewWorkspaceName,
    isCreatingWorkspace,
    workspaceErrorMessage,
    createWorkspace,
    pendingIntegrations,
    isResolvingIntegrations,
    resolveIntegrationsBeforeCreate,
    clearPendingIntegrations,
  } = useWorkspaceDesktop();

  const [view, setView] = useState<View>("gallery");
  const [detailTemplate, setDetailTemplate] =
    useState<TemplateMetadataPayload | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(
    null,
  );
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
        owner_user_id: userId,
      });

      await window.electronAPI.ui.openExternalUrl(link.redirect_url);

      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await window.electronAPI.workspace.composioAccountStatus(
          link.connected_account_id,
        );
        if (status.status === "ACTIVE") {
          await window.electronAPI.workspace.composioFinalize({
            connected_account_id: link.connected_account_id,
            provider,
            owner_user_id: userId,
            account_label: `${provider} (Managed)`,
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

  return (
    <Tabs
      defaultValue={initialTab}
      className="flex h-full min-h-0 p-6 min-w-0 flex-col overflow-hidden bg-muted/50 shadow-xs border border-border rounded-xl"
    >
      <div className="max-w-4xl mx-auto w-full">
        <TabsList>
          <TabsTrigger value="templates" className="h-9 min-w-40">
            Templates
          </TabsTrigger>
          <TabsTrigger value="apps" className="h-9 min-w-40">
            Apps
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="templates"
        className="min-h-0 flex-1 overflow-auto px-5 py-4"
      >
        <div className="mx-auto max-w-4xl">
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
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setView("detail")}
                className="mb-4 self-start text-muted-foreground"
              >
                &larr; Back
              </Button>

              {isCreatingWorkspace ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="text-center">
                    <Loader2
                      size={16}
                      className="mx-auto animate-spin text-muted-foreground"
                    />
                    <div className="mt-2 text-sm text-muted-foreground">
                      Creating workspace…
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mx-auto w-full max-w-sm">
                  {detailTemplate ? (
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
                      <KitEmoji emoji={detailTemplate.emoji} size={24} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {detailTemplate.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {detailTemplate.apps.map((a) => a.name).join(", ")}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        onClick={() => setView("gallery")}
                        className="shrink-0 text-muted-foreground"
                      >
                        Change
                      </Button>
                    </div>
                  ) : null}

                  <label className="mt-4 block">
                    <span className="text-xs font-medium text-muted-foreground">
                      Workspace name
                    </span>
                    <Input
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      placeholder="My workspace"
                      className="mt-1.5 h-9"
                    />
                  </label>

                  {workspaceErrorMessage ? (
                    <div className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {workspaceErrorMessage}
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    size="lg"
                    disabled={
                      !newWorkspaceName.trim() || isResolvingIntegrations
                    }
                    onClick={handleCreate}
                    className="mt-4 w-full"
                  >
                    {isResolvingIntegrations
                      ? "Checking integrations…"
                      : "Create workspace"}
                  </Button>
                </div>
              )}
            </div>
          ) : view === "connect_integrations" && pendingIntegrations ? (
            <div className="flex h-full min-h-0 flex-col">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => {
                  clearPendingIntegrations();
                  setView("creating");
                }}
                className="mb-4 self-start text-muted-foreground"
              >
                &larr; Back
              </Button>
              <div className="mx-auto w-full max-w-sm">
                <h3 className="text-base font-semibold text-foreground">
                  Connect accounts
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  This workspace needs access to the following services.
                </p>
                <div className="mt-4 space-y-2">
                  {pendingIntegrations.missing_providers.map((provider) => (
                    <div
                      key={provider}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2.5"
                    >
                      <span className="text-sm font-medium text-foreground">
                        {providerDisplayName(provider)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        disabled={connectingProvider !== null}
                        onClick={() => void handleConnectProvider(provider)}
                      >
                        {connectingProvider === provider
                          ? "Connecting…"
                          : "Connect"}
                      </Button>
                    </div>
                  ))}
                </div>
                {connectStatus ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {connectStatus}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </TabsContent>

      <TabsContent
        value="apps"
        className="min-h-0 flex-1 overflow-auto px-5 py-4"
      >
        <div className="mx-auto max-w-4xl">
          <AppsGallery />
        </div>
      </TabsContent>
    </Tabs>
  );
}
