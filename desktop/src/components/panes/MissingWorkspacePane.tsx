import { FolderX, FolderOpen, Trash2, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface MissingWorkspacePaneProps {
  workspaceName: string;
  workspacePath: string | null;
  onRelocate: () => Promise<void>;
  onDeleteRecord: () => Promise<void>;
}

export function MissingWorkspacePane({
  workspaceName,
  workspacePath,
  onRelocate,
  onDeleteRecord,
}: MissingWorkspacePaneProps) {
  const [isRelocating, setIsRelocating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleRelocate() {
    if (isRelocating || isDeleting) {
      return;
    }
    setIsRelocating(true);
    try {
      await onRelocate();
    } finally {
      setIsRelocating(false);
    }
  }

  async function handleDelete() {
    if (isRelocating || isDeleting) {
      return;
    }
    const confirmed = window.confirm(
      `Remove "${workspaceName}" from Holaboss?\n\nYour files on disk will not be touched. Only this workspace record is removed.`,
    );
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      await onDeleteRecord();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-card px-6 py-8">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
            <FolderX size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">
              Workspace folder is missing
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Holaboss can't find the folder for{" "}
              <span className="font-medium text-foreground">{workspaceName}</span>.
              It may have been moved, deleted, or be on a drive that's not
              mounted right now.
            </p>
            {workspacePath ? (
              <div
                className="mt-3 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground"
                title={workspacePath}
              >
                {workspacePath}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <Button
            onClick={() => void handleRelocate()}
            disabled={isRelocating || isDeleting}
            className="h-10 justify-start gap-2"
          >
            {isRelocating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FolderOpen size={14} />
            )}
            Relocate to a folder…
          </Button>
          <Button
            variant="ghost"
            onClick={() => void handleDelete()}
            disabled={isRelocating || isDeleting}
            className="h-10 justify-start gap-2 text-muted-foreground hover:text-destructive"
          >
            {isDeleting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            Remove this workspace from Holaboss
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Picking a folder: choose an empty folder to start fresh, or the
          original workspace folder if you moved it.
        </p>
      </div>
    </div>
  );
}
