import { CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    return null;
  }
  if (overview.expiresAt) {
    return `Expires ${formatBillingDate(overview.expiresAt)}`;
  }
  if (overview.renewsAt) {
    return `Renews ${formatBillingDate(overview.renewsAt)}`;
  }
  return null;
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

  const planLabel = overview?.planName || "Free";
  const timeline = billingTimelineLabel(overview);

  return (
    <Card className="rounded-xl px-4 py-4">
      {/* Header: plan name + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {isLoading ? "Loading..." : planLabel}
          </span>
          {!isLoading && timeline ? (
            <Badge variant="outline" className="shrink-0 text-muted-foreground">
              {timeline}
            </Badge>
          ) : null}
        </div>

        {!isLoading ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openBillingLink(links?.billingPageUrl)}
            >
              Manage
            </Button>
            <Button
              size="sm"
              onClick={() => openBillingLink(links?.addCreditsUrl)}
            >
              Add credits
            </Button>
          </div>
        ) : null}
      </div>

      {/* Error state */}
      {error ? (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error.message}
        </div>
      ) : null}

      {/* Not signed in */}
      {!isLoading && !hasOverview && !error ? (
        <div className="mt-3 rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
          Sign in to view billing details.
        </div>
      ) : null}

      {/* Credits breakdown */}
      <div className="mt-4 border-t border-border/40 pt-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {/* Balance */}
          <div>
            <div className="text-lg font-semibold tabular-nums text-foreground">
              {creditsValue}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Credits</span>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="About credits"
                      className="size-4 rounded-full text-muted-foreground"
                    />
                  }
                >
                  <CircleHelp size={12} />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72">
                  <PopoverHeader>
                    <PopoverTitle>About credits</PopoverTitle>
                  </PopoverHeader>
                  <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs text-muted-foreground">
                    {CREDITS_HELP_ITEMS.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Monthly */}
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums text-foreground">
              {overview?.monthlyCreditsIncluded?.toLocaleString() ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground">Monthly</div>
          </div>
        </div>

        {/* Usage rows */}
        <div className="mt-3 grid gap-1.5 border-t border-border/30 pt-3 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Total allocated</span>
            <span className="tabular-nums text-foreground">
              {overview?.totalAllocated?.toLocaleString() ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Total used</span>
            <span className="tabular-nums text-foreground">
              {overview?.totalUsed?.toLocaleString() ?? "—"}
            </span>
          </div>
          {overview?.dailyRefreshCredits ? (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Daily refresh</span>
              <span className="tabular-nums text-foreground">
                {overview.dailyRefreshCredits.toLocaleString()}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
