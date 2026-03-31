import { ArrowLeft } from "lucide-react";

interface KitDetailProps {
  template: TemplateMetadataPayload;
  onBack: () => void;
  onSelect: (template: TemplateMetadataPayload) => void;
  selectLabel?: string;
  selectDisabled?: boolean;
  selectDisabledReason?: string;
}

export function KitDetail({
  template,
  onBack,
  onSelect,
  selectLabel = "Use this kit",
  selectDisabled = false,
  selectDisabledReason
}: KitDetailProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 self-start rounded-[12px] px-2 py-1.5 text-[12px] text-text-muted/82 transition-colors hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
      >
        <ArrowLeft size={13} />
        <span>Back to kits</span>
      </button>

      <div className="flex items-start gap-4">
        <span className="shrink-0 text-[40px] leading-none">
          {template.emoji || "📦"}
        </span>
        <div className="min-w-0">
          <div className="text-[24px] font-semibold tracking-[-0.03em] text-text-main">
            {template.name}
          </div>
          {template.description ? (
            <div className="mt-2 max-w-[640px] text-[13px] leading-7 text-text-muted/84">
              {template.description}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {template.source === "official" || template.verified ? (
              <span className="rounded-full border border-[rgba(88,166,255,0.24)] bg-[rgba(88,166,255,0.08)] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[rgba(88,166,255,0.92)]">
                Official
              </span>
            ) : template.source === "community" ? (
              <span className="rounded-full border border-panel-border/35 bg-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-text-dim/74">
                Community
              </span>
            ) : null}
            {template.install_count != null && template.install_count > 0 ? (
              <span className="rounded-full border border-panel-border/35 bg-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-text-dim/74">
                {template.install_count} installs
              </span>
            ) : null}
            {template.author_name ? (
              <span className="rounded-full border border-panel-border/35 bg-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-text-dim/74">
                by {template.author_name}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {template.apps.length > 0 ? (
        <div className="mt-6 rounded-[18px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">
            Included Apps
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {template.apps.map((app) => (
              <span
                key={app}
                className="rounded-full border border-panel-border/35 bg-black/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-text-dim/74"
              >
                {app}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {template.agents.length > 0 ? (
        <div className="mt-4 rounded-[18px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">
            Agents
          </div>
          <div className="mt-2 grid gap-2">
            {template.agents.map((agent) => (
              <div key={agent.role} className="rounded-[12px] border border-panel-border/25 bg-black/6 px-3 py-2">
                <div className="text-[12px] font-medium text-text-main">{agent.role}</div>
                {agent.description ? (
                  <div className="mt-0.5 text-[11px] leading-5 text-text-muted/78">{agent.description}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {template.views.length > 0 ? (
        <div className="mt-4 rounded-[18px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">
            Views
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {template.views.map((view) => (
              <span
                key={view.name}
                className="rounded-full border border-panel-border/35 bg-black/10 px-3 py-1.5 text-[11px] tracking-[0.04em] text-text-dim/74"
                title={view.description}
              >
                {view.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {template.tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {template.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-panel-border/25 px-2.5 py-1 text-[10px] text-text-dim/64"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        <button
          type="button"
          disabled={selectDisabled}
          onClick={() => onSelect(template)}
          className={`rounded-[18px] px-6 py-3 text-[14px] font-medium transition-colors ${
            selectDisabled
              ? "cursor-not-allowed border border-panel-border/35 bg-panel-bg/30 text-text-dim/50"
              : "border border-[rgba(247,90,84,0.38)] bg-[rgba(247,90,84,0.9)] text-white hover:bg-[rgba(247,90,84,1)]"
          }`}
        >
          {selectDisabled && selectDisabledReason ? selectDisabledReason : selectLabel}
        </button>
      </div>
    </div>
  );
}
