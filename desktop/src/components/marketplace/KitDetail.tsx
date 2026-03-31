import { ArrowLeft } from "lucide-react";
import { KitEmoji } from "./KitEmoji";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { templateReadmes } from "./templateReadmes";

interface KitDetailProps {
  template: TemplateMetadataPayload;
  onBack: () => void;
  onSelect: (template: TemplateMetadataPayload) => void;
  selectLabel?: string;
  selectDisabled?: boolean;
  selectDisabledReason?: string;
  onSignIn?: () => void;
}

export function KitDetail({
  template,
  onBack,
  onSelect,
  selectLabel = "Use this kit",
  selectDisabled = false,
  selectDisabledReason,
  onSignIn
}: KitDetailProps) {
  const readme = templateReadmes[template.name] || template.long_description;
  const displayName = template.name.replaceAll("_", " ");

  return (
    <div className="flex min-h-0 flex-col overflow-auto">
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1.5 self-start rounded-[12px] px-2 py-1.5 text-[12px] text-text-muted/82 transition-colors hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
      >
        <ArrowLeft size={13} />
        <span>Back to kits</span>
      </button>

      {/* Header */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] border border-panel-border/30 bg-[var(--theme-subtle-bg)]">
            <KitEmoji emoji={template.emoji} size={40} />
          </div>
          <div className="min-w-0">
            <div className="text-[24px] font-semibold capitalize tracking-[-0.03em] text-text-main">
              {displayName}
            </div>
            {template.description ? (
              <div className="mt-1.5 max-w-[560px] text-[13px] leading-6 text-text-muted/82">
                {template.description}
              </div>
            ) : null}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {template.install_count != null && template.install_count > 0 ? (
                <span className="rounded-full border border-panel-border/35 bg-black/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">
                  {template.install_count} installs
                </span>
              ) : null}
              {template.source === "official" || template.verified ? (
                <span className="rounded-full border border-[rgba(88,166,255,0.2)] bg-[rgba(88,166,255,0.06)] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[rgba(88,166,255,0.88)]">
                  Official
                </span>
              ) : null}
              {template.apps.length > 0 ? (
                <span className="rounded-full border border-panel-border/35 bg-black/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">
                  {template.apps.join(" · ")}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="shrink-0 sm:mt-1">
          {selectDisabled && onSignIn ? (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex h-11 items-center justify-center rounded-[14px] border border-[rgba(247,90,84,0.34)] bg-[rgba(247,90,84,0.9)] px-5 text-[13px] font-medium text-white transition-colors hover:bg-[rgba(226,79,74,0.94)]"
            >
              Sign in to use
            </button>
          ) : (
            <button
              type="button"
              disabled={selectDisabled}
              onClick={() => onSelect(template)}
              className={`inline-flex h-11 items-center justify-center rounded-[14px] px-5 text-[13px] font-medium transition-colors ${
                selectDisabled
                  ? "cursor-not-allowed border border-panel-border/35 bg-panel-bg/30 text-text-dim/50"
                  : "border border-[rgba(247,90,84,0.34)] bg-[rgba(247,90,84,0.9)] text-white hover:bg-[rgba(226,79,74,0.94)]"
              }`}
            >
              {selectLabel}
            </button>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="mt-6 border-t border-panel-border/30" />

      {/* README content */}
      {readme ? (
        <div className="mt-6">
          <SimpleMarkdown>{readme}</SimpleMarkdown>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {/* Fallback: structured data for templates without README */}
          {template.agents.length > 0 ? (
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-text-dim/72">
                AI Agents
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {template.agents.map((agent) => (
                  <div key={agent.role} className="rounded-[12px] border border-panel-border/30 bg-[var(--theme-subtle-bg)] px-3 py-2.5">
                    <div className="text-[12px] font-medium text-text-main">{agent.role}</div>
                    {agent.description ? (
                      <div className="mt-0.5 text-[11px] leading-5 text-text-muted/72">{agent.description}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {template.views.length > 0 ? (
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-text-dim/72">
                Views
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {template.views.map((view) => (
                  <div key={view.name} className="rounded-[12px] border border-panel-border/30 bg-[var(--theme-subtle-bg)] px-3 py-2.5">
                    <div className="text-[12px] font-medium text-text-main">{view.name}</div>
                    {view.description ? (
                      <div className="mt-0.5 text-[11px] leading-5 text-text-muted/72">{view.description}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
