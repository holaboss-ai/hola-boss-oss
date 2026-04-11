import { CircleHelp, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

interface BillingSummaryCardProps {
  overview: DesktopBillingOverviewPayload | null;
  usage: DesktopBillingUsagePayload | null;
  links: DesktopBillingLinksPayload | null;
  isLoading?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
}

const CREDITS_HELP_ITEMS = [
  "Your available balance reflects all non-expired credit allocations minus usage.",
  "Monthly credits come from your subscription and expire at the end of the current billing period.",
  "Purchased credits and signup bonus credits do not expire.",
];

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
  onRefresh,
}: BillingSummaryCardProps) {
  const hasOverview = Boolean(overview);
  const creditsValue = isLoading
    ? "..."
    : hasOverview
      ? (overview?.creditsBalance ?? 0).toLocaleString()
      : "—";

  const timelineLabel = billingTimelineLabel(overview);

  return (
    <section className="rounded-[24px] border border-border/40 bg-card/80 px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl font-semibold text-foreground">
              {isLoading ? "Loading..." : overview?.planName || "Free"}
            </span>
            {!isLoading && timelineLabel !== "Billing managed on web" ? (
              <Badge variant="secondary">{timelineLabel}</Badge>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {isLoading ? "Checking hosted billing..." : "Billing managed on web"}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onRefresh ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh billing"
              onClick={onRefresh}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => openBillingLink(links?.billingPageUrl)}
          >
            Manage on web
          </Button>
          <Button
            size="sm"
            onClick={() => openBillingLink(links?.addCreditsUrl)}
          >
            Add credits
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[16px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
              <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <span>Credits</span>
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        aria-label="About credits"
                        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
                      />
                    }
                  >
                    <CircleHelp size={14} />
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80">
                    <PopoverHeader>
                      <PopoverTitle>About credits</PopoverTitle>
                    </PopoverHeader>
                    <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-muted-foreground">
                      {CREDITS_HELP_ITEMS.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              </div>
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
