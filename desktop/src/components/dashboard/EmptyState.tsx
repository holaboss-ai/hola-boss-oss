import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  /** Optional sub-line. Renders below the message in lighter weight. */
  hint?: string;
  /** Forces a min-height so chart panels don't collapse when empty.
   *  When omitted, the empty state sits at its natural py-10 height. */
  minHeight?: number;
}

export function EmptyState({ icon: Icon, message, hint, minHeight }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground"
      style={minHeight ? { minHeight } : undefined}
    >
      <Icon size={22} strokeWidth={1.5} className="opacity-45" />
      <p className="text-xs">{message}</p>
      {hint ? <p className="text-[11px] opacity-70">{hint}</p> : null}
    </div>
  );
}
