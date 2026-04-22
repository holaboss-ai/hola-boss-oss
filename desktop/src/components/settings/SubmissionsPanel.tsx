import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  LogIn,
  Package,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDesktopAuthSession } from "@/lib/auth/authClient";

interface AppEntry {
  name: string;
  required?: boolean;
}

interface SubmissionItem {
  id: string;
  author_id: string;
  author_name: string;
  template_name: string;
  template_id: string;
  version: string;
  status: "pending_review" | "published" | "rejected";
  manifest: Record<string, unknown>;
  archive_size_bytes: number;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  apps?: (string | AppEntry)[];
  onboarding_md?: string | null;
  readme_md?: string | null;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof Clock; badgeClass: string }
> = {
  pending_review: {
    label: "Pending",
    icon: Clock,
    badgeClass:
      "border-warning/30 bg-warning/10 text-warning",
  },
  published: {
    label: "Published",
    icon: CheckCircle2,
    badgeClass:
      "border-success/30 bg-success/10 text-success",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    badgeClass:
      "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function getCategory(manifest: Record<string, unknown>): string | null {
  const category = manifest.category;
  if (typeof category === "string" && category.length > 0) {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }
  return null;
}

function getAppNames(apps?: (string | AppEntry)[]): string[] {
  if (!apps) return [];
  return apps.map((a) => (typeof a === "string" ? a : a.name));
}

function SubmissionRow({
  submission,
  isDeleting,
  onDelete,
}: {
  submission: SubmissionItem;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[submission.status] ?? {
    label: submission.status,
    icon: Clock,
    badgeClass: "border-border bg-muted text-muted-foreground",
  };
  const StatusIcon = config.icon;
  const category = getCategory(submission.manifest);
  const appNames = getAppNames(submission.apps);
  const hasDetails =
    appNames.length > 0 ||
    submission.onboarding_md ||
    submission.readme_md ||
    (submission.status === "rejected" && submission.review_notes);

  return (
    <div className="border-b border-border">
      <div
        className="grid grid-cols-[20px_minmax(0,1fr)_100px_80px_110px_40px] items-center gap-3 px-4 py-3 text-sm cursor-pointer hover:bg-muted transition-colors"
        onClick={() => hasDetails && setExpanded((v) => !v)}
      >
        <span className="flex items-center justify-center text-muted-foreground">
          {hasDetails ? (
            expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )
          ) : null}
        </span>
        <div className="min-w-0">
          <span className="truncate font-medium text-foreground block">
            {submission.template_name}
          </span>
          {(category || appNames.length > 0) && (
            <span className="text-xs text-muted-foreground truncate block mt-0.5">
              {[category, appNames.length > 0 ? appNames.join(", ") : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
        <Badge
          variant="outline"
          className={`w-fit gap-1 ${config.badgeClass}`}
        >
          <StatusIcon className="size-3" />
          {config.label}
        </Badge>
        <span className="tabular-nums text-muted-foreground">
          {formatBytes(submission.archive_size_bytes)}
        </span>
        <span className="text-muted-foreground">
          {formatDate(submission.created_at)}
        </span>
        <span>
          {submission.status !== "published" ? (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={isDeleting}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-muted-foreground hover:text-destructive"
            >
              {isDeleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </Button>
          ) : null}
        </span>
      </div>

      {expanded && hasDetails && (
        <div className="mx-4 mb-3 space-y-2">
          {submission.status === "rejected" && submission.review_notes && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">
                Review feedback
              </p>
              <p className="mt-1 text-xs leading-relaxed text-destructive/80">
                {submission.review_notes}
              </p>
            </div>
          )}

          {appNames.length > 0 && (
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Bundled apps
              </p>
              <div className="flex flex-wrap gap-1.5">
                {appNames.map((name) => (
                  <Badge key={name} variant="secondary" className="text-xs">
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {submission.onboarding_md && (
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Onboarding script
              </p>
              <pre className="text-xs text-foreground whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                {submission.onboarding_md}
              </pre>
            </div>
          )}

          {submission.readme_md && (
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                README
              </p>
              <pre className="text-xs text-foreground whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                {submission.readme_md}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SubmissionsPanel() {
  const authSessionState = useDesktopAuthSession();
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [loading, setLoading] = useState(authSessionState.isPending);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const isSignedIn = Boolean(authSessionState.data?.user?.id?.trim());

  const fetchSubmissions = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const response =
        await window.electronAPI.workspace.listSubmissions();
      if (!signal?.cancelled) {
        setSubmissions(response.submissions);
      }
    } catch (err) {
      if (!signal?.cancelled) {
        setError(
          err instanceof Error ? err.message : "Failed to load submissions",
        );
      }
    } finally {
      if (!signal?.cancelled) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (authSessionState.isPending) {
      setLoading(true);
      return;
    }

    if (!isSignedIn) {
      setSubmissions([]);
      setError(null);
      setLoading(false);
      return;
    }

    const signal = { cancelled: false };
    void fetchSubmissions(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [authSessionState.isPending, fetchSubmissions, isSignedIn]);

  async function handleDelete(submission: SubmissionItem) {
    const confirmed = window.confirm(
      `Delete submission "${submission.template_name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingId(submission.id);
    try {
      await window.electronAPI.workspace.deleteSubmission(submission.id);
      setSubmissions((prev) => prev.filter((s) => s.id !== submission.id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete submission",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    const skeletonWidths = [
      { name: "w-32", sub: "w-20", badge: "w-16", size: "w-8", date: "w-16" },
      { name: "w-44", sub: "w-28", badge: "w-14", size: "w-10", date: "w-14" },
      { name: "w-36", sub: "w-16", badge: "w-16", size: "w-6", date: "w-20" },
      { name: "w-28", sub: "w-24", badge: "w-14", size: "w-8", date: "w-16" },
      { name: "w-40", sub: "w-20", badge: "w-16", size: "w-10", date: "w-14" },
    ];
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading submissions"
        className="max-w-[960px]"
      >
        <div className="grid grid-cols-[20px_minmax(0,1fr)_100px_80px_110px_40px] items-center gap-3 border-b border-border px-4 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span />
          <span>Template</span>
          <span>Status</span>
          <span>Size</span>
          <span>Date</span>
          <span />
        </div>
        {skeletonWidths.map((w, i) => (
          <div key={i} className="border-b border-border">
            <div className="grid grid-cols-[20px_minmax(0,1fr)_100px_80px_110px_40px] items-center gap-3 px-4 py-3">
              <span className="size-3.5 animate-pulse rounded-sm bg-muted-foreground/20" />
              <div className="min-w-0 space-y-1.5">
                <span className={`block h-3.5 animate-pulse rounded bg-muted-foreground/20 ${w.name}`} />
                <span className={`block h-2.5 animate-pulse rounded bg-muted-foreground/20 ${w.sub}`} />
              </div>
              <span className={`h-5 animate-pulse rounded-full bg-muted-foreground/20 ${w.badge}`} />
              <span className={`h-3 animate-pulse rounded bg-muted-foreground/20 ${w.size}`} />
              <span className={`h-3 animate-pulse rounded bg-muted-foreground/20 ${w.date}`} />
              <span className="size-5 animate-pulse rounded bg-muted-foreground/20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[18px] border border-destructive/30 bg-destructive/5 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="rounded-[24px] border border-border bg-card px-6 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <ShieldAlert className="size-3.5 text-primary" />
              <span>Sign-In Required</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              Your template submissions are only available after you sign in.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Connect this desktop app to your account to review and
              manage marketplace submissions.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void authSessionState.requestAuth()}
          >
            <LogIn className="size-3.5" />
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="rounded-[24px] border border-dashed border-border px-6 py-14 text-center">
        <Package className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          No submissions yet
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Publish a workspace template to see it listed here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[960px]">
      <div className="grid grid-cols-[20px_minmax(0,1fr)_100px_80px_110px_40px] items-center gap-3 border-b border-border px-4 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span />
        <span>Template</span>
        <span>Status</span>
        <span>Size</span>
        <span>Date</span>
        <span />
      </div>
      {submissions.map((submission) => (
        <SubmissionRow
          key={submission.id}
          submission={submission}
          isDeleting={deletingId === submission.id}
          onDelete={() => void handleDelete(submission)}
        />
      ))}
    </div>
  );
}
