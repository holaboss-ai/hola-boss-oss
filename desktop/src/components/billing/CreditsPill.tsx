import { Loader2, Sparkles } from "lucide-react";
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
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      className={`inline-flex h-7 shrink-0 items-center rounded-lg border px-2.5 text-xs transition ${
        isLowBalance
          ? "border-amber-300/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/14"
          : "border-border/55"
      }`}
      aria-label="Open credits and billing details"
    >
      {isLoading ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <Sparkles size={13} className="opacity-80" />
      )}
      <span className="font-medium tabular-nums">
        {isLoading ? "..." : (balance ?? 0).toLocaleString()}
      </span>
    </Button>
  );
}
