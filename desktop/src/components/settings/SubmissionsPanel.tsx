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
import { Badge } from "@/components/ui/badge";
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
    label: "Pending",
    icon: Clock,
    badgeClass: "border-warning/30 bg-warning/10 text-warning",
  },
  published: {
    label: "Published",
    icon: CheckCircle2,
    badgeClass: "border-success/30 bg-success/10 text-success",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    badgeClass: "border-destructive/30 bg-destructive/10 text-destructive",
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
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
        <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border/40 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ShieldAlert className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Sign in to view your submissions.
          </span>
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
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="py-12 text-center">
        <Package className="mx-auto size-6 text-muted-foreground/30" />
        <p className="mt-2 text-sm text-muted-foreground">No submissions yet</p>
        <p className="mt-0.5 text-xs text-muted-foreground/70">
          Publish a workspace template to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Table header */}
      <div className="grid grid-cols-[minmax(0,1fr)_100px_80px_80px_36px] items-center gap-3 border-b border-border/40 px-1 pb-2 text-xs font-medium text-muted-foreground">
        <div>Template</div>
        <div>Status</div>
        <div>Size</div>
        <div>Date</div>
        <div />
      </div>

      {/* Table rows */}
      <div>
        {submissions.map((submission) => {
          const config = STATUS_CONFIG[submission.status] ?? {
            label: submission.status,
            icon: Clock,
            badgeClass: "border-border/40 text-muted-foreground",
          };
          const StatusIcon = config.icon;
          const isDeleting = deletingId === submission.id;

          return (
            <div key={submission.id}>
              <div className="grid grid-cols-[minmax(0,1fr)_100px_80px_80px_36px] items-center gap-3 border-b border-border/20 px-1 py-2.5">
                {/* Template name + version */}
                <div className="min-w-0">
                  <span className="truncate text-sm text-foreground">
                    {submission.template_name}
                  </span>
                  {submission.version ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      v{submission.version}
                    </span>
                  ) : null}
                </div>

                {/* Status badge */}
                <div>
                  <Badge variant="outline" className={config.badgeClass}>
                    <StatusIcon className="size-3" />
                    {config.label}
                  </Badge>
                </div>

                {/* Size */}
                <div className="text-xs tabular-nums text-muted-foreground">
                  {formatBytes(submission.archive_size_bytes)}
                </div>

                {/* Date */}
                <div className="text-xs tabular-nums text-muted-foreground">
                  {formatDate(submission.created_at)}
                </div>

                {/* Delete */}
                <div className="flex justify-end">
                  {submission.status !== "published" ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={isDeleting}
                      onClick={() => void handleDelete(submission)}
                      className="text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                    >
                      {isDeleting ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* Rejection feedback — inline below row */}
              {submission.status === "rejected" && submission.review_notes ? (
                <div className="border-b border-border/20 px-1 pb-2.5 pt-1">
                  <div className="rounded-md bg-destructive/5 px-3 py-2">
                    <p className="text-xs text-destructive">
                      <span className="font-medium">Feedback:</span>{" "}
                      {submission.review_notes}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
