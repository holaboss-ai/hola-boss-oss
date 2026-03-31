import { useMemo, useState } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import { KitCard } from "./KitCard";

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
  onSignIn,
  onStartFromScratch,
  onUseLocalTemplate
}: MarketplaceGalleryProps) {
  const [query, setQuery] = useState("");

  const visibleTemplates = useMemo(() => {
    const available = templates.filter((t) => !t.is_hidden);
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return available;
    return available.filter((t) =>
      [t.name, t.description ?? "", ...t.tags, t.category].some((v) =>
        v.toLowerCase().includes(trimmed)
      )
    );
  }, [templates, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">
          {mode === "pick" ? "Welcome" : "Marketplace"}
        </div>
        <div className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-text-main">
          {mode === "pick" ? "Pick a kit to get started" : "Explore kits"}
        </div>
        {mode === "pick" ? (
          <div className="mt-1 text-[13px] text-text-muted/82">
            Choose a workspace template, or start from scratch.
          </div>
        ) : null}
      </div>

      {!authenticated ? (
        <div className="mt-6 flex min-h-[240px] items-center justify-center">
          <div className="w-full max-w-[420px] rounded-[24px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-8 py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(247,90,84,0.22)] bg-[rgba(247,90,84,0.08)]">
              <Sparkles size={20} className="text-[rgba(206,92,84,0.88)]" />
            </div>
            <div className="mt-4 text-[16px] font-medium text-text-main">
              Sign in to explore kits
            </div>
            <div className="mt-2 text-[12px] leading-6 text-text-muted/78">
              Browse curated workspace templates and launch them directly from the desktop.
            </div>
            {onSignIn ? (
              <button
                type="button"
                onClick={onSignIn}
                className="mt-5 inline-flex h-10 items-center justify-center rounded-[14px] border border-[rgba(247,90,84,0.34)] bg-[rgba(247,90,84,0.9)] px-5 text-[12px] font-medium text-white transition-colors hover:bg-[rgba(226,79,74,0.94)]"
              >
                Sign in to Holaboss
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
      <label className="theme-control-surface mt-4 flex items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 py-2.5 text-[12px] text-text-muted">
        <Search size={13} className="text-text-dim/72" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search kits by name or tag"
          className="w-full bg-transparent text-text-main outline-none placeholder:text-text-dim/48"
        />
      </label>

      <div className="mt-4 min-h-0 flex-1 overflow-auto">
        {isLoading ? (
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
        ) : error ? (
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
            {query.trim() ? "No kits match your search." : "No kits available yet."}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleTemplates.map((t) => (
              <KitCard key={t.name} template={t} onClick={onSelectKit} />
            ))}
          </div>
        )}
      </div>
        </>
      )}

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
