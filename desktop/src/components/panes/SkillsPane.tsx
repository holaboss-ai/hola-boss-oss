import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileWarning, Loader2, MoreHorizontal, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";
import { SimpleMarkdown } from "@/components/marketplace/SimpleMarkdown";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function isEmbeddedSkill(skill: WorkspaceSkillRecordPayload): boolean {
  return skill.source_dir.includes("embedded-skills");
}

function parseSkillContent(raw: string): { frontmatter: string; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: "", body: raw };
  }
  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx < 0) {
    return { frontmatter: "", body: raw };
  }
  const frontmatter = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trim();
  return { frontmatter, body };
}

export function SkillsPane() {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [catalog, setCatalog] = useState<WorkspaceSkillListResponsePayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [query, setQuery] = useState("");
  const [detailSkill, setDetailSkill] = useState<WorkspaceSkillRecordPayload | null>(null);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setCatalog(null);
      setIsLoading(false);
      setErrorMessage("");
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setErrorMessage("");

    void window.electronAPI.workspace
      .listSkills(selectedWorkspaceId)
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setErrorMessage(err instanceof Error ? err.message : "Failed to load skills.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedWorkspaceId]);

  const filteredSkills = useMemo(() => {
    const skills = catalog?.skills ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) =>
      [s.skill_id, s.title, s.summary].some((v) => v.toLowerCase().includes(q)),
    );
  }, [catalog?.skills, query]);

  if (!selectedWorkspaceId) {
    return (
      <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
        <EmptyState title="No workspace selected" detail="Select a workspace to view its skills." />
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="relative flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
        <EmptyState title="Skills failed to load" detail={errorMessage} tone="error" />
      </section>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Skills</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {catalog?.skills.length ?? 0} skills available in this workspace.
              </p>
            </div>
            <div className="relative w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search skills..."
                className="h-9 pl-8"
              />
            </div>
          </div>

          {filteredSkills.length === 0 ? (
            <div className="mt-12">
              <EmptyState
                title={query ? "No skills match" : "No skills found"}
                detail={query ? "Try a different search term." : "No SKILL.md files found in the workspace skills directory."}
              />
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3">
              {filteredSkills.map((skill) => (
                <SkillCard
                  key={skill.skill_id}
                  skill={skill}
                  onClick={() => setDetailSkill(skill)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {detailSkill ? (
        <SkillDetailDialog
          skill={detailSkill}
          onClose={() => setDetailSkill(null)}
        />
      ) : null}
    </section>
  );
}

function SkillCard({
  skill,
  onClick,
}: {
  skill: WorkspaceSkillRecordPayload;
  onClick: () => void;
}) {
  const embedded = isEmbeddedSkill(skill);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col rounded-xl border border-border bg-card/60 px-5 py-4 text-left transition-colors hover:bg-accent/40"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-foreground">{skill.skill_id}</span>
          {embedded ? (
            <Sparkles size={13} className="ml-1.5 inline-block text-primary" />
          ) : null}
        </div>
        <span
          className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
            skill.enabled
              ? "justify-end border-primary/40 bg-primary"
              : "justify-start border-border bg-muted"
          }`}
        >
          <span
            className={`size-3.5 rounded-full shadow-sm ${
              skill.enabled ? "mr-0.5 bg-white" : "ml-0.5 bg-muted-foreground/60"
            }`}
          />
        </span>
      </div>

      <p
        className="mt-2.5 text-xs leading-5 text-muted-foreground"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {skill.summary}
      </p>

      <div className="mt-auto flex w-full items-center justify-between gap-3 border-t border-border pt-3" style={{ marginTop: "auto", paddingTop: 12, borderTopWidth: 1 }}>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CheckCircle2 size={12} className="text-muted-foreground/60" />
          <span>{embedded ? "Official" : "Workspace"}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>Updated on {formatDate(skill.modified_at)}</span>
        </div>
        <MoreHorizontal size={16} className="shrink-0 text-muted-foreground/50" />
      </div>
    </button>
  );
}

function SkillDetailDialog({
  skill,
  onClose,
}: {
  skill: WorkspaceSkillRecordPayload;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadContent = useCallback(async () => {
    setIsLoading(true);
    try {
      const preview = await window.electronAPI.fs.readFilePreview(skill.skill_file_path);
      setContent(preview.kind === "text" ? preview.content ?? "" : null);
    } catch {
      setContent(null);
    } finally {
      setIsLoading(false);
    }
  }, [skill.skill_file_path]);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const parsed = useMemo(
    () => (content ? parseSkillContent(content) : null),
    [content],
  );

  const embedded = isEmbeddedSkill(skill);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
      />
      <div className="relative z-10 flex h-[min(85vh,800px)] w-[min(90vw,900px)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{skill.skill_id}.skill</span>
              {embedded ? (
                <Sparkles size={13} className="text-primary" />
              ) : null}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">Skill</div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </Button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
            </div>
          ) : !parsed ? (
            <div className="text-sm text-muted-foreground">SKILL.md content is not available.</div>
          ) : (
            <>
              {parsed.frontmatter ? (
                <div className="mb-6 overflow-hidden rounded-lg border border-border bg-muted">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2">
                    <span className="text-xs font-medium text-muted-foreground">YAML</span>
                  </div>
                  <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-6 text-foreground">
                    {parsed.frontmatter}
                  </pre>
                </div>
              ) : null}

              <div className="prose-custom">
                <SimpleMarkdown>{parsed.body}</SimpleMarkdown>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  tone = "neutral",
}: {
  title: string;
  detail: string;
  tone?: "neutral" | "error";
}) {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center p-6 text-center">
      <div className="max-w-xs">
        {tone === "error" ? (
          <FileWarning size={20} className="mx-auto text-destructive" />
        ) : (
          <Sparkles size={20} className="mx-auto text-muted-foreground" />
        )}
        <div className="mt-3 text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}
