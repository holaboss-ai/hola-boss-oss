import { Download, RefreshCw, X } from "lucide-react";

interface UpdateReminderProps {
  status: AppUpdateStatusPayload;
  onDismiss: () => void;
  onDownload: () => void;
}

export function UpdateReminder({ status, onDismiss, onDownload }: UpdateReminderProps) {
  const releaseLabel = status.latestVersion || status.releaseTag || "latest";

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-start justify-center px-4 pt-20">
      <div className="pointer-events-auto w-full max-w-[460px] overflow-hidden rounded-[22px] border border-neon-green/35 bg-[linear-gradient(180deg,rgba(13,21,18,0.98),rgba(8,12,10,0.98))] shadow-[0_28px_80px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="flex items-start justify-between gap-4 border-b border-neon-green/15 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neon-green/78">Update available</div>
            <div className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-text-main">Holaboss {releaseLabel} is ready</div>
            <div className="mt-2 text-[12px] leading-6 text-text-muted/82">
              You are on {status.currentVersion}. A newer stable desktop build is available for download.
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss update reminder"
            onClick={onDismiss}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--theme-radius-pill)] border border-panel-border/40 text-text-muted/80 transition hover:border-neon-green/45 hover:text-neon-green"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="rounded-[18px] border border-panel-border/30 bg-black/20 px-4 py-3">
            <div className="flex items-center justify-between gap-4 text-[11px]">
              <span className="uppercase tracking-[0.14em] text-text-muted/62">Current</span>
              <span className="font-medium text-text-main/92">{status.currentVersion}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-4 text-[11px]">
              <span className="uppercase tracking-[0.14em] text-text-muted/62">Latest</span>
              <span className="font-medium text-neon-green">{releaseLabel}</span>
            </div>
            {status.publishedAt ? (
              <div className="mt-2 flex items-center justify-between gap-4 text-[11px]">
                <span className="uppercase tracking-[0.14em] text-text-muted/62">Published</span>
                <span className="font-medium text-text-main/82">{new Date(status.publishedAt).toLocaleDateString()}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[16px] border border-neon-green/45 bg-neon-green/10 px-4 text-[12px] font-medium text-neon-green transition hover:bg-neon-green/16"
            >
              <Download size={14} />
              Download update
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[16px] border border-panel-border/45 px-4 text-[12px] text-text-muted transition hover:border-neon-green/35 hover:text-text-main"
            >
              <RefreshCw size={14} />
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
