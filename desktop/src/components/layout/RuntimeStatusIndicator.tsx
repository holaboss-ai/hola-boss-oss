import { Server } from "lucide-react";

interface RuntimeStatusIndicatorProps {
  status: RuntimeStatusPayload | null;
  onClick?: () => void;
}

function runtimeStatusVisual(status: RuntimeStatus | undefined): {
  dotClass: string;
  label: string;
} {
  switch (status) {
    case "running":
      return { dotClass: "bg-success", label: "Runtime running" };
    case "starting":
      return {
        dotClass: "animate-pulse bg-warning",
        label: "Runtime starting",
      };
    case "error":
      return { dotClass: "bg-destructive", label: "Runtime error" };
    case "missing":
      return { dotClass: "bg-destructive", label: "Runtime missing" };
    case "stopped":
      return { dotClass: "bg-muted-foreground", label: "Runtime stopped" };
    case "disabled":
      return { dotClass: "bg-muted-foreground", label: "Runtime disabled" };
    default:
      return { dotClass: "bg-muted-foreground", label: "Runtime unknown" };
  }
}

export function RuntimeStatusIndicator({
  status,
  onClick,
}: RuntimeStatusIndicatorProps) {
  if (!status) {
    return null;
  }

  const { dotClass, label } = runtimeStatusVisual(status.status);
  const detail = status.lastError.trim();
  const hoverText = detail || label;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={hoverText}
      className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-subtle-xs transition-colors hover:bg-muted hover:text-foreground dark:border-border"
    >
      <Server size={14} strokeWidth={1.8} />
      <span
        aria-hidden="true"
        className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background ${dotClass}`}
      />
    </button>
  );
}
