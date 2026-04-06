import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { holabossLogoUrl } from "@/lib/assetPaths";
import { KitCard } from "./KitCard";
import { FALLBACK_TEMPLATES } from "./fallbackTemplates";
import { marketplaceGalleryBranding } from "./marketplaceGalleryBranding";

interface MarketplaceGalleryProps {
  mode: "browse" | "pick";
  templates: TemplateMetadataPayload[];
  isLoading: boolean;
  authenticated: boolean;
  error?: string;
  onSelectKit: (template: TemplateMetadataPayload) => void;
  onRetry?: () => void;
  onSignIn?: () => void;
  onStartFromScratch?: () => void;
  onUseLocalTemplate?: () => void;
}

export function MarketplaceGallery({
  mode,
  templates,
  isLoading,
  authenticated,
  error,
  onSelectKit,
  onRetry,
  onStartFromScratch,
  onUseLocalTemplate,
}: MarketplaceGalleryProps) {
  const [query, setQuery] = useState("");
  const branding = marketplaceGalleryBranding(mode);

  const effectiveTemplates =
    templates.length > 0 ? templates : FALLBACK_TEMPLATES;

  const visibleTemplates = useMemo(() => {
    let available = effectiveTemplates.filter(
      (t: TemplateMetadataPayload) => !t.is_hidden,
    );
    const trimmed = query.trim().toLowerCase();
    if (trimmed) {
      available = available.filter((t: TemplateMetadataPayload) =>
        [t.name, t.description ?? "", ...t.tags, t.category].some((v) =>
          v.toLowerCase().includes(trimmed),
        ),
      );
    }
    return [...available].sort(
      (a: TemplateMetadataPayload, b: TemplateMetadataPayload) =>
        Number(a.is_coming_soon) - Number(b.is_coming_soon),
    );
  }, [effectiveTemplates, query]);

  const showLoading = authenticated && isLoading;
  const showError = authenticated && error;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div>
        {branding.showLogo ? (
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-8 items-center gap-2 justify-center">
              <img src={holabossLogoUrl} alt="Holaboss" className="size-6" />
              <h1 className="text-sm font-semibold tracking-tight">Holaboss</h1>
            </div>
            <div className="h-4 w-px bg-border" />
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {branding.eyebrow}
            </p>
          </div>
        ) : null}
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
          {branding.title}
        </h2>
        {branding.description ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {branding.description}
          </p>
        ) : null}
      </div>

      <div className="relative mt-4">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates by name or tag"
          className="h-9 pl-8"
        />
      </div>

      <div className="mt-4 min-h-80 flex-1 overflow-auto">
        {showLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-border bg-muted p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="size-8 rounded-lg bg-border/50" />
                  <div className="min-w-0 flex-1">
                    <div className="h-4 w-24 rounded bg-border/50" />
                    <div className="mt-2 h-3 w-full rounded bg-border/30" />
                    <div className="mt-1 h-3 w-2/3 rounded bg-border/30" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : showError ? (
          <div className="flex min-h-50 items-center justify-center">
            <div className="w-full max-w-sm rounded-xl border border-destructive/25 bg-destructive/5 px-6 py-5 text-center">
              <p className="text-sm font-medium text-foreground">
                Could not load templates
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
              {onRetry ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  className="mt-3"
                >
                  Try again
                </Button>
              ) : null}
            </div>
          </div>
        ) : visibleTemplates.length === 0 ? (
          <div className="rounded-xl border border-border bg-muted/50 px-4 py-5 text-xs text-muted-foreground">
            {query.trim()
              ? "No templates match your search."
              : "No templates available yet."}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleTemplates.map((t: TemplateMetadataPayload) => (
              <KitCard key={t.name} template={t} onClick={onSelectKit} />
            ))}
          </div>
        )}
      </div>

      {mode === "pick" && (onStartFromScratch || onUseLocalTemplate) ? (
        <div className="mt-4 flex items-center justify-center gap-3 border-t border-border pt-4">
          {onStartFromScratch ? (
            <Button
              variant="link"
              size="sm"
              onClick={onStartFromScratch}
              className="text-muted-foreground"
            >
              Start from scratch
            </Button>
          ) : null}
          {onStartFromScratch && onUseLocalTemplate ? (
            <span className="text-muted-foreground/40">|</span>
          ) : null}
          {onUseLocalTemplate ? (
            <Button
              variant="link"
              size="sm"
              onClick={onUseLocalTemplate}
              className="text-muted-foreground"
            >
              Use a local template
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
