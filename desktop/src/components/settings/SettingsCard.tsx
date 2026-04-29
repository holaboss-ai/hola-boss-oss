import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsCardProps {
  /** Rows / content. Direct children get a separator between them via `[&>*+*]:border-t`. */
  children: ReactNode;
  className?: string;
}

/**
 * SettingsCard
 *
 * A boxed surface for SettingsRow / SettingsToggle / SettingsMenuSelectRow.
 * Direct children automatically get a top border so successive rows share
 * a hairline divider (matches craft-agents-oss's settings card pattern).
 *
 * Style notes:
 *  - shadow-md gives the unified hairline ring + subtle lift (one of our
 *    new design tokens — auto-tunes per mode via --hairline-alpha).
 *  - rounded-xl matches the SettingsDialog's other cards.
 *  - overflow-hidden so the inner row borders don't peek past the corners.
 */
export function SettingsCard({ children, className }: SettingsCardProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-card shadow-md [&>*+*]:border-t [&>*+*]:border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}
