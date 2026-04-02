import { useEffect, useRef, useState } from "react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { firstWorkspacePaneSectionClassName } from "@/components/layout/firstWorkspacePaneLayout";
import { MarketplaceGallery } from "@/components/marketplace/MarketplaceGallery";
import { KitDetail } from "@/components/marketplace/KitDetail";
import { OnboardingUserButton } from "./OnboardingUserButton";
import { CreatingView } from "./CreatingView";
import { ConfigureStep } from "./ConfigureStep";
import { ConnectIntegrationsStep } from "./ConnectIntegrationsStep";
import { PROVIDER_DISPLAY_NAMES } from "./constants";

type OnboardingStep = "gallery" | "detail" | "configure" | "connect_integrations";

export function FirstWorkspacePane() {
  const {
    templateSourceMode,
    setTemplateSourceMode,
    selectedTemplateFolder,
    marketplaceTemplates,
    selectedMarketplaceTemplate,
    selectMarketplaceTemplate,
    newWorkspaceName,
    setNewWorkspaceName,
    isCreatingWorkspace,
    isLoadingMarketplaceTemplates,
    canUseMarketplaceTemplates,
    marketplaceTemplatesError,
    retryMarketplaceTemplates,
    workspaceErrorMessage,
    chooseTemplateFolder,
    createWorkspace,
    pendingIntegrations,
    isResolvingIntegrations,
    resolveIntegrationsBeforeCreate,
    clearPendingIntegrations,
  } = useWorkspaceDesktop();

  const [step, setStep] = useState<OnboardingStep>("gallery");
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState("");
  const [detailKit, setDetailKit] = useState<TemplateMetadataPayload | null>(null);

  // Auto-resolve integrations when entering configure step
  const configureStepActive = step === "configure";
  const prevConfigureRef = useRef(false);
  useEffect(() => {
    if (configureStepActive && !prevConfigureRef.current) {
      void resolveIntegrationsBeforeCreate();
    }
    prevConfigureRef.current = configureStepActive;
  }, [configureStepActive]);

  const hasUnconnectedIntegrations = pendingIntegrations
    ? pendingIntegrations.missing_providers.length > 0
    : false;

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
            account_label: `${PROVIDER_DISPLAY_NAMES[provider] ?? provider} (Managed)`,
          });
          setConnectStatus("");
          setConnectingProvider(null);
          void resolveIntegrationsBeforeCreate();
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

  const sectionClassName = firstWorkspacePaneSectionClassName(step);
  const creatingViaMarketplace =
    templateSourceMode === "marketplace" && canUseMarketplaceTemplates;

  // --- Creating state ---
  if (isCreatingWorkspace) {
    return (
      <CreatingView
        sectionClassName={sectionClassName}
        creatingViaMarketplace={creatingViaMarketplace}
      />
    );
  }

  // --- Auth helper ---
  const openAuthPopup = () => {
    void window.electronAPI.auth.requestAuth();
  };

  // --- Step handlers ---
  function handleSelectKitFromGallery(template: TemplateMetadataPayload) {
    setDetailKit(template);
    setStep("detail");
  }

  function handleUseKit(template: TemplateMetadataPayload) {
    selectMarketplaceTemplate(template.name);
    setTemplateSourceMode("marketplace");
    if (!newWorkspaceName.trim()) {
      setNewWorkspaceName(template.name);
    }
    setStep("configure");
  }

  function handleStartFromScratch() {
    setTemplateSourceMode("empty");
    setStep("configure");
  }

  function handleUseLocalTemplate() {
    void chooseTemplateFolder().then(() => {
      setStep("configure");
    });
  }

  const configureCreateDisabled =
    !newWorkspaceName.trim() ||
    (templateSourceMode === "marketplace" &&
      (!canUseMarketplaceTemplates || !selectedMarketplaceTemplate));

  // --- Render ---
  return (
    <section className={sectionClassName}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(247,90,84,0.08),transparent_28%),radial-gradient(circle_at_86%_14%,rgba(233,117,109,0.08),transparent_30%)]" />
      <div className="absolute right-4 top-4 z-10">
        <OnboardingUserButton />
      </div>
      <div className="w-full max-w-[1080px]">
        <div className="theme-shell w-full rounded-[var(--radius-xl)] border border-border/45 px-6 py-6 shadow-lg sm:px-8 sm:py-7 lg:px-10 lg:py-8">
          {step === "gallery" ? (
            <MarketplaceGallery
              mode="pick"
              templates={marketplaceTemplates}
              isLoading={isLoadingMarketplaceTemplates}
              authenticated={canUseMarketplaceTemplates}
              error={marketplaceTemplatesError || undefined}
              onSelectKit={handleSelectKitFromGallery}
              onRetry={retryMarketplaceTemplates}
              onSignIn={openAuthPopup}
              onStartFromScratch={handleStartFromScratch}
              onUseLocalTemplate={handleUseLocalTemplate}
            />
          ) : step === "detail" && detailKit ? (
            <KitDetail
              template={detailKit}
              onBack={() => setStep("gallery")}
              onSelect={handleUseKit}
              selectDisabled={!canUseMarketplaceTemplates}
              selectDisabledReason="Sign in required"
              onSignIn={openAuthPopup}
            />
          ) : step === "configure" ? (
            <ConfigureStep
              templateSourceMode={templateSourceMode}
              selectedMarketplaceTemplate={selectedMarketplaceTemplate}
              selectedTemplateFolder={selectedTemplateFolder}
              newWorkspaceName={newWorkspaceName}
              setNewWorkspaceName={setNewWorkspaceName}
              pendingIntegrations={pendingIntegrations}
              isResolvingIntegrations={isResolvingIntegrations}
              connectingProvider={connectingProvider}
              connectStatus={connectStatus}
              workspaceErrorMessage={workspaceErrorMessage}
              createDisabled={configureCreateDisabled}
              hasUnconnectedIntegrations={hasUnconnectedIntegrations}
              onChangeKit={() => setStep("gallery")}
              onChangeFolder={() => void chooseTemplateFolder()}
              onBackToKits={() => setStep("gallery")}
              onConnect={(p) => void handleConnectProvider(p)}
              onCreate={() => void createWorkspace()}
            />
          ) : step === "connect_integrations" && pendingIntegrations ? (
            <ConnectIntegrationsStep
              pendingIntegrations={pendingIntegrations}
              connectingProvider={connectingProvider}
              connectStatus={connectStatus}
              onConnect={(p) => void handleConnectProvider(p)}
              onBack={() => {
                clearPendingIntegrations();
                setStep("configure");
              }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
