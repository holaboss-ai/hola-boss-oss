interface BillingSummaryCardProps {
  overview: DesktopBillingOverviewPayload | null;
  usage: DesktopBillingUsagePayload | null;
  links: DesktopBillingLinksPayload | null;
  isLoading?: boolean;
  error?: Error | null;
}

function formatBillingDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function billingTimelineLabel(overview: DesktopBillingOverviewPayload | null) {
  if (!overview) {
    return "Billing managed on web";
  }
  if (overview.expiresAt) {
    return `Expires on ${formatBillingDate(overview.expiresAt)}`;
  }
  if (overview.renewsAt) {
    return `Renews on ${formatBillingDate(overview.renewsAt)}`;
  }
  return "Billing managed on web";
}

function openBillingLink(url: string | null | undefined) {
  const normalizedUrl = (url ?? "").trim();
  if (!normalizedUrl) {
    return;
  }
  void window.electronAPI.ui.openExternalUrl(normalizedUrl);
}

export function BillingSummaryCard({
  overview,
  links,
  isLoading = false,
  error = null,
}: BillingSummaryCardProps) {
  const hasOverview = Boolean(overview);
  const creditsValue = isLoading
    ? "..."
    : hasOverview
      ? (overview?.creditsBalance ?? 0).toLocaleString()
      : "—";

  return (
    <section className="theme-subtle-surface rounded-[24px] border border-border/40 px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-2xl font-semibold text-foreground">
            {isLoading ? "Loading..." : overview?.planName || "Holaboss"}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {isLoading ? "Checking hosted billing..." : billingTimelineLabel(overview)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openBillingLink(links?.billingPageUrl)}
            className="theme-control-surface inline-flex h-10 items-center justify-center rounded-full border border-border/45 px-4 text-sm font-medium text-foreground transition hover:border-primary/35"
          >
            Manage on web
          </button>
          <button
            type="button"
            onClick={() => openBillingLink(links?.addCreditsUrl)}
            className="inline-flex h-10 items-center justify-center rounded-full border border-primary/35 bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Add credits
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[16px] border border-rose-400/35 bg-rose-500/8 px-4 py-3 text-sm text-rose-400">
          {error.message}
        </div>
      ) : null}

      {!isLoading && !hasOverview && !error ? (
        <div className="mt-4 rounded-[16px] border border-border/35 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Sign in to view billing.
        </div>
      ) : null}

      <div className="mt-5 border-t border-dashed border-border/50 pt-5">
        <div className="grid gap-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <div>
              <div className="text-xl font-semibold tracking-[-0.03em] text-foreground tabular-nums">
                {creditsValue}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">Credits</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-semibold tracking-[-0.03em] text-foreground tabular-nums">
                {overview?.monthlyCreditsIncluded?.toLocaleString() ?? "—"}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">Monthly credits</div>
            </div>
          </div>

          <div className="grid gap-3 text-sm text-muted-foreground">
            <div className="flex items-center justify-between gap-3">
              <span>Total allocated</span>
              <span className="tabular-nums text-foreground">
                {overview?.totalAllocated?.toLocaleString() ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Total used</span>
              <span className="tabular-nums text-foreground">
                {overview?.totalUsed?.toLocaleString() ?? "—"}
              </span>
            </div>
            {overview?.dailyRefreshCredits ? (
              <div className="flex items-center justify-between gap-3">
                <span>Daily refresh</span>
                <span className="tabular-nums text-foreground">
                  {overview.dailyRefreshCredits.toLocaleString()}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
