import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type BlockingErrorTone = "error" | "warning" | "info";

interface BlockingErrorScreenProps {
  /** Drives the small accent on the status icon. Defaults to "error". */
  tone?: BlockingErrorTone;
  /** Replace the default AlertTriangle when a more specific icon fits. */
  icon?: LucideIcon;
  /**
   * Spin the icon — used for "blocked but recovering" states like the
   * workspace-apps initializing gate. Adds `animate-spin` to the icon node.
   */
  iconSpinning?: boolean;
  title: string;
  description?: ReactNode;
  /**
   * Quiet, mono-styled detail block — the literal error message, a path,
   * a stack trace, etc. Wraps long content; long lines should `break-all`.
   */
  detail?: ReactNode;
  /**
   * Domain-specific block rendered between description and actions —
   * used by the per-app status list, etc. Author owns its layout.
   */
  body?: ReactNode;
  /**
   * Buttons / links. Compose with shadcn `<Button>` and the parent picks
   * size + variant. Stacked on narrow widths via `flex-col sm:flex-row`.
   */
  actions?: ReactNode;
  /** A subtle one-liner under the actions for "where to look next" hints. */
  hint?: ReactNode;
}

const TONE_STYLES: Record<
  BlockingErrorTone,
  { iconWrap: string; icon: string }
> = {
  error: {
    iconWrap: "ring-destructive/20 bg-destructive/8",
    icon: "text-destructive",
  },
  warning: {
    iconWrap: "ring-warning/22 bg-warning/10",
    icon: "text-warning",
  },
  info: {
    iconWrap: "ring-border bg-muted",
    icon: "text-muted-foreground",
  },
};

/**
 * Full-screen blocker shown when the desktop shell genuinely can't proceed
 * (renderer crash, runtime missing, workspace folder unmounted). Reuses the
 * same `bg-fg-2` canvas + centered card vocabulary as the publish + onboarding
 * full-screen flows so a hard-block doesn't visually splinter from the rest
 * of the app. Stay restrained: small icon, no destructive fill, no radial
 * gradients — the title carries the weight.
 */
export function BlockingErrorScreen({
  tone = "error",
  icon,
  iconSpinning = false,
  title,
  description,
  detail,
  body,
  actions,
  hint,
}: BlockingErrorScreenProps) {
  const Icon = icon ?? AlertTriangle;
  const toneStyle = TONE_STYLES[tone];

  return (
    <section className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-y-auto bg-fg-2 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-background p-8 shadow-subtle-sm ring-1 ring-border/40 sm:p-10">
          <div
            className={cn(
              "flex size-9 items-center justify-center rounded-full ring-1",
              toneStyle.iconWrap,
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                "size-4",
                toneStyle.icon,
                iconSpinning && "animate-spin",
              )}
            />
          </div>

          <h2 className="mt-5 text-xl font-semibold tracking-tight text-foreground sm:text-[22px]">
            {title}
          </h2>

          {description ? (
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              {description}
            </div>
          ) : null}

          {detail ? (
            <div className="mt-5 overflow-hidden rounded-lg bg-fg-2 px-3.5 py-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-foreground/85">
              {detail}
            </div>
          ) : null}

          {body ? <div className="mt-5">{body}</div> : null}

          {actions ? (
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">{actions}</div>
          ) : null}

          {hint ? (
            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              {hint}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
