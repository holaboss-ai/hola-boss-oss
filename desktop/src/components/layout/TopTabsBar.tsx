import {
  BookOpen,
  ChevronDown,
  FolderKanban,
  Home,
  LayoutGrid,
  Loader2,
  Plus,
  Search,
  Settings,
  Trash2,
  User2,
} from "lucide-react";
import {
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

interface TopTabsBarProps {
  integratedTitleBar?: boolean;
  onWorkspaceSwitcherVisibilityChange?: (open: boolean) => void;
  onOpenMarketplace?: () => void;
  isMarketplaceActive?: boolean;
  onOpenSettings?: () => void;
  onOpenAccount?: () => void;
  onOpenExternalUrl?: (url: string) => void;
}

export function TopTabsBar({
  integratedTitleBar = false,
  onWorkspaceSwitcherVisibilityChange,
  onOpenMarketplace,
  isMarketplaceActive = false,
  onOpenSettings,
  onOpenAccount,
  onOpenExternalUrl,
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
  const { selectedWorkspaceId, setSelectedWorkspaceId } =
    useWorkspaceSelection();
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
    deleteWorkspace,
  } = useWorkspaceDesktop();

  const createDisabled =
    isCreatingWorkspace ||
    (templateSourceMode === "marketplace"
      ? !canUseMarketplaceTemplates ||
        !selectedMarketplaceTemplate ||
        selectedMarketplaceTemplate.is_coming_soon
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
    const left = Math.min(
      Math.max(24, rect.left),
      Math.max(24, window.innerWidth - width - 24),
    );
    const top = rect.bottom + 8;
    const maxHeight = Math.max(220, window.innerHeight - top - 24);

    setWorkspaceSwitcherPosition({ top, left, width, maxHeight });
  }, [createPanelOpen]);

  const { runtimeStatus, statusSummary } = useWorkspaceDesktop();

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
    if (
      target.closest(
        "button, input, select, textarea, a, [role='button'], .window-no-drag",
      )
    ) {
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

  return (
    <header
      onDoubleClick={handleTitleBarDoubleClick}
      className={
        integratedTitleBar
          ? "window-drag relative h-[60px] px-2 sm:px-3"
          : "rounded-xl border border-border bg-card/80 px-2.5 py-2 shadow-md backdrop-blur-sm sm:px-4"
      }
    >
      <div
        className={`relative z-10 grid min-w-0 items-center gap-2 sm:gap-3 lg:h-full lg:grid-cols-[minmax(320px,520px)_minmax(0,1fr)_auto] ${
          integratedTitleBar ? "pl-20" : ""
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <img
            src="/logo.svg"
            alt="Holaboss"
            className="size-10 p-1 rounded-lg border border-border shrink-0"
          />
          <div
            ref={workspaceSwitcherRef}
            className={`${integratedTitleBar ? "window-no-drag " : ""}relative min-w-55 max-w-full`}
          >
            <Button
              ref={workspaceSwitcherButtonRef}
              variant={workspaceSwitcherOpen ? "secondary" : "outline"}
              size="lg"
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
              className="w-full justify-start gap-2.5 px-3"
            >
              <FolderKanban size={14} className="shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-left font-medium">
                {selectedWorkspace?.name || "Select workspace"}
              </span>
              <ChevronDown
                size={13}
                className={`shrink-0 text-muted-foreground transition-transform ${workspaceSwitcherOpen ? "rotate-180" : ""}`}
              />
            </Button>
          </div>
        </div>

        <div className="hidden lg:block" />

        <div
          className={`${integratedTitleBar ? "window-no-drag " : ""}flex items-center justify-self-end gap-2`}
        >
          {onOpenMarketplace ? (
            <Button
              variant={isMarketplaceActive ? "secondary" : "outline"}
              size="lg"
              aria-label="Marketplace"
              onClick={onOpenMarketplace}
              className="gap-2 px-3"
            >
              <LayoutGrid size={14} />
              <span className="hidden sm:inline">Marketplace</span>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={userButtonRef}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-input bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <User2 size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-3 py-2">
                  <div className="text-sm font-medium text-foreground">
                    Desktop Status
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {runtimeStatus?.status === "running"
                      ? "Runtime connected and running."
                      : runtimeStatus?.status === "starting"
                        ? "Runtime starting..."
                        : runtimeStatus?.status === "error"
                          ? "Runtime error."
                          : "Waiting for runtime..."}
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => onOpenAccount?.()}>
                  <User2 />
                  Account
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpenSettings?.()}>
                  <Settings />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => onOpenExternalUrl?.("https://holaboss.ai")}
                >
                  <Home />
                  Homepage
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    onOpenExternalUrl?.("https://docs.holaboss.ai")
                  }
                >
                  <BookOpen />
                  Docs
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {workspaceErrorMessage ? (
        <div
          className={`${integratedTitleBar ? "window-no-drag " : ""}theme-chat-system-bubble mt-2 rounded-[14px] border px-3 py-2 text-[11px] leading-6`}
        >
          {workspaceErrorMessage}
        </div>
      ) : null}

      {workspaceSwitcherOpen &&
      workspaceSwitcherPosition &&
      typeof document !== "undefined"
        ? createPortal(
            <div
              ref={workspaceSwitcherPopupRef}
              className={`${integratedTitleBar ? "window-no-drag " : ""}fixed z-[80] rounded-xl border border-border bg-popover p-3 shadow-lg`}
              style={{
                top: workspaceSwitcherPosition.top,
                left: workspaceSwitcherPosition.left,
                width: workspaceSwitcherPosition.width,
                maxHeight: workspaceSwitcherPosition.maxHeight,
              }}
            >
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={workspaceQuery}
                  onChange={(event) => setWorkspaceQuery(event.target.value)}
                  placeholder="Search workspaces"
                  className="h-8 pl-8 text-xs"
                />
              </div>

              <div className="max-h-[240px] overflow-y-auto">
                {filteredWorkspaces.length ? (
                  <div className="grid gap-1">
                    {filteredWorkspaces.map((workspace) => {
                      const isActive = workspace.id === selectedWorkspaceId;
                      const isDeleting = deletingWorkspaceId === workspace.id;
                      return (
                        <div
                          key={workspace.id}
                          className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors ${
                            isActive
                              ? "border-primary/30 bg-primary/10"
                              : "border-transparent hover:bg-accent"
                          } ${isDeleting ? "opacity-50" : ""}`}
                        >
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => {
                              setSelectedWorkspaceId(workspace.id);
                              closeWorkspaceSwitcher();
                            }}
                            className="min-w-0 flex-1 px-1 text-left text-sm font-medium disabled:cursor-not-allowed"
                          >
                            <span className="truncate">{workspace.name}</span>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete workspace ${workspace.name}`}
                            disabled={Boolean(deletingWorkspaceId)}
                            onClick={() => void onDeleteWorkspace(workspace)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            {isDeleting ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Trash2 size={13} />
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    No workspaces matched your search.
                  </div>
                )}
              </div>

              <div className="mt-3 border-t border-border pt-3">
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => setCreatePanelOpen((open) => !open)}
                  className="w-full justify-between gap-2"
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus
                      size={14}
                      className={`transition-transform duration-200 ${createPanelOpen ? "rotate-45" : ""}`}
                    />
                    <span>Create new workspace</span>
                  </span>
                  <ChevronDown
                    size={14}
                    className={`text-muted-foreground transition-transform ${createPanelOpen ? "rotate-180" : ""}`}
                  />
                </Button>

                {createPanelOpen ? (
                  <form
                    onSubmit={onCreateWorkspace}
                    className="mt-3 grid gap-2 rounded-lg border border-border bg-muted/50 p-3"
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ["local", "Local folder"],
                          ["marketplace", "Marketplace"],
                          ["empty", "Empty"],
                          ["empty_onboarding", "Empty + Onboarding"],
                        ] as const
                      ).map(([mode, label]) => (
                        <Button
                          key={mode}
                          type="button"
                          variant={templateSourceMode === mode ? "secondary" : "ghost"}
                          size="xs"
                          onClick={() => setTemplateSourceMode(mode)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>

                    <div className="grid gap-2">
                      {templateSourceMode === "marketplace" ? (
                        canUseMarketplaceTemplates ? (
                          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs">
                            <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                              Template
                            </span>
                            <select
                              value={selectedMarketplaceTemplate?.name || ""}
                              onChange={(event) =>
                                selectMarketplaceTemplate(event.target.value)
                              }
                              disabled={
                                isLoadingMarketplaceTemplates ||
                                marketplaceTemplates.length === 0
                              }
                              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none disabled:opacity-50"
                            >
                              {isLoadingMarketplaceTemplates ? (
                                <option value="">Loading templates...</option>
                              ) : marketplaceTemplates.length ? (
                                marketplaceTemplates.map((template) => (
                                  <option
                                    key={template.name}
                                    value={template.name}
                                    disabled={template.is_coming_soon}
                                  >
                                    {template.is_coming_soon
                                      ? `${template.name} (Coming soon)`
                                      : template.name}
                                  </option>
                                ))
                              ) : (
                                <option value="">
                                  No marketplace templates
                                </option>
                              )}
                            </select>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="default"
                            onClick={(event) =>
                              openAuthPopup(
                                event.currentTarget.getBoundingClientRect(),
                              )
                            }
                            className="w-full"
                          >
                            Sign in to use Marketplace
                          </Button>
                        )
                      ) : templateSourceMode === "empty" ? (
                        <div className="rounded-lg border border-input bg-transparent px-3 py-2 text-xs">
                          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                            Scaffold
                          </span>
                          <p className="mt-1 text-foreground">
                            workspace.yaml + AGENTS.md + empty skills folder
                          </p>
                        </div>
                      ) : templateSourceMode === "empty_onboarding" ? (
                        <div className="rounded-lg border border-input bg-transparent px-3 py-2 text-xs">
                          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                            Scaffold
                          </span>
                          <p className="mt-1 text-foreground">
                            workspace.yaml + AGENTS.md + empty skills folder +
                            ONBOARD.md
                          </p>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="default"
                          onClick={() => void chooseTemplateFolder()}
                          className="w-full justify-start gap-2"
                        >
                          <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                            Template
                          </span>
                          <span className="min-w-0 flex-1 truncate text-left text-foreground">
                            {selectedTemplateFolder?.templateName ||
                              selectedTemplateFolder?.rootPath ||
                              "Choose folder"}
                          </span>
                        </Button>
                      )}

                      <Input
                        value={newWorkspaceName}
                        onChange={(event) =>
                          setNewWorkspaceName(event.target.value)
                        }
                        placeholder="New workspace name"
                        className="h-8 text-xs"
                      />

                      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs">
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                          Harness
                        </span>
                        <select
                          value={selectedCreateHarness}
                          onChange={(event) =>
                            setSelectedCreateHarness(event.target.value)
                          }
                          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
                        >
                          {createHarnessOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Button
                        type="submit"
                        disabled={createDisabled}
                        className="w-full gap-2"
                      >
                        {isCreatingWorkspace ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Plus size={14} />
                        )}
                        Create
                      </Button>
                    </div>

                    {templateSourceMode === "marketplace" ? (
                      <p className="text-xs text-muted-foreground">
                        {marketplaceTemplatesError
                          ? marketplaceTemplatesError
                          : selectedMarketplaceTemplate
                            ? selectedMarketplaceTemplate.long_description ||
                              selectedMarketplaceTemplate.description ||
                              "Marketplace template selected."
                            : canUseMarketplaceTemplates
                              ? "Choose a marketplace template to bootstrap this workspace."
                              : "Sign in and finish runtime setup to use marketplace templates."}
                      </p>
                    ) : templateSourceMode === "empty" ? (
                      <p className="text-xs text-muted-foreground">
                        Creates a minimal workspace with `workspace.yaml`, an
                        empty `AGENTS.md`, and an empty `skills/` folder.
                      </p>
                    ) : templateSourceMode === "empty_onboarding" ? (
                      <p className="text-xs text-muted-foreground">
                        Creates the same minimal workspace shell, plus a starter
                        `ONBOARD.md` so you can test the onboarding flow
                        immediately.
                      </p>
                    ) : selectedTemplateFolder ? (
                      <p className="text-xs text-muted-foreground">
                        {selectedTemplateFolder.description ||
                          selectedTemplateFolder.rootPath ||
                          "Template folder selected."}
                      </p>
                    ) : null}
                  </form>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </header>
  );
}
