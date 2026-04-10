import { Check, Download, LoaderCircle } from "lucide-react";

type AppCardState = "available" | "installing" | "installed";

interface AppCatalogCardProps {
  entry: AppCatalogEntryPayload;
  state: AppCardState;
  disabled: boolean;
  onInstall: () => void;
}

export function AppCatalogCard({ entry, state, disabled, onInstall }: AppCatalogCardProps) {
  const label = entry.name || entry.app_id;
  const description = entry.description ?? "";
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/40 text-sm font-semibold uppercase text-muted-foreground">
          {label.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{label}</div>
          {entry.version ? (
            <div className="truncate text-[11px] text-muted-foreground">{entry.version}</div>
          ) : null}
        </div>
      </div>
      {description ? (
        <p className="mt-3 flex-1 line-clamp-3 text-[12px] leading-5 text-muted-foreground">{description}</p>
      ) : (
        <div className="flex-1" />
      )}
      <div className="mt-4 flex items-center justify-end">
        {state === "installed" ? (
          <button
            type="button"
            disabled
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
          >
            <Check size={13} />
            Installed
          </button>
        ) : state === "installing" ? (
          <button
            type="button"
            disabled
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground"
          >
            <LoaderCircle size={13} className="animate-spin" />
            Installing…
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={onInstall}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={13} />
            Install
          </button>
        )}
      </div>
    </div>
  );
}

export type { AppCardState };
