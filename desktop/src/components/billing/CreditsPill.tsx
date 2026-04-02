import { Loader2, Sparkles } from "lucide-react";

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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-sm transition ${
        isLowBalance
          ? "border-amber-300/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/14"
          : "border-border/55 bg-card/80 text-foreground hover:bg-accent"
      }`}
      aria-label="Open credits and billing details"
    >
      {isLoading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Sparkles size={14} className="opacity-80" />
      )}
      <span className="font-medium tabular-nums">
        {isLoading ? "..." : (balance ?? 0).toLocaleString()}
      </span>
    </button>
  );
}
