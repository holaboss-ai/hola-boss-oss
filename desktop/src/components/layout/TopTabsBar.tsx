import {
  BookOpen,
  ChevronDown,
  Copy,
  FolderKanban,
  Home,
  LayoutGrid,
  Loader2,
  MessageSquareText,
  Minus,
  Plus,
  Search,
  Settings,
  Square,
  Trash2,
  Upload,
  User2,
  Workflow,
  X,
} from "lucide-react";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CreditsPill } from "@/components/billing/CreditsPill";
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
import { useDesktopBilling } from "@/lib/billing/useDesktopBilling";
import { holabossLogoUrl } from "@/lib/assetPaths";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

interface TopTabsBarProps {
  integratedTitleBar?: boolean;
  desktopPlatform?: string | null;
  onWorkspaceSwitcherVisibilityChange?: (open: boolean) => void;
  onOpenSpace?: () => void;
  isSpaceActive?: boolean;
  onOpenAutomations?: () => void;
  isAutomationsActive?: boolean;
  onOpenMarketplace?: () => void;
  isMarketplaceActive?: boolean;
  onOpenWorkspaceCreatePanel?: () => void;
  onOpenSettings?: () => void;
  onOpenAccount?: () => void;
  onOpenBilling?: () => void;
  onOpenExternalUrl?: (url: string) => void;
  onPublish?: () => void;
}

