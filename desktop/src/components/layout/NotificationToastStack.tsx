import {
  Bell,
  CircleCheck,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NotificationToastStackProps {
  leadingToast?: React.ReactNode;
  notifications: RuntimeNotificationRecordPayload[];
  onCloseToast: (notificationId: string) => void;
  onActivateNotification: (notificationId: string) => void;
}

function toastAccentClassName(level: RuntimeNotificationLevel): string {
  if (level === "success") {
    return "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30";
  }
  if (level === "warning") {
    return "bg-amber-400/15 text-amber-200 ring-amber-300/30";
  }
  if (level === "error") {
    return "bg-rose-500/15 text-rose-200 ring-rose-400/30";
  }
  return "bg-sky-500/15 text-sky-200 ring-sky-400/30";
}

function toastIcon(level: RuntimeNotificationLevel): React.ReactNode {
  if (level === "success") {
    return <CircleCheck size={18} />;
  }
  if (level === "warning") {
    return <TriangleAlert size={18} />;
  }
  if (level === "error") {
    return <XCircle size={18} />;
  }
  return <Bell size={18} />;
}

function toastTimeLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "Now";
  }
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function priorityBadgeClassName(priority: RuntimeNotificationPriority): string {
  if (priority === "critical") {
    return "border-rose-500/35 bg-rose-500/12 text-rose-200";
  }
  if (priority === "high") {
    return "border-amber-400/35 bg-amber-400/12 text-amber-100";
  }
  if (priority === "low") {
    return "border-border/60 bg-muted/60 text-muted-foreground";
  }
  return "border-sky-400/30 bg-sky-500/10 text-sky-200";
}

function priorityLabel(priority: RuntimeNotificationPriority): string {
  if (priority === "critical") {
    return "Critical";
  }
  if (priority === "high") {
    return "High";
  }
  if (priority === "low") {
    return "Low";
  }
  return "Normal";
}

export function NotificationToastStack({
  leadingToast = null,
  notifications,
  onCloseToast,
  onActivateNotification,
}: NotificationToastStackProps) {
  if (!leadingToast && notifications.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[90] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3 sm:bottom-6 sm:left-6">
      {leadingToast}
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className="pointer-events-auto overflow-hidden rounded-[24px] border border-border/60 bg-popover/95 shadow-2xl ring-1 ring-foreground/5 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-2"
        >
          <div className="flex items-start gap-3 p-4">
            <div
              className={cn(
                "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl ring-1",
                toastAccentClassName(notification.level),
              )}
            >
              {toastIcon(notification.level)}
            </div>
            <button
              type="button"
              onClick={() => onActivateNotification(notification.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="truncate">
                  {notification.source_label || "Notification"}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em]",
                    priorityBadgeClassName(notification.priority),
                  )}
                >
                  {priorityLabel(notification.priority)}
                </span>
                <span className="normal-case tracking-normal">
                  {toastTimeLabel(notification.created_at)}
                </span>
              </div>
              <div className="mt-1 text-base font-semibold leading-tight text-foreground">
                {notification.title}
              </div>
              <p className="mt-1 text-sm leading-5 text-foreground/85">
                {notification.message}
              </p>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Hide notification ${notification.title}`}
              onClick={() => onCloseToast(notification.id)}
              className="mt-0.5 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
