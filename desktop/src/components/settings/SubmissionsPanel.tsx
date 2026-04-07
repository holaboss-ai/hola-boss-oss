import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  LogIn,
  Package,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDesktopAuthSession } from "@/lib/auth/authClient";

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
}

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof Clock; badgeClass: string }
> = {
  pending_review: {
    label: "Pending Review",
    icon: Clock,
    badgeClass:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  published: {
    label: "Published",
    icon: CheckCircle2,
    badgeClass:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    badgeClass:
      "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
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

function categoryFromManifest(
  manifest: Record<string, unknown>,
): string | null {
  const category = manifest.category;
  if (typeof category === "string" && category.length > 0) {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }
  return null;
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
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
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
      <div className="rounded-[24px] border border-border/40 bg-card/80 px-6 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <ShieldAlert className="size-3.5 text-primary" />
              <span>Sign-In Required</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              Your template submissions are only available after you sign in.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Connect this desktop app to your Holaboss account to review and
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
      <div className="rounded-[24px] border border-dashed border-border/50 px-6 py-14 text-center">
        <Package className="mx-auto mb-3 size-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">
          No submissions yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Publish a workspace template to see it listed here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid max-w-[920px] gap-3">
      {submissions.map((submission) => {
        const config = STATUS_CONFIG[submission.status] ?? {
          label: submission.status,
          icon: Clock,
          badgeClass:
            "border-border/40 bg-muted/50 text-muted-foreground",
        };
        const StatusIcon = config.icon;
        const category = categoryFromManifest(submission.manifest);

        return (
          <div
            key={submission.id}
            className="rounded-[18px] border border-border/40 bg-card/80 px-5 py-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {submission.template_name}
                  </span>
                  {category ? (
                    <span className="shrink-0 rounded-full border border-border/35 px-2 py-0.5 text-xs text-muted-foreground">
                      {category}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Submitted {formatDate(submission.created_at)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.badgeClass}`}
                >
                  <StatusIcon className="size-3" />
                  {config.label}
                </span>
                {submission.status !== "published" ? (
                  <button
                    type="button"
                    disabled={deletingId === submission.id}
                    onClick={() => void handleDelete(submission)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    {deletingId === submission.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </button>
                ) : null}
              </div>
            </div>

            {submission.status === "rejected" && submission.review_notes ? (
              <div className="mt-3 rounded-[12px] border border-red-500/15 bg-red-500/5 px-3.5 py-2.5">
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  Review feedback
                </p>
                <p className="mt-1 text-xs leading-relaxed text-red-600/80 dark:text-red-400/80">
                  {submission.review_notes}
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
