import { Badge } from "@/components/ui/badge";
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
      className={`group relative overflow-hidden rounded-xl border px-4 py-4 text-left transition-colors ${
        isComingSoon
          ? "cursor-default border-border bg-card/50 opacity-50"
          : selected
            ? "border-primary/35 bg-primary/10"
            : "border-border bg-muted/50 hover:bg-accent"
      }`}
    >
      <div className="flex items-start gap-3">
        <KitEmoji emoji={template.emoji} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {template.name}
            </span>
            {isComingSoon ? (
              <Badge variant="secondary" className="shrink-0 text-[9px]">
                Coming soon
              </Badge>
            ) : null}
          </div>
          {template.description ? (
            <p
              className="mt-1 text-xs leading-relaxed text-muted-foreground"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {template.description}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
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
