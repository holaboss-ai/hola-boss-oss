import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { firstWorkspacePaneSectionClassName } from "@/components/layout/firstWorkspacePaneLayout";
import { MarketplaceGallery } from "@/components/marketplace/MarketplaceGallery";
import { KitDetail } from "@/components/marketplace/KitDetail";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { BrowserProfileStep } from "./BrowserProfileStep";
import { ConnectIntegrationsStep } from "./ConnectIntegrationsStep";
import { ConfigureStep } from "./ConfigureStep";
import { CreatingView } from "./CreatingView";
import { SelectAppsStep } from "./SelectAppsStep";
import { PROVIDER_DISPLAY_NAMES } from "./constants";
import { OnboardingUserButton } from "./OnboardingUserButton";

type OnboardingStep =
  | "gallery"
  | "detail"
  | "select_apps"
  | "configure"
  | "browser_profile"
  | "connect_integrations";

const IMPORT_PROFILE_LIST_HANDLER_MISSING_MESSAGE =
  "No handler registered for 'workspace:listImportBrowserProfiles'";

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
    workspaces,
    newWorkspaceName,
    setNewWorkspaceName,
    browserBootstrapMode,
    setBrowserBootstrapMode,
    browserBootstrapSourceWorkspaceId,
    setBrowserBootstrapSourceWorkspaceId,
    browserImportSource,
    setBrowserImportSource,
    browserImportProfileDir,
    setBrowserImportProfileDir,
    workspaceCreatePhase,
    isCreatingWorkspace,
    isLoadingMarketplaceTemplates,
    canUseMarketplaceTemplates,
    marketplaceTemplatesError,
    retryMarketplaceTemplates,
    workspaceErrorMessage,
    chooseTemplateFolder,
    createWorkspace,
    selectedApps,
    setSelectedApps,
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
  const [importProfiles, setImportProfiles] = useState<
    BrowserImportProfileOptionPayload[]
  >([]);
  const [importProfilesLoading, setImportProfilesLoading] = useState(false);
  const [importProfilesError, setImportProfilesError] = useState("");

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

  useEffect(() => {
    if (browserBootstrapMode !== "import_browser") {
      setImportProfiles([]);
      setImportProfilesLoading(false);
      setImportProfilesError("");
      return;
    }

    if (browserImportSource === "safari") {
      setImportProfiles([]);
      setImportProfilesLoading(false);
      setImportProfilesError("");
      setBrowserImportProfileDir("");
      return;
    }

    if (step !== "browser_profile") {
      return;
    }

    let cancelled = false;
    setImportProfilesLoading(true);
    setImportProfilesError("");
    void window.electronAPI.workspace
      .listImportBrowserProfiles(browserImportSource)
      .then((profiles) => {
        if (cancelled) {
          return;
        }
        setImportProfiles(profiles);
        if (
          profiles.length > 0 &&
          !profiles.some((profile) => profile.profileDir === browserImportProfileDir)
        ) {
          setBrowserImportProfileDir(profiles[0]?.profileDir ?? "");
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error ? error.message : String(error);
        if (message.includes(IMPORT_PROFILE_LIST_HANDLER_MISSING_MESSAGE)) {
          setImportProfiles([]);
          setImportProfilesError(
            "Profile list is unavailable in this desktop session. Continue to create the workspace and choose the profile in the import dialog.",
          );
          return;
        }
        setImportProfiles([]);
        setImportProfilesError(
          error instanceof Error
            ? error.message
            : "Could not load browser profiles.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setImportProfilesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    step,
    browserBootstrapMode,
    browserImportSource,
  ]);

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
    // Route to app selection if template has optional apps
    const hasOptional = template.apps.some((a) => !a.required);
    setStep(hasOptional ? "select_apps" : "configure");
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

  const configureContinueDisabled =
    !newWorkspaceName.trim() ||
    (templateSourceMode === "marketplace" &&
      (!canUseMarketplaceTemplates || !selectedMarketplaceTemplate));

  const browserStepCreateDisabled =
    !newWorkspaceName.trim() ||
    hasUnconnectedIntegrations ||
    isResolvingIntegrations ||
    connectingProvider !== null ||
    (browserBootstrapMode === "copy_workspace" &&
      !browserBootstrapSourceWorkspaceId.trim()) ||
    (browserBootstrapMode === "import_browser" &&
      browserImportSource !== "safari" &&
      !browserImportProfileDir.trim() &&
      !importProfilesError.includes("Profile list is unavailable")) ||
    (templateSourceMode === "marketplace" &&
      (!canUseMarketplaceTemplates || !selectedMarketplaceTemplate));

  const content = isCreatingWorkspace ? (
    <CreatingView
      sectionClassName={sectionClassName}
      creatingViaMarketplace={creatingViaMarketplace}
      showUserButton={!isPanelVariant}
      panelVariant={isPanelVariant}
      browserBootstrapMode={browserBootstrapMode}
      workspaceCreatePhase={workspaceCreatePhase}
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
          className={`theme-shell w-full rounded-xl border border-border/45 px-6 py-6 shadow-lg sm:px-8 sm:py-7 lg:px-10 lg:py-8 ${
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
          ) : step === "select_apps" && selectedMarketplaceTemplate ? (
            <SelectAppsStep
              template={selectedMarketplaceTemplate}
              selectedApps={selectedApps}
              onToggleApp={(appName) => {
                const app = selectedMarketplaceTemplate.apps.find(
                  (a) => a.name === appName,
                );
                if (app?.required) {
                  return;
                }
                setSelectedApps((prev) => {
                  const next = new Set(prev);
                  if (next.has(appName)) {
                    next.delete(appName);
                  } else {
                    next.add(appName);
                  }
                  return next;
                });
              }}
              onBack={() => setStep("detail")}
              onContinue={() => setStep("configure")}
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
              continueDisabled={configureContinueDisabled}
              hasUnconnectedIntegrations={hasUnconnectedIntegrations}
              onChangeKit={() => setStep("gallery")}
              onChangeFolder={() => void chooseTemplateFolder()}
              onCancel={() => setStep("gallery")}
              onConnect={(provider) => void handleConnectProvider(provider)}
              onContinue={() => setStep("browser_profile")}
            />
          ) : step === "browser_profile" ? (
            <BrowserProfileStep
              browserBootstrapMode={browserBootstrapMode}
              setBrowserBootstrapMode={setBrowserBootstrapMode}
              browserBootstrapSourceWorkspaceId={browserBootstrapSourceWorkspaceId}
              setBrowserBootstrapSourceWorkspaceId={setBrowserBootstrapSourceWorkspaceId}
              copySourceWorkspaces={workspaces}
              browserImportSource={browserImportSource}
              setBrowserImportSource={setBrowserImportSource}
              browserImportProfileDir={browserImportProfileDir}
              setBrowserImportProfileDir={setBrowserImportProfileDir}
              importProfiles={importProfiles}
              importProfilesLoading={importProfilesLoading}
              importProfilesError={importProfilesError}
              workspaceErrorMessage={workspaceErrorMessage}
              createDisabled={browserStepCreateDisabled}
              onBack={() => setStep("configure")}
              onCancel={() => setStep("gallery")}
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
