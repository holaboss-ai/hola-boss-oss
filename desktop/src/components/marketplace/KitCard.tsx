import { KitEmoji } from "./KitEmoji";

interface KitCardProps {
  template: TemplateMetadataPayload;
  onClick: (template: TemplateMetadataPayload) => void;
  selected?: boolean;
}

export function KitCard({ template, onClick, selected = false }: KitCardProps) {
  const isComingSoon = template.is_coming_soon;

  return (
    <button
      type="button"
      disabled={isComingSoon}
      onClick={() => onClick(template)}
      className={`group relative overflow-hidden rounded-[18px] border px-4 py-4 text-left transition-colors ${
        isComingSoon
          ? "cursor-default border-panel-border/25 bg-panel-bg/12 opacity-50"
          : selected
            ? "border-neon-green/35 bg-neon-green/10"
            : "border-panel-border/40 bg-[var(--theme-subtle-bg)] hover:bg-[var(--theme-hover-bg)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <KitEmoji emoji={template.emoji} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-text-main">
              {template.name}
            </span>
            {isComingSoon ? (
              <span className="shrink-0 rounded-full border border-panel-border/35 bg-black/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-text-dim/72">
                Coming soon
              </span>
            ) : null}
          </div>
          {template.description ? (
            <div
              className="mt-1 text-[12px] leading-5 text-text-muted/82"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden"
              }}
            >
              {template.description}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-text-dim/68">
            {template.install_count != null && template.install_count > 0 ? (
              <span>{template.install_count} installs</span>
            ) : null}
            {template.apps.length > 0 ? (
              <span>{template.apps.length} apps</span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
