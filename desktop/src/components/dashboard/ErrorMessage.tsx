import { useState } from "react";

interface ErrorMessageProps {
  message: string;
  /** Single-line truncate variant for tight spots (KpiCard value row).
   *  Default is a 3-line box with the destructive frame. */
  compact?: boolean;
}

export function ErrorMessage({ message, compact = false }: ErrorMessageProps) {
  const [expanded, setExpanded] = useState(false);

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Click to collapse" : message}
        className={`text-left text-xs text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
          expanded ? "whitespace-pre-wrap" : "truncate"
        }`}
      >
        {message}
      </button>
    );
  }

  return (
    <div className="my-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Click to collapse" : "Click to show full error"}
        className={`block w-full text-left font-mono leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/50 ${
          expanded ? "whitespace-pre-wrap" : "line-clamp-3"
        }`}
      >
        {message}
      </button>
    </div>
  );
}
