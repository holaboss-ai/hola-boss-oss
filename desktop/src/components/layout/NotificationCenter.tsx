import { Bell, Check, Clock3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface NotificationCenterProps {
  notifications: RuntimeNotificationRecordPayload[];
  unreadCount: number;
  integratedTitleBar?: boolean;
  onOpenChange?: (open: boolean) => void;
  onMarkRead: (notificationId: string) => void;
  onDismiss: (notificationId: string) => void;
  onClearAll?: () => void;
}

function relativeTimeLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "Now";
  }

  const elapsedMs = Date.now() - timestamp;
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (elapsedMinutes < 1) {
    return "Now";
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) {
    return `${elapsedDays}d ago`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function unreadAccentClassName(level: RuntimeNotificationLevel): string {
  if (level === "success") {
    return "bg-emerald-500";
  }
  if (level === "warning") {
    return "bg-amber-400";
  }
  if (level === "error") {
    return "bg-rose-400";
  }
  return "bg-sky-400";
}

export function NotificationCenter({
  notifications,
  unreadCount,
  integratedTitleBar = false,
  onOpenChange,
  onMarkRead,
  onDismiss,
  onClearAll,
}: NotificationCenterProps) {
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant={unreadCount > 0 ? "secondary" : "outline"}
            size="icon-lg"
            aria-label={
              unreadCount > 0
                ? `Notifications (${unreadCount} unread)`
                : "Notifications"
            }
            className={cn(
              "relative",
              integratedTitleBar ? "window-no-drag" : "",
            )}
          />
        }
      >
        <span className="relative inline-flex">
          <Bell size={18} />
          {unreadCount > 0 ? (
            <span className="absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[360px] gap-0 p-0">
        <PopoverHeader className="border-b border-border/50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <PopoverTitle className="text-sm font-semibold">
              Notifications
            </PopoverTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {unreadCount > 0
                  ? `${unreadCount} unread`
                  : notifications.length > 0
                    ? `${notifications.length} total`
                    : "No new items"}
              </span>
              {notifications.length > 0 && onClearAll ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClearAll}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </Button>
              ) : null}
            </div>
          </div>
        </PopoverHeader>

        <div className="max-h-[420px] overflow-y-auto p-2">
          {notifications.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 px-4 py-10 text-center">
              <div className="text-sm font-medium text-foreground">
                No notifications yet
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Reminder-style cronjobs will appear here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {notifications.map((notification) => {
                const isUnread = notification.state === "unread";
                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "rounded-2xl border transition-colors",
                      isUnread
                        ? "border-primary/25 bg-primary/5"
                        : "border-border/50 bg-background/70",
                    )}
                  >
                    <div className="flex items-start gap-3 px-3 py-3">
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          isUnread
                            ? unreadAccentClassName(notification.level)
                            : "bg-muted-foreground/30",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => onMarkRead(notification.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          <span className="truncate">
                            {notification.source_label || "Notification"}
                          </span>
                          <span className="normal-case tracking-normal">
                            {relativeTimeLabel(notification.created_at)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {notification.title}
                          </span>
                          {isUnread ? (
                            <Clock3 size={13} className="shrink-0 text-primary" />
                          ) : (
                            <Check size={13} className="shrink-0 text-muted-foreground" />
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {notification.message}
                        </p>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Dismiss notification ${notification.title}`}
                        onClick={() => onDismiss(notification.id)}
                        className="mt-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
