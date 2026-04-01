import { useMemo, useState } from "react";
import { Search } from "lucide-react";
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

  // Use fetched templates when authenticated, fallback catalog otherwise
  const effectiveTemplates =
    authenticated && templates.length > 0 ? templates : FALLBACK_TEMPLATES;

  const visibleTemplates = useMemo(() => {
    let available = effectiveTemplates.filter((t) => !t.is_hidden);
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

  // Only show loading when authenticated (unauthenticated uses static fallback)
  const showLoading = authenticated && isLoading;
  // Only show error when authenticated (unauthenticated has fallback)
  const showError = authenticated && error;

  return (
    <div
      className={`flex min-h-0 flex-col ${mode === "browse" ? "h-full" : ""}`}
    >
      <div>
        {branding.showLogo ? (
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-8 items-center gap-2 justify-center">
              <img src="/logo.svg" alt="Holaboss" className="size-6" />
              <h1 className="text-sm font-semibold tracking-tight">Holaboss</h1>
            </div>
            <div className="h-4 w-px bg-panel-border/45" />
            <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">
              {branding.eyebrow}
            </div>
          </div>
        ) : null}
        <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">
          {branding.showLogo ? "Workspace setup" : branding.eyebrow}
        </div>
        <div className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-text-main">
          {branding.title}
        </div>
        {branding.description ? (
          <div className="mt-1 text-[13px] text-text-muted/82">
            {branding.description}
          </div>
        ) : null}
      </div>

      <label className="theme-control-surface mt-4 flex items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 py-2.5 text-[12px] text-text-muted">
        <Search size={13} className="text-text-dim/72" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search kits by name or tag"
          className="w-full bg-transparent text-text-main outline-none placeholder:text-text-dim/48"
        />
      </label>

      <div
        className={`mt-4 min-h-0 overflow-auto ${mode === "browse" ? "flex-1" : ""}`}
      >
        {showLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-[18px] border border-panel-border/30 bg-[var(--theme-subtle-bg)] p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-[10px] bg-panel-border/30" />
                  <div className="min-w-0 flex-1">
                    <div className="h-4 w-24 rounded bg-panel-border/30" />
                    <div className="mt-2 h-3 w-full rounded bg-panel-border/20" />
                    <div className="mt-1 h-3 w-2/3 rounded bg-panel-border/20" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : showError ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <div className="w-full max-w-[360px] rounded-[18px] border border-[rgba(255,153,102,0.24)] bg-[rgba(255,153,102,0.06)] px-6 py-5 text-center">
              <div className="text-[14px] font-medium text-text-main">
                Could not load templates
              </div>
              <div className="mt-1 text-[12px] text-text-muted/78">{error}</div>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 rounded-[12px] border border-panel-border/45 bg-[var(--theme-subtle-bg)] px-4 py-2 text-[12px] font-medium text-text-main transition-colors hover:bg-[var(--theme-hover-bg)]"
                >
                  Try again
                </button>
              ) : null}
            </div>
          </div>
        ) : visibleTemplates.length === 0 ? (
          <div className="rounded-[18px] border border-panel-border/35 bg-black/10 px-4 py-5 text-[12px] leading-6 text-text-dim/76">
            {query.trim()
              ? "No kits match your search."
              : "No kits available yet."}
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
        <div className="mt-4 flex items-center justify-center gap-3 border-t border-panel-border/25 pt-4 text-[12px]">
          {onStartFromScratch ? (
            <button
              type="button"
              onClick={onStartFromScratch}
              className="text-text-muted/76 underline transition-colors hover:text-text-main"
            >
              Start from scratch
            </button>
          ) : null}
          {onStartFromScratch && onUseLocalTemplate ? (
            <span className="text-text-dim/40">|</span>
          ) : null}
          {onUseLocalTemplate ? (
            <button
              type="button"
              onClick={onUseLocalTemplate}
              className="text-text-muted/76 underline transition-colors hover:text-text-main"
            >
              Use a local template
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
