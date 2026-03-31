import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { MarketplaceGallery } from "@/components/marketplace/MarketplaceGallery";
import { KitDetail } from "@/components/marketplace/KitDetail";

type View = "gallery" | "detail" | "creating";

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
    createWorkspace
  } = useWorkspaceDesktop();

  const [view, setView] = useState<View>("gallery");
  const [detailTemplate, setDetailTemplate] = useState<TemplateMetadataPayload | null>(null);

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

  function handleCreate() {
    void createWorkspace();
  }

  const selectedHarnessOption =
    createHarnessOptions.find((o) => o.id === selectedCreateHarness) ?? createHarnessOptions[0];

  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.03),transparent_24%)]" />
      <div className="relative min-h-0 flex-1 overflow-auto p-4">
        {view === "gallery" ? (
          <MarketplaceGallery
            mode="browse"
            templates={marketplaceTemplates}
            isLoading={isLoadingMarketplaceTemplates}
            error={marketplaceTemplatesError || undefined}
            onSelectKit={handleSelectKit}
            onRetry={retryMarketplaceTemplates}
          />
        ) : view === "detail" && detailTemplate ? (
          <KitDetail
            template={detailTemplate}
            onBack={() => setView("gallery")}
            onSelect={handleUseKit}
            selectDisabled={!canUseMarketplaceTemplates}
            selectDisabledReason="Sign in required"
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
                  <Loader2 size={22} className="mx-auto animate-spin text-neon-green" />
                  <div className="mt-3 text-[14px] font-medium text-text-main">
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
                    <span className="text-[24px] leading-none">{detailTemplate.emoji || "📦"}</span>
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
                  disabled={!newWorkspaceName.trim()}
                  onClick={handleCreate}
                  className="mt-5 w-full rounded-[18px] border border-[rgba(247,90,84,0.38)] bg-[rgba(247,90,84,0.9)] px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-[rgba(247,90,84,1)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create workspace
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
