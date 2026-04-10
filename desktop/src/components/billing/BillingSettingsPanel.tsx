import { AlertCircle } from "lucide-react";
import { BillingSummaryCard } from "@/components/billing/BillingSummaryCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDesktopBilling } from "@/lib/billing/useDesktopBilling";

function formatBillingDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function openBillingLink(url: string | null | undefined) {
  const normalizedUrl = (url ?? "").trim();
  if (!normalizedUrl) {
    return;
  }
  void window.electronAPI.ui.openExternalUrl(normalizedUrl);
}

export function BillingSettingsPanel() {
  const { overview, usage, links, isLoading, error, refresh } =
    useDesktopBilling();

  const showExpirationBanner = Boolean(overview?.expiresAt);
  const usageItems = usage?.items ?? [];

  return (
    <div className="grid max-w-2xl gap-4">
      {showExpirationBanner ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm text-amber-200">
            <AlertCircle size={16} className="shrink-0" />
            <span className="truncate">
              {overview?.planName || "Plan"} expires on{" "}
              {overview?.expiresAt ? formatBillingDate(overview.expiresAt) : ""}
            </span>
          </div>
          <Button
            variant="link"
            size="sm"
            onClick={() => openBillingLink(links?.billingPageUrl)}
            className="shrink-0"
          >
            Reactivate
          </Button>
        </div>
      ) : null}

      <BillingSummaryCard
        overview={overview}
        usage={usage}
        links={links}
        isLoading={isLoading}
        error={error}
        onRefresh={() => void refresh()}
      />
      <Card className="rounded-xl border-border/40 bg-card/40">
        <CardContent className="grid gap-3">
          <div className="text-sm font-semibold text-foreground">
            Usage record
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_140px_120px] gap-3 border-b border-border/40 pb-3 text-sm text-muted-foreground">
            <div>Details</div>
            <div>Date</div>
            <div className="text-right">Credits change</div>
          </div>

          <div className="grid gap-0">
            {usageItems.length === 0 ? (
              <div className="py-4 text-sm text-muted-foreground">
                {isLoading ? "Loading usage..." : "No usage yet."}
              </div>
            ) : (
              usageItems.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_140px_120px] gap-3 border-b border-border/30 py-4 text-sm last:border-b-0"
                >
                  <div className="truncate text-foreground">
                    {item.reason || item.type}
                  </div>
                  <div className="text-muted-foreground">
                    {formatBillingDate(item.createdAt)}
                  </div>
                  <div
                    className={`text-right tabular-nums ${item.amount > 0 ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {item.amount > 0 ? "+" : ""}
                    {item.amount.toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
