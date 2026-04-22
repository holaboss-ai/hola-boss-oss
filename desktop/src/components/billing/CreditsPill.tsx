import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CreditsPillProps {
  balance: number | null;
  isLoading?: boolean;
  isLowBalance?: boolean;
  onClick: () => void;
}

export function CreditsPill({
  balance,
  isLoading = false,
  isLowBalance = false,
  onClick,
}: CreditsPillProps) {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading credits balance"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border/55 px-2.5"
      >
        <span className="size-3 animate-pulse rounded-full bg-muted-foreground/20" />
        <span className="h-3 w-10 animate-pulse rounded bg-muted-foreground/20" />
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="default"
      variant="outline"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center rounded-lg border px-2.5 text-xs transition ${
        isLowBalance
          ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/14"
          : "border-border/55"
      }`}
      aria-label="Open credits and billing details"
    >
      <Sparkles className="size-3.5 opacity-80" />
      <span className="font-medium tabular-nums">
        {(balance ?? 0).toLocaleString()}
      </span>
    </Button>
  );
}
