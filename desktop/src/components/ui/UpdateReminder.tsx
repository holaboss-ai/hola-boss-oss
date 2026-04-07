import {
  Download,
  ExternalLink,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UpdateReminderProps {
  status: AppUpdateStatusPayload;
  onDismiss: () => void;
  onInstallNow: () => void;
  onOpenChangelog: () => void;
}

function releaseVersionLabel(status: AppUpdateStatusPayload) {
  const releaseLabel = status.latestVersion || status.releaseName || "latest";
  const normalized = releaseLabel.trim().replace(/^Holaboss\s+/i, "");
  return normalized || "latest";
}

function conciseErrorHint(error: string) {
  const normalized = error.trim();
  if (!normalized) {
    return null;
  }

  if (
    /code signature at url/i.test(normalized) &&
    /code failed to satisfy specified code requirements/i.test(normalized)
  ) {
    return "This install is unsigned, so macOS blocked the signed update.";
  }

  return normalized;
}

function progressLabel(
  status: AppUpdateStatusPayload,
  progressPercent: number | null,
  hasError: boolean,
) {
  if (hasError) {
    return "Install blocked";
  }
  if (status.downloaded) {
    return "Ready to install";
  }
  if (progressPercent === null) {
    return "Preparing download";
  }
  return `${progressPercent}% downloaded`;
}

function hintLabel(status: AppUpdateStatusPayload, hasError: boolean) {
  if (hasError) {
    return "Use a signed desktop build if you want to test the full update flow.";
  }
  if (status.downloaded) {
    return "Restart now, or close later and Holaboss will install it on quit.";
  }
  return "Downloading quietly in the background.";
}

export function UpdateReminder({
  status,
  onDismiss,
  onInstallNow,
  onOpenChangelog,
}: UpdateReminderProps) {
  const releaseLabel = releaseVersionLabel(status);
  const hasError = Boolean(status.error.trim());
  const progressPercent =
    typeof status.downloadProgressPercent === "number"
      ? Math.round(status.downloadProgressPercent)
      : null;
  const progressWidth = `${Math.max(progressPercent ?? 8, 8)}%`;
  const toneClassName = hasError
    ? "bg-amber-400/15 text-amber-200 ring-amber-300/30"
    : status.downloaded
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30"
      : "bg-sky-500/15 text-sky-200 ring-sky-400/30";
  const title = hasError
    ? `Couldn’t install ${releaseLabel}`
    : status.downloaded
      ? `${releaseLabel} ready to install`
      : `Downloading ${releaseLabel}`;
  const hint = hintLabel(status, hasError);
  const errorHint = conciseErrorHint(status.error);

  return (
    <div className="pointer-events-auto overflow-hidden rounded-[24px] border border-border/60 bg-popover/95 shadow-2xl ring-1 ring-foreground/5 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-2">
      <div className="flex items-start gap-3 p-4">
        <div
          className={cn(
            "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl ring-1",
            toneClassName,
          )}
        >
          {hasError ? <TriangleAlert size={18} /> : status.downloaded ? <RotateCcw size={18} /> : <Download size={18} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>Desktop update</span>
            <span className="rounded-full border border-border/50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-foreground/78">
              {progressLabel(status, progressPercent, hasError)}
            </span>
          </div>

          <div className="mt-1 text-base font-semibold leading-tight text-foreground">
            {title}
          </div>
          <p className="mt-1 text-sm leading-5 text-foreground/85">{hint}</p>

          {!status.downloaded ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-border/45">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width]",
                    hasError ? "bg-amber-400/85" : "bg-primary",
                  )}
                  style={{ width: progressWidth }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground/78">
                {progressLabel(status, progressPercent, hasError)}
              </div>
            </div>
          ) : null}

          {errorHint ? (
            <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-200">
              {errorHint}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {status.downloaded && !hasError ? (
              <Button type="button" size="sm" onClick={onInstallNow}>
                <RotateCcw size={14} />
                Restart
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={onOpenChangelog}>
              <ExternalLink size={14} />
              Changelog
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
              <X size={14} />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
