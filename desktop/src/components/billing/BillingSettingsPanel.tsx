import { AlertCircle } from "lucide-react";
import { BillingSummaryCard } from "@/components/billing/BillingSummaryCard";
import { Button } from "@/components/ui/button";
import { useDesktopBilling } from "@/lib/billing/useDesktopBilling";

function formatBillingDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Full timestamp for usage rows: "Apr 15, 2026 · 14:17:06".
// Uses 24h clock + seconds so rapid successive calls are distinguishable.
function formatBillingDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${datePart} · ${timePart}`;
}

// Friendly labels for known service types emitted by the backend quota
// transactions. Keep this list in sync with `AgentServiceEnum` in
// `backend/src/core/domain/agent_service_enum.py` — any unmapped value falls
// through to a snake_case → Title Case formatter below.
const SERVICE_TYPE_LABELS: Record<string, string> = {
  workspace: "Workspace chat",
  "model-proxy": "Model proxy",
  compose: "Compose",
  sourcing: "Sourcing",
  hola_canvas: "Canvas",
  growth_campaign: "Growth campaign",
  marketplace: "Marketplace",
  proactive: "Background work",
  cronjobs: "Scheduled task",
  daily_work: "Daily work",
  campaign: "Campaign",
};

function humanizeServiceType(raw: string): string {
  const mapped = SERVICE_TYPE_LABELS[raw];
  if (mapped) {
    return mapped;
  }
  // snake_case / kebab-case → Title Case fallback.
  return raw
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Primary label for a usage row. Tries: serviceType label → custom reason →
// "Credits added" for positive-amount allocations → transaction type as a
// last resort.
function resolveUsageTitle(
  item: { type: string; reason: string | null; serviceType: string | null; amount: number },
): string {
  if (item.serviceType) {
    return humanizeServiceType(item.serviceType);
  }
  if (item.type === "allocate" || item.amount > 0) {
    return "Credits added";
  }
  if (item.reason && item.reason.trim() && item.reason !== "Service consumption") {
    return item.reason;
  }
  return humanizeServiceType(item.type);
}

// Optional sub-line under the title: show `reason` only when it adds info
// beyond the generic "Service consumption" label or the service type itself.
function resolveUsageSubtitle(
  item: { reason: string | null; serviceType: string | null },
): string | null {
  const reason = (item.reason ?? "").trim();
  if (!reason || reason === "Service consumption") {
    return null;
  }
  if (item.serviceType && humanizeServiceType(item.serviceType) === reason) {
    return null;
  }
  return reason;
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
    <div className="grid max-w-[760px] gap-4">
      {showExpirationBanner ? (
        <div className="flex items-center justify-between gap-3 rounded-[16px] border border-warning/30 bg-warning/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm text-warning">
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
      <section className="grid gap-3 rounded-[24px] border border-border/40 bg-card/40 px-4 py-4">
        <div className="text-lg font-semibold text-foreground">
          Usage record
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_200px_120px] gap-3 border-b border-border/40 pb-3 text-sm text-muted-foreground">
          <div>Channel</div>
          <div>Time</div>
          <div className="text-right">Credits change</div>
        </div>

        <div className="grid gap-0">
          {usageItems.length === 0 ? (
            <div className="py-4 text-sm text-muted-foreground">
              {isLoading ? "Loading usage..." : "No usage yet."}
            </div>
          ) : (
            usageItems.slice(0, 8).map((item) => {
              const title = resolveUsageTitle(item);
              const subtitle = resolveUsageSubtitle(item);
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_200px_120px] gap-3 border-b border-border/30 py-4 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {title}
                    </div>
                    {subtitle ? (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {subtitle}
                      </div>
                    ) : null}
                  </div>
                  <div className="tabular-nums text-muted-foreground">
                    {formatBillingDateTime(item.createdAt)}
                  </div>
                  <div
                    className={`text-right tabular-nums ${item.amount > 0 ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {item.amount > 0 ? "+" : ""}
                    {item.amount.toLocaleString()}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
