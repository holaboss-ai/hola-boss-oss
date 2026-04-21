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
      return {
        dotClass: "bg-muted-foreground/60",
        label: "Runtime stopped",
      };
    case "disabled":
      return {
        dotClass: "bg-muted-foreground/40",
        label: "Runtime disabled",
      };
    default:
      return {
        dotClass: "bg-muted-foreground/40",
        label: "Runtime unknown",
      };
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
      className="pointer-events-auto flex h-6 items-center gap-1.5 rounded-full border border-border/40 bg-background/70 px-2.5 text-[11px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
    >
      <span
        className={`size-1.5 rounded-full ${dotClass}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
  );
}
