import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Search, User2, Loader2, Plus, ChevronDown, FolderKanban, Trash2, LayoutGrid } from "lucide-react";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

interface TopTabsBarProps {
  integratedTitleBar?: boolean;
  onWorkspaceSwitcherVisibilityChange?: (open: boolean) => void;
  onOpenMarketplace?: () => void;
  isMarketplaceActive?: boolean;
}

export function TopTabsBar({
  integratedTitleBar = false,
  onWorkspaceSwitcherVisibilityChange,
  onOpenMarketplace,
  isMarketplaceActive = false,
}: TopTabsBarProps) {
  const userButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceSwitcherRef = useRef<HTMLDivElement | null>(null);
  const workspaceSwitcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceSwitcherPopupRef = useRef<HTMLDivElement | null>(null);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceSwitcherPosition, setWorkspaceSwitcherPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceSelection();
  const {
    workspaces,
    selectedWorkspace,
    templateSourceMode,
    setTemplateSourceMode,
    createHarnessOptions,
    selectedCreateHarness,
    setSelectedCreateHarness,
    selectedTemplateFolder,
    marketplaceTemplates,
    selectedMarketplaceTemplate,
    selectMarketplaceTemplate,
    newWorkspaceName,
    setNewWorkspaceName,
    isCreatingWorkspace,
    deletingWorkspaceId,
    isLoadingMarketplaceTemplates,
    canUseMarketplaceTemplates,
    marketplaceTemplatesError,
    workspaceErrorMessage,
    chooseTemplateFolder,
    createWorkspace,
    deleteWorkspace
  } = useWorkspaceDesktop();

  const createDisabled =
    isCreatingWorkspace ||
    (templateSourceMode === "marketplace"
      ? !canUseMarketplaceTemplates || !selectedMarketplaceTemplate || selectedMarketplaceTemplate.is_coming_soon
      : templateSourceMode === "local"
        ? !selectedTemplateFolder?.rootPath
        : false);

  const onCreateWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createWorkspace();
  };

  const onDeleteWorkspace = async (workspace: WorkspaceRecordPayload) => {
    if (deletingWorkspaceId) {
      return;
    }
    const confirmed = window.confirm(`Delete workspace '${workspace.name}'?`);
    if (!confirmed) {
      return;
    }
    try {
      await deleteWorkspace(workspace.id);
    } catch {
      // workspaceErrorMessage is already set by the shared desktop state
    }
  };

  const closeWorkspaceSwitcher = () => {
    setWorkspaceSwitcherOpen(false);
    setCreatePanelOpen(false);
    setWorkspaceQuery("");
  };

  const updateWorkspaceSwitcherPosition = useCallback(() => {
    if (!workspaceSwitcherButtonRef.current || typeof window === "undefined") {
      return;
    }

    const rect = workspaceSwitcherButtonRef.current.getBoundingClientRect();
    const width = createPanelOpen
      ? Math.min(360, Math.max(rect.width + 88, 320))
      : Math.min(320, Math.max(rect.width + 56, 280));
    const left = Math.min(Math.max(24, rect.left), Math.max(24, window.innerWidth - width - 24));
    const top = rect.bottom + 8;
    const maxHeight = Math.max(220, window.innerHeight - top - 24);

    setWorkspaceSwitcherPosition({ top, left, width, maxHeight });
  }, [createPanelOpen]);

  const openAuthPopup = (anchor: DOMRect) => {
    void window.electronAPI.auth.showPopup({
      x: anchor.left,
      y: anchor.top,
      width: anchor.width,
      height: anchor.height
    });
  };

  const showUserMenu = () => {
    if (!userButtonRef.current) {
      return;
    }

    const anchor = userButtonRef.current.getBoundingClientRect();
    void window.electronAPI.auth.togglePopup({
      x: anchor.left,
      y: anchor.top,
      width: anchor.width,
      height: anchor.height
    });
  };

  const filteredWorkspaces = useMemo(() => {
    const query = workspaceQuery.trim().toLowerCase();
    if (!query) {
      return workspaces;
    }

    return workspaces.filter((workspace) => {
      return (
        workspace.name.toLowerCase().includes(query) ||
        workspace.status.toLowerCase().includes(query) ||
        (workspace.harness || "").toLowerCase().includes(query)
      );
    });
  }, [workspaceQuery, workspaces]);

  const handleTitleBarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (!integratedTitleBar) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (target.closest("button, input, select, textarea, a, [role='button'], .window-no-drag")) {
      return;
    }
    void window.electronAPI.ui.toggleWindowSize();
  };

  useEffect(() => {
    onWorkspaceSwitcherVisibilityChange?.(workspaceSwitcherOpen);
  }, [onWorkspaceSwitcherVisibilityChange, workspaceSwitcherOpen]);

  useEffect(() => {
    if (!workspaceSwitcherOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (workspaceSwitcherRef.current?.contains(target)) {
        return;
      }
      if (workspaceSwitcherPopupRef.current?.contains(target)) {
        return;
      }
      closeWorkspaceSwitcher();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [workspaceSwitcherOpen]);

  useEffect(() => {
    if (!workspaceSwitcherOpen) {
      return;
    }

    updateWorkspaceSwitcherPosition();

    const syncPosition = () => updateWorkspaceSwitcherPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [createPanelOpen, updateWorkspaceSwitcherPosition, workspaceSwitcherOpen]);

  const workspaceErrorOverlay =
    workspaceErrorMessage && typeof document !== "undefined"
      ? createPortal(
          <div className="pointer-events-none fixed inset-x-0 top-[72px] z-[90] flex justify-center px-4">
            <div
              className={`${integratedTitleBar ? "window-no-drag " : ""}theme-chat-system-bubble pointer-events-auto w-full max-w-[720px] rounded-[16px] border px-4 py-3 text-[12px] leading-6 shadow-card`}
            >
              {workspaceErrorMessage}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <header
      onDoubleClick={handleTitleBarDoubleClick}
      className={
        integratedTitleBar
          ? "window-drag relative h-[60px] px-2 sm:px-3"
          : "theme-shell rounded-[var(--theme-radius-card)] border border-neon-green/25 px-2.5 py-2.5 shadow-card sm:px-4"
      }
    >
      <div
        className={`relative z-10 grid min-w-0 items-center gap-2 sm:gap-3 lg:h-full lg:grid-cols-[minmax(320px,520px)_minmax(0,1fr)_auto] ${
          integratedTitleBar ? "pl-[86px]" : ""
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div ref={workspaceSwitcherRef} className={`${integratedTitleBar ? "window-no-drag " : ""}relative min-w-[220px] max-w-full`}>
            <button
              ref={workspaceSwitcherButtonRef}
              type="button"
              onClick={() => {
                setWorkspaceSwitcherOpen((open) => {
                  const nextOpen = !open;
                  if (!nextOpen) {
                    setCreatePanelOpen(false);
                    setWorkspaceQuery("");
                  } else {
                    requestAnimationFrame(() => {
                      updateWorkspaceSwitcherPosition();
                    });
                  }
                  return nextOpen;
                });
              }}
              className="theme-control-surface inline-flex h-11 w-full items-center gap-2 rounded-[18px] border border-panel-border/45 px-3.5 text-left text-[12px] text-text-main transition hover:border-neon-green/35"
            >
              <FolderKanban size={14} className="shrink-0 text-neon-green/85" />
              <span className="min-w-0 flex-1 truncate font-medium">{selectedWorkspace?.name || "Select workspace"}</span>
              <ChevronDown size={14} className={`shrink-0 transition ${workspaceSwitcherOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
        </div>

        <div className="hidden lg:block" />

        <div className={`${integratedTitleBar ? "window-no-drag " : ""}flex items-center justify-self-end gap-2`}>
          {onOpenMarketplace ? (
            <button
              type="button"
              aria-label="Marketplace"
              onClick={onOpenMarketplace}
              className={`inline-flex h-11 items-center gap-2 rounded-[18px] border px-3.5 text-[12px] font-medium transition-colors duration-200 ${
                isMarketplaceActive
                  ? "border-neon-green/35 bg-neon-green/10 text-neon-green"
                  : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
              }`}
            >
              <LayoutGrid size={14} />
              <span className="hidden sm:inline">Marketplace</span>
            </button>
          ) : null}
          <button
            ref={userButtonRef}
            type="button"
            aria-label="Open account menu"
            onClick={showUserMenu}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[18px] border border-panel-border/45 text-text-muted transition-colors duration-200 hover:border-neon-green/45 hover:bg-neon-green/10 hover:text-neon-green"
          >
            <User2 size={15} />
          </button>
        </div>
      </div>

      {workspaceSwitcherOpen && workspaceSwitcherPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={workspaceSwitcherPopupRef}
              className={`${integratedTitleBar ? "window-no-drag " : ""}fixed z-[80] rounded-[18px] border border-panel-border/70 bg-panel-bg px-3 py-3 shadow-card`}
              style={{
                top: workspaceSwitcherPosition.top,
                left: workspaceSwitcherPosition.left,
                width: workspaceSwitcherPosition.width,
                maxHeight: workspaceSwitcherPosition.maxHeight
              }}
            >
              <div className="theme-control-surface focus-shell mb-2 flex items-center gap-2 rounded-[14px] border border-panel-border/35 px-2.5 py-2">
                <Search size={13} className="text-neon-green/80" />
                <input
                  value={workspaceQuery}
                  onChange={(event) => setWorkspaceQuery(event.target.value)}
                  placeholder="Search workspaces"
                  className="embedded-input w-full bg-transparent text-[12px] text-text-main outline-none placeholder:text-text-dim/42"
                />
              </div>

              <div className="max-h-[240px] overflow-y-auto">
                {filteredWorkspaces.length ? (
                  <div className="grid gap-2">
                    {filteredWorkspaces.map((workspace) => {
                      const isActive = workspace.id === selectedWorkspaceId;
                      const isDeleting = deletingWorkspaceId === workspace.id;
                      return (
                        <div
                          key={workspace.id}
                          className={`flex items-stretch gap-2 rounded-[14px] border px-2 py-2 transition ${
                            isActive
                              ? "border-neon-green/45 bg-neon-green/10 text-text-main"
                              : "border-panel-border/35 bg-transparent text-text-main/86 hover:border-neon-green/30 hover:bg-[var(--theme-hover-bg)]"
                          } ${isDeleting ? "opacity-60" : ""}`}
                        >
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => {
                              setSelectedWorkspaceId(workspace.id);
                              closeWorkspaceSwitcher();
                            }}
                            className="min-w-0 flex-1 px-1 text-left disabled:cursor-not-allowed"
                          >
                            <div className="truncate text-[12px] font-medium">{workspace.name}</div>
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete workspace ${workspace.name}`}
                            disabled={Boolean(deletingWorkspaceId)}
                            onClick={() => void onDeleteWorkspace(workspace)}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-[12px] border border-panel-border/45 text-text-dim/72 transition hover:border-red-400/45 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-[14px] border border-panel-border/35 px-3 py-4 text-[12px] text-text-dim/78">
                    No workspaces matched your search.
                  </div>
                )}
              </div>

              <div className="mt-3 border-t border-panel-border/35 pt-3">
                <button
                  type="button"
                  onClick={() => setCreatePanelOpen((open) => !open)}
                  className="inline-flex h-10 w-full items-center justify-between gap-2 rounded-[16px] border border-neon-green/40 bg-neon-green/10 px-3 text-[12px] text-neon-green transition-all duration-200 hover:bg-neon-green/14 active:scale-[0.99]"
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus size={14} className={`transition-transform duration-200 ${createPanelOpen ? "rotate-45" : ""}`} />
                    <span>Create new workspace</span>
                  </span>
                  <ChevronDown size={14} className={`transition ${createPanelOpen ? "rotate-180" : ""}`} />
                </button>

                {createPanelOpen ? (
                  <form onSubmit={onCreateWorkspace} className="theme-subtle-surface mt-3 grid gap-2 rounded-[18px] border border-panel-border/45 p-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setTemplateSourceMode("local")}
                        className={`inline-flex h-[38px] items-center justify-center rounded-[14px] border px-3 text-[11px] transition ${
                          templateSourceMode === "local"
                            ? "border-neon-green/45 bg-neon-green/10 text-neon-green"
                            : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
                        }`}
                      >
                        Local folder
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemplateSourceMode("marketplace")}
                        className={`inline-flex h-[38px] items-center justify-center rounded-[14px] border px-3 text-[11px] transition ${
                          templateSourceMode === "marketplace"
                            ? "border-neon-green/45 bg-neon-green/10 text-neon-green"
                            : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
                        }`}
                      >
                        Marketplace
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemplateSourceMode("empty")}
                        className={`inline-flex h-[38px] items-center justify-center rounded-[14px] border px-3 text-[11px] transition ${
                          templateSourceMode === "empty"
                            ? "border-neon-green/45 bg-neon-green/10 text-neon-green"
                            : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
                        }`}
                      >
                        Empty
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemplateSourceMode("empty_onboarding")}
                        className={`inline-flex h-[38px] items-center justify-center rounded-[14px] border px-3 text-[11px] transition ${
                          templateSourceMode === "empty_onboarding"
                            ? "border-neon-green/45 bg-neon-green/10 text-neon-green"
                            : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
                        }`}
                      >
                        Empty + Onboarding
                      </button>
                    </div>

                    <div className="grid gap-2">
                      {templateSourceMode === "marketplace" ? (
                        canUseMarketplaceTemplates ? (
                          <label className="theme-control-surface flex min-w-0 items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 py-2 text-left text-[12px] text-text-muted/82">
                            <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">Template</span>
                            <select
                              value={selectedMarketplaceTemplate?.name || ""}
                              onChange={(event) => selectMarketplaceTemplate(event.target.value)}
                              disabled={isLoadingMarketplaceTemplates || marketplaceTemplates.length === 0}
                              className="min-w-0 flex-1 bg-transparent text-[12px] text-text-main outline-none disabled:text-text-dim/50"
                            >
                              {isLoadingMarketplaceTemplates ? (
                                <option value="">Loading templates...</option>
                              ) : marketplaceTemplates.length ? (
                                marketplaceTemplates.map((template) => (
                                  <option key={template.name} value={template.name} disabled={template.is_coming_soon}>
                                    {template.is_coming_soon ? `${template.name} (Coming soon)` : template.name}
                                  </option>
                                ))
                              ) : (
                                <option value="">No marketplace templates</option>
                              )}
                            </select>
                          </label>
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => openAuthPopup(event.currentTarget.getBoundingClientRect())}
                            className="inline-flex h-[42px] min-w-0 items-center justify-center rounded-[16px] border border-neon-green/40 bg-neon-green/10 px-3 text-[12px] text-neon-green transition hover:bg-neon-green/14"
                          >
                            Sign in to use Marketplace
                          </button>
                        )
                      ) : templateSourceMode === "empty" ? (
                        <div className="theme-control-surface min-w-0 rounded-[16px] border border-panel-border/45 px-3 py-2 text-[12px] text-text-muted/82">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-text-dim/72">Scaffold</div>
                          <div className="mt-1 text-text-main">workspace.yaml + AGENTS.md + empty skills folder</div>
                        </div>
                      ) : templateSourceMode === "empty_onboarding" ? (
                        <div className="theme-control-surface min-w-0 rounded-[16px] border border-panel-border/45 px-3 py-2 text-[12px] text-text-muted/82">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-text-dim/72">Scaffold</div>
                          <div className="mt-1 text-text-main">workspace.yaml + AGENTS.md + empty skills folder + ONBOARD.md</div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void chooseTemplateFolder()}
                          className="theme-control-surface flex min-w-0 items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 py-2 text-left text-[12px] text-text-muted/82 transition hover:border-neon-green/35"
                        >
                          <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">Template</span>
                          <span className="min-w-0 flex-1 truncate text-text-main">
                            {selectedTemplateFolder?.templateName || selectedTemplateFolder?.rootPath || "Choose folder"}
                          </span>
                        </button>
                      )}

                      <input
                        value={newWorkspaceName}
                        onChange={(event) => setNewWorkspaceName(event.target.value)}
                        placeholder="New workspace name"
                        className="theme-control-surface min-w-0 rounded-[16px] border border-panel-border/45 bg-transparent px-3 py-2 text-[12px] text-text-main outline-none placeholder:text-text-dim/40"
                      />

                      <label className="theme-control-surface flex min-w-0 items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 py-2 text-left text-[12px] text-text-muted/82">
                        <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">Harness</span>
                        <select
                          value={selectedCreateHarness}
                          onChange={(event) => setSelectedCreateHarness(event.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-[12px] text-text-main outline-none"
                        >
                          {createHarnessOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="submit"
                        disabled={createDisabled}
                        className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[16px] border border-neon-green/40 bg-neon-green/10 px-3 text-[12px] text-neon-green transition hover:bg-neon-green/14 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isCreatingWorkspace ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        <span>Create</span>
                      </button>
                    </div>

                    {templateSourceMode === "marketplace" ? (
                      <div className="text-[11px] text-text-dim/78">
                        {marketplaceTemplatesError
                          ? marketplaceTemplatesError
                          : selectedMarketplaceTemplate
                            ? selectedMarketplaceTemplate.long_description ||
                              selectedMarketplaceTemplate.description ||
                              "Marketplace template selected."
                            : canUseMarketplaceTemplates
                              ? "Choose a marketplace template to bootstrap this workspace."
                              : "Sign in and finish runtime setup to use marketplace templates."}
                      </div>
                    ) : templateSourceMode === "empty" ? (
                      <div className="text-[11px] text-text-dim/78">
                        Creates a minimal workspace with `workspace.yaml`, an empty `AGENTS.md`, and an empty `skills/` folder.
                      </div>
                    ) : templateSourceMode === "empty_onboarding" ? (
                      <div className="text-[11px] text-text-dim/78">
                        Creates the same minimal workspace shell, plus a starter `ONBOARD.md` so you can test the onboarding flow immediately.
                      </div>
                    ) : selectedTemplateFolder ? (
                      <div className="text-[11px] text-text-dim/78">
                        {selectedTemplateFolder.description || selectedTemplateFolder.rootPath || "Template folder selected."}
                      </div>
                    ) : null}
                  </form>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
      {workspaceErrorOverlay}
    </header>
  );
}
