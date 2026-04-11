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
    <div className="max-w-[920px]">
      <div className="grid grid-cols-[minmax(0,1fr)_100px_80px_110px_40px] items-center gap-3 border-b border-border/40 px-4 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span>Template</span>
        <span>Status</span>
        <span>Size</span>
        <span>Date</span>
        <span />
      </div>
      {submissions.map((submission) => {
        const config = STATUS_CONFIG[submission.status] ?? {
          label: submission.status,
          icon: Clock,
          badgeClass:
            "border-border/40 bg-muted/50 text-muted-foreground",
        };
        const StatusIcon = config.icon;

        return (
          <div key={submission.id}>
            <div className="grid grid-cols-[minmax(0,1fr)_100px_80px_110px_40px] items-center gap-3 border-b border-border/30 px-4 py-3 text-sm">
              <span className="truncate font-medium text-foreground">
                {submission.template_name}
              </span>
              <Badge variant="outline" className={`w-fit gap-1 ${config.badgeClass}`}>
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
                    disabled={deletingId === submission.id}
                    onClick={() => void handleDelete(submission)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    {deletingId === submission.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </Button>
                ) : null}
              </span>
            </div>
            {submission.status === "rejected" && submission.review_notes ? (
              <div className="mx-4 my-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                <p className="text-xs font-medium text-destructive">
                  Review feedback
                </p>
                <p className="mt-1 text-xs leading-relaxed text-destructive/80">
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
