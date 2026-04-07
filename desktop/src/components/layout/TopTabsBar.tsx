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
  Upload,
  User2,
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
import { NotificationCenter } from "@/components/layout/NotificationCenter";
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
  onWorkspaceSwitcherVisibilityChange?: (open: boolean) => void;
  onOpenMarketplace?: () => void;
  isMarketplaceActive?: boolean;
  onOpenWorkspaceCreatePanel?: () => void;
  onOpenSettings?: () => void;
  onOpenAccount?: () => void;
  onOpenBilling?: () => void;
  onOpenExternalUrl?: (url: string) => void;
  onPublish?: () => void;
  notifications?: RuntimeNotificationRecordPayload[];
  notificationUnreadCount?: number;
  onNotificationCenterOpenChange?: (open: boolean) => void;
  onActivateNotification?: (notificationId: string) => void;
  onDismissNotification?: (notificationId: string) => void;
  onClearAllNotifications?: () => void;
}

export function TopTabsBar({
  integratedTitleBar = false,
  onWorkspaceSwitcherVisibilityChange,
  onOpenMarketplace,
  isMarketplaceActive = false,
  onOpenWorkspaceCreatePanel,
  onOpenSettings,
  onOpenAccount,
  onOpenBilling,
  onOpenExternalUrl,
  onPublish,
  notifications = [],
  notificationUnreadCount = 0,
  onNotificationCenterOpenChange,
  onActivateNotification,
  onDismissNotification,
  onClearAllNotifications,
}: TopTabsBarProps) {
  const { isAvailable: isBillingAvailable, overview, isLoading: isBillingLoading, isLowBalance } =
    useDesktopBilling();
  const userButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceSwitcherRef = useRef<HTMLDivElement | null>(null);
  const workspaceSwitcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceSwitcherPopupRef = useRef<HTMLDivElement | null>(null);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
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
            src={holabossLogoUrl}
            alt="Holaboss"
            className="size-9 shrink-0 rounded-lg border border-border overflow-hidden"
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
          {isBillingAvailable ? (
            <CreditsPill
              balance={overview?.creditsBalance ?? 0}
              isLoading={isBillingLoading}
              isLowBalance={isLowBalance}
              onClick={() => onOpenBilling?.()}
            />
          ) : null}
          <NotificationCenter
            notifications={notifications}
            unreadCount={notificationUnreadCount}
            integratedTitleBar={integratedTitleBar}
            onOpenChange={onNotificationCenterOpenChange}
            onActivateNotification={(notificationId) =>
              onActivateNotification?.(notificationId)
            }
            onDismiss={(notificationId) => onDismissNotification?.(notificationId)}
            onClearAll={() => onClearAllNotifications?.()}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={userButtonRef}
              render={<Button variant="outline" size="icon-lg" />}
            >
              <User2 />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${
                        runtimeStatus?.status === "running"
                          ? "bg-emerald-500"
                          : runtimeStatus?.status === "starting"
                            ? "animate-pulse bg-amber-400"
                            : runtimeStatus?.status === "error"
                              ? "bg-destructive"
                              : "bg-muted-foreground/50"
                      }`}
                    />
                    <span className="text-sm font-medium text-foreground">
                      {runtimeStatus?.status === "running"
                        ? "Runtime active"
                        : runtimeStatus?.status === "starting"
                          ? "Runtime starting"
                          : runtimeStatus?.status === "error"
                            ? "Runtime error"
                            : "Runtime offline"}
                    </span>
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