export function TopTabsBar({
  integratedTitleBar = false,
  desktopPlatform = null,
  onWorkspaceSwitcherVisibilityChange,
  onOpenSpace,
  isSpaceActive = false,
  onOpenAutomations,
  isAutomationsActive = false,
  onOpenMarketplace,
  isMarketplaceActive = false,
  onOpenWorkspaceCreatePanel,
  onOpenSettings,
  onOpenAccount,
  onOpenBilling,
  onOpenExternalUrl,
  onPublish,
}: TopTabsBarProps) {
  const isMacIntegratedTitleBar =
    integratedTitleBar && desktopPlatform === "darwin";
  const isWindowsIntegratedTitleBar =
    integratedTitleBar && desktopPlatform === "win32";
  const { isAvailable: isBillingAvailable, overview, isLoading: isBillingLoading, isLowBalance } =
    useDesktopBilling();
  const userButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceSwitcherRef = useRef<HTMLDivElement | null>(null);
  const workspaceSwitcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceSwitcherPopupRef = useRef<HTMLDivElement | null>(null);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [windowState, setWindowState] = useState<DesktopWindowStatePayload>({
    isFullScreen: false,
    isMaximized: false,
    isMinimized: false,
  });
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
    deletingWorkspaceId,
    workspaceErrorMessage,
    deleteWorkspace,
    runtimeStatus,
  } = useWorkspaceDesktop();

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
    setWorkspaceQuery("");
  };

  const updateWorkspaceSwitcherPosition = useCallback(() => {
    if (!workspaceSwitcherButtonRef.current || typeof window === "undefined") {
      return;
    }

    const rect = workspaceSwitcherButtonRef.current.getBoundingClientRect();
    const width = Math.min(320, Math.max(rect.width + 56, 280));
    const left = Math.min(
      Math.max(24, rect.left),
      Math.max(24, window.innerWidth - width - 24),
    );
    const top = rect.bottom + 8;
    const maxHeight = Math.max(220, window.innerHeight - top - 24);

    setWorkspaceSwitcherPosition({ top, left, width, maxHeight });
  }, []);

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
    if (!isWindowsIntegratedTitleBar) {
      return;
    }

    let mounted = true;
    void window.electronAPI.ui.getWindowState().then((nextState) => {
      if (mounted) {
        setWindowState(nextState);
      }
    });

    const unsubscribe = window.electronAPI.ui.onWindowStateChange(
      (nextState) => {
        if (mounted) {
          setWindowState(nextState);
        }
      },
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [isWindowsIntegratedTitleBar]);

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
  }, [updateWorkspaceSwitcherPosition, workspaceSwitcherOpen]);

  const headerClassName = integratedTitleBar
    ? isWindowsIntegratedTitleBar
      ? "window-drag relative h-[42px] px-2 pt-0.5 sm:px-3"
      : "window-drag relative h-[42px] px-2 sm:px-3"
    : "rounded-xl border border-border bg-card/80 px-2.5 py-0.5 shadow-md backdrop-blur-sm sm:px-4";
  const headerGridClassName = isWindowsIntegratedTitleBar
    ? "relative z-10 grid min-w-0 grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-1 lg:h-full lg:grid-cols-[42px_minmax(220px,400px)_minmax(0,1fr)_auto]"
    : `relative z-10 grid min-w-0 items-center gap-1 sm:gap-1.5 lg:h-full lg:grid-cols-[minmax(260px,440px)_minmax(0,1fr)_auto] ${
        isMacIntegratedTitleBar ? "pl-20" : ""
      }`;

  const windowControlButtonClassName =
    "window-no-drag flex h-5 w-5 items-center justify-center rounded-[7px] border border-transparent text-muted-foreground/72 transition-colors duration-150 hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  const workspaceSwitcherContainerClassName = `${integratedTitleBar ? "window-no-drag " : ""}relative min-w-55 max-w-full`;
  const workspaceSwitcherButtonClassName =
    "h-7 w-full justify-start gap-1.5 px-2 rounded-lg text-xs";

  return (
    <header
      onDoubleClick={handleTitleBarDoubleClick}
      className={headerClassName}
    >
      <div className={headerGridClassName}>
        {isWindowsIntegratedTitleBar ? (
          <div className="flex min-w-0 items-center justify-center">
            <img
              src={holabossLogoUrl}
              alt="Holaboss"
              className="size-7 shrink-0 rounded-[9px] border border-border overflow-hidden"
            />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <img
              src={holabossLogoUrl}
              alt="Holaboss"
              className="size-7 shrink-0 rounded-[9px] border border-border overflow-hidden"
            />
            <div
              ref={workspaceSwitcherRef}
              className={workspaceSwitcherContainerClassName}
            >
              <Button
                ref={workspaceSwitcherButtonRef}
                variant={workspaceSwitcherOpen ? "secondary" : "outline"}
                size="default"
                onClick={() => {
                  setWorkspaceSwitcherOpen((open) => {
                    const nextOpen = !open;
                    if (!nextOpen) {
                      setWorkspaceQuery("");
                    } else {
                      requestAnimationFrame(() => {
                        updateWorkspaceSwitcherPosition();
                      });
                    }
                    return nextOpen;
                  });
                }}
                className={workspaceSwitcherButtonClassName}
              >
                <FolderKanban size={13} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-left font-medium">
                  {selectedWorkspace?.name || "Select workspace"}
                </span>
                <ChevronDown
                  size={12}
                  className={`shrink-0 text-muted-foreground transition-transform ${workspaceSwitcherOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </div>
          </div>
        )}
        <div className={isWindowsIntegratedTitleBar ? "flex min-w-0 items-center" : "hidden"}>
          {isWindowsIntegratedTitleBar ? (
            <div
              ref={workspaceSwitcherRef}
              className={workspaceSwitcherContainerClassName}
            >
              <Button
                ref={workspaceSwitcherButtonRef}
                variant={workspaceSwitcherOpen ? "secondary" : "outline"}
                size="default"
                onClick={() => {
                  setWorkspaceSwitcherOpen((open) => {
                    const nextOpen = !open;
                    if (!nextOpen) {
                      setWorkspaceQuery("");
                    } else {
                      requestAnimationFrame(() => {
                        updateWorkspaceSwitcherPosition();
                      });
                    }
                    return nextOpen;
                  });
                }}
                className={workspaceSwitcherButtonClassName}
              >
                <FolderKanban size={13} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-left font-medium">
                  {selectedWorkspace?.name || "Select workspace"}
                </span>
                <ChevronDown
                  size={12}
                  className={`shrink-0 text-muted-foreground transition-transform ${workspaceSwitcherOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </div>
          ) : null}
        </div>

        <div className="hidden lg:block" />

        <div
          className={`${integratedTitleBar ? "window-no-drag " : ""}flex items-center justify-self-end gap-1.5`}
        >
          {onOpenSpace ? (
            <Button
              variant={isSpaceActive ? "secondary" : "outline"}
              size="sm"
              aria-label="Space"
              onClick={onOpenSpace}
              className="h-7 gap-1.5 px-2 rounded-lg text-xs"
            >
              <MessageSquareText size={12} />
              <span className="hidden sm:inline">Space</span>
            </Button>
          ) : null}
          {onOpenAutomations ? (
            <Button
              variant={isAutomationsActive ? "secondary" : "outline"}
              size="sm"
              aria-label="Automations"
              onClick={onOpenAutomations}
              className="h-7 gap-1.5 px-2 rounded-lg text-xs"
            >
              <Workflow size={12} />
              <span className="hidden sm:inline">Automations</span>
            </Button>
          ) : null}
          {onOpenMarketplace ? (
            <Button
              variant={isMarketplaceActive ? "secondary" : "outline"}
              size="sm"
              aria-label="Marketplace"
              onClick={onOpenMarketplace}
              className="h-7 gap-1.5 px-2 rounded-lg text-xs"
            >
              <LayoutGrid size={12} />
              <span className="hidden sm:inline">Marketplace</span>
            </Button>
          ) : null}
          {isBillingAvailable ? (
            <CreditsPill
              balance={overview?.creditsBalance ?? 0}
              isLoading={isBillingLoading}
              isLowBalance={isLowBalance}
              onClick={() => onOpenBilling?.()}
            />
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={userButtonRef}
              render={<Button variant="outline" size="icon-sm" className="relative rounded-lg" />}
            >
              <User2 />
              <span
                className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background ${
                  runtimeStatus?.status === "running"
                    ? "bg-success"
                    : runtimeStatus?.status === "starting"
                      ? "animate-pulse bg-warning"
                      : runtimeStatus?.status === "error"
                        ? "bg-destructive"
                        : "bg-muted-foreground/40"
                }`}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-52">
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
                  onClick={() => onOpenExternalUrl?.("https://www.holaboss.ai")}
                >
                  <Home />
                  Homepage
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    onOpenExternalUrl?.("https://www.holaboss.ai/docs")
                  }
                >
                  <BookOpen />
                  Docs
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {isWindowsIntegratedTitleBar ? (
            <div className="window-no-drag ml-1 mr-[-6px] flex items-center gap-0.5 sm:mr-[-8px]">
              <button
                type="button"
                aria-label="Minimize window"
                className={windowControlButtonClassName}
                onClick={() => {
                  void window.electronAPI.ui.minimizeWindow();
                }}
              >
                <Minus size={13} strokeWidth={2.1} />
              </button>
              <button
                type="button"
                aria-label={
                  windowState.isMaximized || windowState.isFullScreen
                    ? "Restore window"
                    : "Maximize window"
                }
                className={windowControlButtonClassName}
                onClick={() => {
                  void window.electronAPI.ui.toggleWindowSize();
                }}
              >
                {windowState.isMaximized || windowState.isFullScreen ? (
                  <Copy size={12} strokeWidth={1.9} />
                ) : (
                  <Square size={12} strokeWidth={1.9} />
                )}
              </button>
              <button
                type="button"
                aria-label="Close window"
                className={`${windowControlButtonClassName} hover:bg-[rgba(247,90,84,0.12)] hover:text-[rgb(247,90,84)]`}
                onClick={() => {
                  void window.electronAPI.ui.closeWindow();
                }}
              >
                <X size={13} strokeWidth={2.1} />
              </button>
            </div>
          ) : null}
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
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={workspaceQuery}
                  onChange={(event) => setWorkspaceQuery(event.target.value)}
                  placeholder="Search workspaces"
                  className="embedded-input h-8 rounded-full pl-8 text-xs focus-visible:ring-0"
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
                {selectedWorkspaceId && onPublish ? (
                  <Button
                    variant="outline"
                    size="default"
                    onClick={() => {
                      closeWorkspaceSwitcher();
                      onPublish();
                    }}
                    className="mb-2 w-full justify-start gap-2"
                  >
                    <Upload size={14} />
                    <span>Publish to Store</span>
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => {
                    closeWorkspaceSwitcher();
                    onOpenWorkspaceCreatePanel?.();
                  }}
                  className="w-full justify-start gap-2"
                >
                  <Plus size={14} />
                  Create new workspace
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </header>
  );
}
