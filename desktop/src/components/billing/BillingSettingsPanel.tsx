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

// Friendly labels for known high-level categories from `quota_transactions.category`.
const CATEGORY_LABELS: Record<string, string> = {
  llm: "Model",
  integration: "Integration",
  proactive: "Background work",
  workspace: "Workspace",
};

// Friendly labels for legacy `serviceType` rows (pre-category migration).
// Keep in sync with `AgentServiceEnum` in
// `backend/src/core/domain/agent_service_enum.py`.
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
  integration: "Integration",
};

function titleCase(raw: string): string {
  return raw
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function humanizeCategory(raw: string): string {
  return CATEGORY_LABELS[raw] ?? titleCase(raw);
}

function humanizeServiceType(raw: string): string {
  return SERVICE_TYPE_LABELS[raw] ?? titleCase(raw);
}

function readMetadataString(
  metadata: Record<string, unknown> | null,
  key: string
): string | null {
  if (!metadata) {
    return null;
  }
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Primary label for a usage row. Rich shape (category + metadata) wins over
// legacy shape (serviceType). Priority:
//   1. LLM calls  → provider/modelId from metadata (e.g. "openai · gpt-5.4")
//   2. Integration calls → integrationId + operation
//   3. Category label (Model / Integration / Background work)
//   4. Legacy serviceType label
//   5. "Credits added" for positive-amount allocations
//   6. Reason / transaction type as a last resort
function resolveUsageTitle(item: {
  type: string;
  reason: string | null;
  serviceType: string | null;
  category: string | null;
  metadata: Record<string, unknown> | null;
  amount: number;
}): string {
  const category = item.category ?? null;
  const provider = readMetadataString(item.metadata, "provider");
  const modelId = readMetadataString(item.metadata, "modelId");
  const integrationId = readMetadataString(item.metadata, "integrationId");

  if (category === "llm" && modelId) {
    return provider ? `${provider} · ${modelId}` : modelId;
  }
  if (category === "integration" && integrationId) {
    return titleCase(integrationId);
  }
  if (category) {
    return humanizeCategory(category);
  }
  if (item.serviceType) {
    return humanizeServiceType(item.serviceType);
  }
  if (item.type === "allocate" || item.amount > 0) {
    return "Credits added";
  }
  if (
    item.reason &&
    item.reason.trim() &&
    item.reason !== "Service consumption"
  ) {
    return item.reason;
  }
  return humanizeServiceType(item.type);
}

// Optional sub-line under the title. Surfaces the most useful detail we have
// that isn't already in the title — typically the operation name, workspace,
// or a non-generic reason.
function resolveUsageSubtitle(item: {
  reason: string | null;
  serviceType: string | null;
  category: string | null;
  metadata: Record<string, unknown> | null;
}): string | null {
  const operation = readMetadataString(item.metadata, "operation");
  const workspaceId = readMetadataString(item.metadata, "workspaceId");
  const modelId = readMetadataString(item.metadata, "modelId");

  if (operation && operation !== modelId) {
    return operation;
  }
  if (item.category === "llm" && workspaceId) {
    return `Workspace ${workspaceId.slice(0, 8)}`;
  }
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
      <section className="grid gap-2 rounded-[24px] border border-border/40 bg-card/40 px-4 py-3">
        <div className="text-lg font-semibold text-foreground">
          Usage record
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_200px_120px] gap-3 border-b border-border/40 pb-2 text-xs text-muted-foreground">
          <div>Channel</div>
          <div>Time</div>
          <div className="text-right">Credits change</div>
        </div>

        <div className="grid gap-0">
          {usageItems.length === 0 ? (
            <div className="py-3 text-sm text-muted-foreground">
              {isLoading ? "Loading usage..." : "No usage yet."}
            </div>
          ) : (
            usageItems.slice(0, 8).map((item) => {
              const title = resolveUsageTitle(item);
              const subtitle = resolveUsageSubtitle(item);
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_200px_120px] items-center gap-3 border-b border-border/30 py-2.5 text-sm last:border-b-0"
                >
                  <div className="min-w-0 leading-tight">
                    <div className="truncate font-medium text-foreground">
                      {title}
                    </div>
                    {subtitle ? (
                      <div className="mt-0.5 truncate text-muted-foreground text-xs">
                        {subtitle}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground text-xs tabular-nums">
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
