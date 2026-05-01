import { useMemo } from "react";

import { SimpleMarkdown } from "@/components/marketplace/SimpleMarkdown";
import type { TextPanel as TextPanelSpec } from "@/lib/dashboardSchema";

interface TextPanelProps {
  panel: TextPanelSpec;
}

// Markdown prose between data panels — Notion-page-style. Reuses the
// existing SimpleMarkdown renderer so dashboard prose typography
// matches everywhere prose appears in the desktop (skill descriptions,
// marketplace cards, etc.).
export function TextPanel({ panel }: TextPanelProps) {
  // SimpleMarkdown is pure — no need to memoize parse, but we do it
  // anyway so React doesn't reconcile children unnecessarily on every
  // ancestor re-render (panel-state polling can be chatty).
  const body = useMemo(() => panel.body, [panel.body]);
  return (
    <section className="min-w-0">
      <div className="prose prose-sm max-w-none text-foreground prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-p:leading-relaxed prose-p:text-foreground/85 prose-a:text-primary prose-a:underline-offset-4 prose-strong:font-semibold prose-strong:text-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px]">
        <SimpleMarkdown>{body}</SimpleMarkdown>
      </div>
    </section>
  );
}
