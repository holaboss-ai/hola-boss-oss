import { ReactNode } from "react";

interface PaneCardProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PaneCard({ title, actions, children, className = "" }: PaneCardProps) {
  const hasHeader = Boolean(title) || Boolean(actions);

  return (
    <section
      className={`soft-vignette theme-shell relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card neon-border ${className}`}
    >
      {hasHeader ? (
        <header className="theme-header-surface shrink-0 flex items-center justify-between border-b border-neon-green/20 px-4 py-3">
          {title ? <h2 className="text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-text-main/85">{title}</h2> : <span />}
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}
