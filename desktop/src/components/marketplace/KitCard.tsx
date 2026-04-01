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
          ? "cursor-default border-border/25 bg-card/12 opacity-50"
          : selected
            ? "border-primary/35 bg-primary/10"
            : "border-border/40 bg-muted hover:bg-accent"
      }`}
    >
      <div className="flex items-start gap-3">
        <KitEmoji emoji={template.emoji} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-foreground">
              {template.name}
            </span>
            {isComingSoon ? (
              <span className="shrink-0 rounded-full border border-border/35 bg-black/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/72">
                Coming soon
              </span>
            ) : null}
          </div>
          {template.description ? (
            <div
              className="mt-1 text-[12px] leading-5 text-muted-foreground/82"
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
          <div className="mt-2 flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/68">
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
