import { FormEvent, useMemo, useRef, useState } from "react";
import { Search, User2, Palette, Loader2, Plus, RefreshCcw, ChevronDown, FolderKanban, FolderOpen, Globe } from "lucide-react";
import type { AppTheme } from "@/components/layout/AppShell";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

interface TopTabsBarProps {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  agentMode?: boolean;
  hasWorkspaces?: boolean;
  onUserMenuToggle?: (anchorBounds: BrowserAnchorBoundsPayload) => void;
  onOpenBrowserWorkbench?: () => void;
  onOpenFilesWorkbench?: () => void;
  activeWorkbenchTab?: "browser" | "files" | null;
  workbenchOpen?: boolean;
}

const THEME_OPTIONS: Array<{ value: AppTheme; label: string }> = [
  { value: "emerald", label: "Emerald" },
  { value: "cobalt", label: "Cobalt" },
  { value: "ember", label: "Ember" },
  { value: "glacier", label: "Glacier" },
  { value: "mono", label: "Mono" },
  { value: "claude", label: "Claude" },
  { value: "slate", label: "Slate" },
  { value: "paper", label: "Paper" },
  { value: "graphite", label: "Graphite" }
];

export function TopTabsBar({
  theme,
  onThemeChange,
  agentMode = true,
  hasWorkspaces = true,
  onUserMenuToggle,
  onOpenBrowserWorkbench,
  onOpenFilesWorkbench,
  activeWorkbenchTab,
  workbenchOpen
}: TopTabsBarProps) {
  const userButtonRef = useRef<HTMLButtonElement | null>(null);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceSelection();
  const {
    workspaces,
    selectedWorkspace,
    templateSourceMode,
    setTemplateSourceMode,
    selectedTemplateFolder,
    marketplaceTemplates,
    selectedMarketplaceTemplate,
    selectMarketplaceTemplate,
    newWorkspaceName,
    setNewWorkspaceName,
    isLoadingBootstrap,
    isRefreshing,
    isCreatingWorkspace,
    isLoadingMarketplaceTemplates,
    canUseMarketplaceTemplates,
    marketplaceTemplatesError,
    workspaceErrorMessage,
    refreshWorkspaceData,
    chooseTemplateFolder,
    createWorkspace
  } = useWorkspaceDesktop();

  const onCreateWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createWorkspace();
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

  return (
    <header className="theme-shell rounded-[var(--theme-radius-card)] border border-neon-green/25 px-2.5 py-2.5 shadow-card sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:gap-3">
          <button
            ref={userButtonRef}
            type="button"
            aria-label="Open account menu"
            onClick={() => {
              if (!onUserMenuToggle || !userButtonRef.current) {
                return;
              }

              const rect = userButtonRef.current.getBoundingClientRect();
              onUserMenuToggle({
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
              });
            }}
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--theme-radius-pill)] border border-neon-green/45 bg-neon-green/10 text-neon-green shadow-glow transition hover:border-neon-green/70 hover:bg-neon-green/16"
          >
            <User2 size={15} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] max-w-full">
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceSwitcherOpen((open) => !open);
                    setCreatePanelOpen(false);
                  }}
                  className="theme-control-surface inline-flex w-full items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 py-2 text-left text-[12px] text-text-main transition hover:border-neon-green/35"
                >
                  <FolderKanban size={14} className="shrink-0 text-neon-green/85" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{selectedWorkspace?.name || "Select workspace"}</span>
                    <span className="block truncate text-[10px] uppercase tracking-[0.14em] text-text-dim/72">
                      {selectedWorkspace ? selectedWorkspace.status : workspaces.length ? `${workspaces.length} available` : "No workspaces yet"}
                    </span>
                  </span>
                  <ChevronDown size={14} className={`shrink-0 transition ${workspaceSwitcherOpen ? "rotate-180" : ""}`} />
                </button>

                {workspaceSwitcherOpen ? (
                  <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-[min(360px,calc(100vw-48px))] rounded-[18px] border border-panel-border/70 bg-panel-bg px-3 py-3 shadow-card">
                    <div className="mb-2 flex items-center gap-2">
                      <Search size={13} className="text-neon-green/80" />
                      <input
                        value={workspaceQuery}
                        onChange={(event) => setWorkspaceQuery(event.target.value)}
                        placeholder="Search workspaces"
                        className="w-full bg-transparent text-[12px] text-text-main outline-none placeholder:text-text-dim/42"
                      />
                    </div>

                    <div className="max-h-[240px] overflow-y-auto">
                      {filteredWorkspaces.length ? (
                        <div className="grid gap-2">
                          {filteredWorkspaces.map((workspace) => {
                            const isActive = workspace.id === selectedWorkspaceId;
                            return (
                              <button
                                key={workspace.id}
                                type="button"
                                onClick={() => {
                                  setSelectedWorkspaceId(workspace.id);
                                  setWorkspaceSwitcherOpen(false);
                                  setWorkspaceQuery("");
                                }}
                                className={`w-full rounded-[14px] border px-3 py-2 text-left transition ${
                                  isActive
                                    ? "border-neon-green/45 bg-neon-green/10 text-text-main"
                                    : "border-panel-border/35 bg-transparent text-text-main/86 hover:border-neon-green/30 hover:bg-[var(--theme-hover-bg)]"
                                }`}
                              >
                                <div className="truncate text-[12px] font-medium">{workspace.name}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">
                                  <span>{workspace.status}</span>
                                  {workspace.harness ? <span>{workspace.harness}</span> : null}
                                  {workspace.onboarding_status ? <span>onboarding {workspace.onboarding_status}</span> : null}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-[14px] border border-panel-border/35 px-3 py-4 text-[12px] text-text-dim/78">
                          No workspaces matched your search.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => {
                  setCreatePanelOpen((open) => !open);
                  setWorkspaceSwitcherOpen(false);
                }}
                className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[16px] border border-neon-green/40 bg-neon-green/10 px-3 text-[12px] text-neon-green transition hover:bg-neon-green/14 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={14} />
                <span>New workspace</span>
              </button>

              <button
                type="button"
                onClick={() => void refreshWorkspaceData()}
                disabled={isRefreshing || isLoadingBootstrap}
                className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[16px] border border-panel-border/45 px-3 text-[12px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                <span>Refresh</span>
              </button>

              {agentMode && hasWorkspaces ? (
                <>
                  <button
                    type="button"
                    onClick={onOpenBrowserWorkbench}
                    className={`inline-flex h-[42px] items-center justify-center gap-2 rounded-[16px] border px-3 text-[12px] transition ${
                      workbenchOpen && activeWorkbenchTab === "browser"
                        ? "border-neon-green/45 bg-neon-green/10 text-neon-green"
                        : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
                    }`}
                  >
                    <Globe size={14} />
                    <span>Browser</span>
                  </button>

                  <button
                    type="button"
                    onClick={onOpenFilesWorkbench}
                    className={`inline-flex h-[42px] items-center justify-center gap-2 rounded-[16px] border px-3 text-[12px] transition ${
                      workbenchOpen && activeWorkbenchTab === "files"
                        ? "border-neon-green/45 bg-neon-green/10 text-neon-green"
                        : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
                    }`}
                  >
                    <FolderOpen size={14} />
                    <span>Files</span>
                  </button>
                </>
              ) : null}
            </div>

            {createPanelOpen ? (
              <form onSubmit={onCreateWorkspace} className="theme-subtle-surface mt-2 grid gap-2 rounded-[18px] border border-panel-border/45 p-3">
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
                    disabled={!canUseMarketplaceTemplates}
                    className={`inline-flex h-[38px] items-center justify-center rounded-[14px] border px-3 text-[11px] transition ${
                      templateSourceMode === "marketplace"
                        ? "border-neon-green/45 bg-neon-green/10 text-neon-green"
                        : "border-panel-border/45 text-text-muted hover:border-neon-green/35 hover:text-text-main"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    Marketplace
                  </button>
                </div>

                <div className="grid gap-2 xl:grid-cols-[minmax(220px,1.1fr)_minmax(220px,1.2fr)_auto]">
                  {templateSourceMode === "marketplace" ? (
                    <label className="theme-control-surface flex min-w-0 items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 py-2 text-left text-[12px] text-text-muted/82">
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">Template</span>
                      <select
                        value={selectedMarketplaceTemplate?.name || ""}
                        onChange={(event) => selectMarketplaceTemplate(event.target.value)}
                        disabled={!canUseMarketplaceTemplates || isLoadingMarketplaceTemplates || marketplaceTemplates.length === 0}
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

                  <button
                    type="submit"
                    disabled={
                      isCreatingWorkspace ||
                      (templateSourceMode === "marketplace"
                        ? !selectedMarketplaceTemplate || selectedMarketplaceTemplate.is_coming_soon
                        : !selectedTemplateFolder?.rootPath)
                    }
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
                ) : selectedTemplateFolder ? (
                  <div className="text-[11px] text-text-dim/78">
                    {selectedTemplateFolder.description || selectedTemplateFolder.rootPath || "Template folder selected."}
                  </div>
                ) : null}
              </form>
            ) : null}

            {workspaceErrorMessage ? (
              <div className="mt-2 rounded-[14px] border border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.08)] px-3 py-2 text-[11px] text-[rgba(255,212,189,0.92)]">
                {workspaceErrorMessage}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <label className="theme-control-surface hidden items-center gap-2 rounded-[var(--theme-radius-pill)] border border-panel-border px-3 py-1.5 text-xs text-text-muted/85 lg:flex">
            <Palette size={13} className="text-neon-green/80" />
            <select
              value={theme}
              onChange={(event) => onThemeChange(event.target.value as AppTheme)}
              className="bg-transparent pr-1 text-xs text-text-main/85 outline-none"
            >
              {THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-obsidian text-text-main">
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </header>
  );
}
