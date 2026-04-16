import { useMemo, useState } from "react";
import { AlertCircle, ChevronRight } from "lucide-react";
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

// Short time only (no date) for child rows inside a group.
function formatBillingTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const CATEGORY_LABELS: Record<string, string> = {
  llm: "Model",
  integration: "Integration",
  proactive: "Background work",
  workspace: "Workspace",
};

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
  key: string,
): string | null {
  if (!metadata) {
    return null;
  }
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type UsageItem = DesktopBillingUsageItemPayload;

function resolveUsageTitle(item: UsageItem): string {
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

// ============================================================================
// Session grouping
// ============================================================================

interface UsageGroup {
  key: string;
  items: UsageItem[];
  totalAmount: number;
  firstCreatedAt: string;
  lastCreatedAt: string;
}

function groupBySession(items: UsageItem[]): UsageGroup[] {
  const groups: UsageGroup[] = [];
  let currentSessionId: string | null = null;
  let currentGroup: UsageGroup | null = null;

  for (const item of items) {
    const sessionId = readMetadataString(item.metadata, "sessionId");

    if (sessionId && sessionId === currentSessionId && currentGroup) {
      currentGroup.items.push(item);
      currentGroup.totalAmount += item.amount;
      // items arrive createdAt DESC so "last" is actually the earliest
      currentGroup.lastCreatedAt = item.createdAt;
    } else {
      currentGroup = {
        key: sessionId ?? item.id,
        items: [item],
        totalAmount: item.amount,
        firstCreatedAt: item.createdAt,
        lastCreatedAt: item.createdAt,
      };
      groups.push(currentGroup);
      currentSessionId = sessionId;
    }
  }
  return groups;
}

// Group header title: e.g. "Chat · 3 calls" or model name for single items.
function resolveGroupTitle(group: UsageGroup): string {
  const first = group.items[0];
  if (group.items.length === 1) {
    return resolveUsageTitle(first);
  }
  const category = first.category ?? null;
  const modelId = readMetadataString(first.metadata, "modelId");
  const provider = readMetadataString(first.metadata, "provider");

  let label: string;
  if (category === "llm" && modelId) {
    label = provider ? `${provider} · ${modelId}` : modelId;
  } else if (category) {
    label = humanizeCategory(category);
  } else {
    label = "Chat";
  }
  return `${label} · ${group.items.length} calls`;
}

// Group subtitle: show session + workspace context so the user can tell
// sessions apart even when the model is the same.
function resolveGroupSubtitle(group: UsageGroup): string | null {
  if (group.items.length <= 1) {
    return null;
  }
  const first = group.items[0];
  const sessionId = readMetadataString(first.metadata, "sessionId");
  const workspaceId = readMetadataString(first.metadata, "workspaceId");

  const parts: string[] = [];
  if (sessionId) {
    parts.push(`Session ${sessionId.slice(0, 8)}`);
  }
  if (workspaceId) {
    parts.push(`Workspace ${workspaceId.slice(0, 8)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ============================================================================
// Components
// ============================================================================

const GRID_COLS = "grid-cols-[minmax(0,1fr)_200px_120px]";

function UsageRow({
  item,
  indent = false,
  compactTime = false,
}: {
  item: UsageItem;
  indent?: boolean;
  compactTime?: boolean;
}) {
  const title = resolveUsageTitle(item);
  return (
    <div
      className={`grid ${GRID_COLS} items-center gap-3 border-b border-border/30 py-2 text-sm last:border-b-0 ${indent ? "pl-5" : ""}`}
    >
      <div className="min-w-0 leading-tight">
        <div className="truncate text-foreground text-xs">{title}</div>
      </div>
      <div className="text-muted-foreground text-xs tabular-nums">
        {compactTime
          ? formatBillingTime(item.createdAt)
          : formatBillingDateTime(item.createdAt)}
      </div>
      <div
        className={`text-right text-xs tabular-nums ${item.amount > 0 ? "text-foreground" : "text-muted-foreground"}`}
      >
        {item.amount > 0 ? "+" : ""}
        {item.amount.toLocaleString()}
      </div>
    </div>
  );
}

function UsageGroupRow({
  group,
  expanded,
  onToggle,
}: {
  group: UsageGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const collapsible = group.items.length > 1;

  if (!collapsible) {
    return <UsageRow item={group.items[0]} />;
  }

  const title = resolveGroupTitle(group);
  const subtitle = resolveGroupSubtitle(group);

  return (
    <div className="border-b border-border/30 last:border-b-0">
      {/* Group header */}
      <div
        className={`grid ${GRID_COLS} cursor-pointer items-center gap-3 py-2.5 text-sm transition-colors hover:bg-accent/30`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="flex min-w-0 items-center gap-1.5 leading-tight">
          <ChevronRight
            size={14}
            className={`shrink-0 text-muted-foreground transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{title}</div>
            {subtitle ? (
              <div className="mt-0.5 truncate text-muted-foreground text-xs">
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
        <div className="text-muted-foreground text-xs tabular-nums">
          {formatBillingDateTime(group.firstCreatedAt)}
        </div>
        <div className="text-right tabular-nums text-muted-foreground">
          {group.totalAmount > 0 ? "+" : ""}
          {group.totalAmount.toLocaleString()}
        </div>
      </div>

      {/* Expanded children */}
      {expanded &&
        group.items.map((item) => (
          <UsageRow key={item.id} item={item} indent compactTime />
        ))}
    </div>
  );
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
  const groups = useMemo(
    () => groupBySession(usageItems.slice(0, 30)),
    [usageItems],
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

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

        <div
          className={`grid ${GRID_COLS} gap-3 border-b border-border/40 pb-2 text-xs text-muted-foreground`}
        >
          <div>Channel</div>
          <div>Time</div>
          <div className="text-right">Credits change</div>
        </div>

        <div className="grid gap-0">
          {groups.length === 0 ? (
            <div className="py-3 text-sm text-muted-foreground">
              {isLoading ? "Loading usage..." : "No usage yet."}
            </div>
          ) : (
            groups.map((group) => (
              <UsageGroupRow
                key={group.key}
                group={group}
                expanded={expandedGroups.has(group.key)}
                onToggle={() => toggleGroup(group.key)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
