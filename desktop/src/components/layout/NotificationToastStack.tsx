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

function toastIcon(level: RuntimeNotificationLevel) {
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

export function NotificationToastStack({
  notifications,
  onCloseToast,
  onActivateNotification,
}: NotificationToastStackProps) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[90] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3 sm:bottom-6 sm:left-6">
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
