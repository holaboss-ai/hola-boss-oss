import { Server } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface RuntimeStatusIndicatorProps {
  status: RuntimeStatusPayload | null;
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
}: RuntimeStatusIndicatorProps) {
  const [open, setOpen] = useState(false);

  if (!status) {
    return null;
  }

  const { dotClass, label } = runtimeStatusVisual(status.status);
  const detail = status.lastError.trim();

  const rows: Array<[string, string]> = [];
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
            aria-label={label}
            className="relative flex size-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-subtle-xs transition-colors hover:bg-muted hover:text-foreground dark:border-border"
          >
            <Server className="size-3" strokeWidth={1.8} />
            <span
              aria-hidden="true"
              className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-2 ring-background ${dotClass}`}
            />
          </button>
        }
      />
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-60 gap-0 rounded-lg p-0 shadow-subtle-sm ring-0"
      >
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <span
            aria-hidden="true"
            className={`size-2 shrink-0 rounded-full ${dotClass}`}
          />
          <span className="text-sm font-medium text-foreground">{label}</span>
        </div>

        {rows.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-3 text-xs">
            {rows.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="truncate font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {detail ? (
          <div className="mx-3 mb-3 rounded-md bg-destructive/10 px-2 py-1.5 text-xs leading-5 text-destructive">
            {detail}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
