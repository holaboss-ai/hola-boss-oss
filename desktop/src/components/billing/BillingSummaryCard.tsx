import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
}: BillingSummaryCardProps) {
  const hasOverview = Boolean(overview);
  const creditsValue = isLoading
    ? "..."
    : hasOverview
      ? (overview?.creditsBalance ?? 0).toLocaleString()
      : "—";

  return (
    <Card
      className="rounded-xl border-border/40 px-4 py-4"
      style={{ backgroundColor: "rgb(243, 243, 244)" }}
    >
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
          <Button
            variant="outline"
            onClick={() => openBillingLink(links?.billingPageUrl)}
            className="theme-control-surface h-10 rounded-full border-border/45 px-4 hover:border-primary/35"
          >
            Manage on web
          </Button>
          <Button
            onClick={() => openBillingLink(links?.addCreditsUrl)}
            className="h-10 rounded-full border-primary/35 px-4"
          >
            Add credits
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-rose-400/35 bg-rose-500/8 px-4 py-3 text-sm text-rose-400">
          {error.message}
        </div>
      ) : null}

      {!isLoading && !hasOverview && !error ? (
        <div className="mt-4 rounded-lg border border-border/35 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Sign in to view billing.
        </div>
      ) : null}

      <div className="mt-5 border-t border-dashed border-border/50 pt-5">
        <div className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <div>
              <div className="text-base font-semibold tracking-[-0.03em] text-foreground tabular-nums">
                {creditsValue}
              </div>
              <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <span>Credits</span>
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="About credits"
                        className="size-5 rounded-full text-muted-foreground"
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
              <div className="text-base font-semibold tracking-[-0.03em] text-foreground tabular-nums">
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
    </Card>
  );
}
