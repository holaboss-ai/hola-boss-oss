import { Server } from "lucide-react";
import { useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  if (!status) {
    return null;
  }

  const { dotClass, label } = runtimeStatusVisual(status.status);
  const detail = status.lastError.trim();

  const scheduleOpen = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  };

  const scheduleClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 120);
  };

  const rows: Array<[string, string]> = [];
  if (status.harness) {
    rows.push(["Harness", status.harness]);
  }
  if (typeof status.pid === "number") {
    rows.push(["PID", String(status.pid)]);
  }
  rows.push([
    "Browser",
    status.desktopBrowserReady ? "ready" : "pending",
  ]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onClick?.();
            }}
            onPointerEnter={scheduleOpen}
            onPointerLeave={scheduleClose}
            onFocus={scheduleOpen}
            onBlur={scheduleClose}
            aria-label={label}
            className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-subtle-xs transition-colors hover:bg-muted hover:text-foreground dark:border-border"
          >
            <Server className="size-3.5" strokeWidth={1.8} />
            <span
              aria-hidden="true"
              className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background ${dotClass}`}
            />
          </button>
        }
      />
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-60 gap-0 p-0"
        onPointerEnter={scheduleOpen}
        onPointerLeave={scheduleClose}
      >
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <span
            aria-hidden="true"
            className={`size-2 shrink-0 rounded-full ${dotClass}`}
          />
          <span className="text-sm font-medium text-foreground">{label}</span>
        </div>

        {rows.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-2 text-xs">
            {rows.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="truncate font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {detail ? (
          <div className="mx-3 mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs leading-5 text-destructive">
            {detail}
          </div>
        ) : null}

        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Click to configure providers
        </div>
      </PopoverContent>
    </Popover>
  );
}
