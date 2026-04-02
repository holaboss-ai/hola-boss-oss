import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { firstWorkspacePaneSectionClassName } from "@/components/layout/firstWorkspacePaneLayout";
import { MarketplaceGallery } from "@/components/marketplace/MarketplaceGallery";
import { KitDetail } from "@/components/marketplace/KitDetail";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { ConnectIntegrationsStep } from "./ConnectIntegrationsStep";
import { ConfigureStep } from "./ConfigureStep";
import { CreatingView } from "./CreatingView";
import { PROVIDER_DISPLAY_NAMES } from "./constants";
import { OnboardingUserButton } from "./OnboardingUserButton";

type OnboardingStep = "gallery" | "detail" | "configure" | "connect_integrations";

interface FirstWorkspacePaneProps {
  variant?: "full" | "panel";
  onClose?: () => void;
}

export function FirstWorkspacePane({
  variant = "full",
  onClose,
}: FirstWorkspacePaneProps) {
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
  const [connectingProvider, setConnectingProvider] = useState<string | null>(
    null,
  );
  const [connectStatus, setConnectStatus] = useState("");
  const [detailKit, setDetailKit] = useState<TemplateMetadataPayload | null>(
    null,
  );

  const isPanelVariant = variant === "panel";

  // Auto-resolve integrations when entering configure step
  const configureStepActive = step === "configure";
  const prevConfigureRef = useRef(false);
  useEffect(() => {
    if (configureStepActive && !prevConfigureRef.current) {
      void resolveIntegrationsBeforeCreate();
    }
    prevConfigureRef.current = configureStepActive;
  }, [configureStepActive, resolveIntegrationsBeforeCreate]);

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

      for (let i = 0; i < 100; i += 1) {
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

  const sectionClassName = isPanelVariant
    ? [
        "relative",
        "h-full",
        "min-h-0",
        "min-w-0",
        "overflow-hidden",
        "px-3",
        "py-3",
        "sm:px-4",
        "sm:py-4",
      ].join(" ")
    : firstWorkspacePaneSectionClassName(step);
  const creatingViaMarketplace =
    templateSourceMode === "marketplace" && canUseMarketplaceTemplates;

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

  const content = isCreatingWorkspace ? (
    <CreatingView
      sectionClassName={sectionClassName}
      creatingViaMarketplace={creatingViaMarketplace}
      showUserButton={!isPanelVariant}
    />
  ) : (
    <section className={sectionClassName}>
      {!isPanelVariant ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(247,90,84,0.08),transparent_28%),radial-gradient(circle_at_86%_14%,rgba(233,117,109,0.08),transparent_30%)]" />
      ) : null}
      {!isPanelVariant ? (
        <div className="absolute right-4 top-4 z-10">
          <OnboardingUserButton />
        </div>
      ) : null}
      <div
        className={`w-full ${isPanelVariant ? "h-full max-w-[1020px]" : "max-w-[1080px]"}`}
      >
        <div
          className={`theme-shell w-full rounded-[var(--radius-xl)] border border-border/45 px-6 py-6 shadow-lg sm:px-8 sm:py-7 lg:px-10 lg:py-8 ${
            isPanelVariant ? "h-full overflow-hidden" : ""
          }`}
        >
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
              onConnect={(provider) => void handleConnectProvider(provider)}
              onCreate={() => void createWorkspace()}
            />
          ) : step === "connect_integrations" && pendingIntegrations ? (
            <ConnectIntegrationsStep
              pendingIntegrations={pendingIntegrations}
              connectingProvider={connectingProvider}
              connectStatus={connectStatus}
              onConnect={(provider) => void handleConnectProvider(provider)}
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

  if (!isPanelVariant) {
    return content;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center px-4 py-6">
      <button
        type="button"
        aria-label="Close create workspace"
        onClick={onClose}
        className="pointer-events-auto absolute inset-0 bg-[rgba(7,10,14,0.46)] backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create workspace"
        className="pointer-events-auto relative z-10 h-[min(860px,calc(100vh-44px))] w-[min(1120px,calc(100vw-32px))]"
      >
        <button
          type="button"
          aria-label="Close create workspace"
          onClick={onClose}
          className="absolute right-6 top-6 z-30 grid h-10 w-10 place-items-center rounded-full border border-black/15 bg-white/95 text-foreground shadow-md backdrop-blur transition hover:bg-white"
        >
          <X size={16} />
        </button>
        {content}
      </div>
    </div>
  );
}
