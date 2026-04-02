import { useEffect, useMemo, useState } from "react";
import { FileWarning, FolderTree, Loader2, ScrollText, Search, Sparkles } from "lucide-react";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

function formatModifiedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

export function SkillsPane() {
  const { selectedWorkspaceId } = useWorkspaceSelection();
  const [catalog, setCatalog] = useState<WorkspaceSkillListResponsePayload | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [skillPreview, setSkillPreview] = useState<FilePreviewPayload | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setCatalog(null);
      setSelectedSkillId("");
      setSkillPreview(null);
      setIsLoadingCatalog(false);
      setIsLoadingPreview(false);
      setErrorMessage("");
      return;
    }

    let cancelled = false;

    async function loadCatalog() {
      setIsLoadingCatalog(true);
      setErrorMessage("");
      try {
        const nextCatalog = await window.electronAPI.workspace.listSkills(selectedWorkspaceId);
        if (cancelled) {
          return;
        }
        setCatalog(nextCatalog);
        setSelectedSkillId((current) => {
          if (current && nextCatalog.skills.some((skill) => skill.skill_id === current)) {
            return current;
          }
          return nextCatalog.skills.find((skill) => skill.enabled)?.skill_id || nextCatalog.skills[0]?.skill_id || "";
        });
      } catch (error) {
        if (!cancelled) {
          setCatalog(null);
          setSelectedSkillId("");
          setSkillPreview(null);
          setErrorMessage(normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingCatalog(false);
        }
      }
    }

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceId]);

  const selectedSkill = useMemo(
    () => catalog?.skills.find((skill) => skill.skill_id === selectedSkillId) ?? null,
    [catalog, selectedSkillId]
  );
  const filteredSkills = useMemo(() => {
    const skills = catalog?.skills ?? [];
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) {
      return skills;
    }
    return skills.filter((skill) =>
      [skill.skill_id, skill.title, skill.summary].some((value) => value.toLowerCase().includes(trimmedQuery))
    );
  }, [catalog?.skills, query]);

  useEffect(() => {
    const skillFilePath = selectedSkill?.skill_file_path;
    if (!skillFilePath) {
      setSkillPreview(null);
      setIsLoadingPreview(false);
      return;
    }
    const resolvedSkillFilePath: string = skillFilePath;

    let cancelled = false;

    async function loadPreview() {
      setIsLoadingPreview(true);
      try {
        const preview = await window.electronAPI.fs.readFilePreview(resolvedSkillFilePath);
        if (!cancelled) {
          setSkillPreview(preview);
        }
      } catch (error) {
        if (!cancelled) {
          setSkillPreview(null);
          setErrorMessage((current) => current || normalizeErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPreview(false);
        }
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedSkill?.skill_file_path]);

  const hasWorkspace = Boolean(selectedWorkspaceId);
  const hasSkills = Boolean(catalog?.skills.length);
  const selectedSkillStatusLabel = selectedSkill
    ? selectedSkill.enabled
      ? "Enabled in workspace"
      : "Detected in workspace"
    : "";

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm">
      <div className="relative mx-auto min-h-0 max-w-5xl flex-1 p-4">
        {!hasWorkspace ? (
          <EmptyState title="No workspace selected" detail="Select a workspace to load its available skills." />
        ) : isLoadingCatalog ? (
          <LoadingState label="Loading skills..." />
        ) : errorMessage ? (
          <EmptyState title="Skills failed to load" detail={errorMessage} tone="error" />
        ) : !catalog || !hasSkills ? (
          <EmptyState
            title="No skills found"
            detail={
              catalog
                ? `No workspace skills with SKILL.md were found under ${catalog.configured_path}.`
                : "No skill folders with SKILL.md were found for the selected workspace."
            }
          />
        ) : (
          <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-muted shadow-lg">
              <div className="border-b border-border px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Registry</div>
                    <div className="mt-1 text-sm font-medium text-foreground">Workspace skill catalog</div>
                  </div>
                  <div className="rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {filteredSkills.length} shown
                  </div>
                </div>

                <div className="relative mt-4">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search skills by name or summary"
                    className="pl-8"
                  />
                </div>

              </div>

              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                {filteredSkills.length === 0 ? (
                  <div className="rounded-xl border border-border bg-muted px-4 py-5 text-xs leading-6 text-muted-foreground">
                    No skills match the current filter.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {filteredSkills.map((skill) => {
                  const active = skill.skill_id === selectedSkillId;
                  return (
                    <button
                      key={skill.skill_id}
                      type="button"
                      onClick={() => setSelectedSkillId(skill.skill_id)}
                      className={`group relative overflow-hidden rounded-xl border px-4 py-4 text-left transition-colors ${
                        active
                          ? "border-primary/30 bg-primary/8 shadow-lg"
                          : "border-border bg-card hover:border-primary/25 hover:bg-accent"
                      }`}
                    >
                      <div
                        className={`absolute inset-y-4 left-0 w-1 rounded-r-full transition-colors ${
                          active ? "bg-primary" : "bg-transparent group-hover:bg-primary/35"
                        }`}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{skill.title}</div>
                          <div className="mt-1 truncate text-xs uppercase tracking-widest text-muted-foreground">
                            {skill.skill_id}
                          </div>
                        </div>
                        <Badge variant="default">Workspace</Badge>
                      </div>
                      <div
                        className="mt-2 text-xs leading-6 text-muted-foreground"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden"
                        }}
                      >
                        {skill.summary}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                        <span>{formatModifiedAt(skill.modified_at)}</span>
                        <span>{skill.enabled ? "Enabled" : "Detected"}</span>
                      </div>
                    </button>
                  );
                    })}
                  </div>
                )}
              </div>
            </aside>

            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-muted shadow-lg">
              {selectedSkill ? (
                <>
                  <div className="relative overflow-hidden border-b border-border px-5 py-5">
                    <div className="pointer-events-none absolute inset-0 bg-primary/5" />
                    <div className="relative">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                            <FolderTree size={12} className="text-muted-foreground" />
                            <span>{selectedSkill.skill_id}</span>
                          </div>
                          <div className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground">{selectedSkill.title}</div>
                          <div className="mt-2 max-w-[760px] text-sm leading-7 text-muted-foreground">{selectedSkill.summary}</div>
                        </div>
                        <StatusPill active={selectedSkill.enabled} label={selectedSkillStatusLabel} />
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <MetadataRow label="Modified" value={formatModifiedAt(selectedSkill.modified_at)} />
                        <MetadataRow label="Source directory" value={selectedSkill.source_dir} />
                        <MetadataRow label="SKILL.md" value={selectedSkill.skill_file_path} />
                      </div>
                    </div>
                  </div>

                  <div className="grid min-h-0 flex-1 gap-4 p-4">
                    <div className="min-h-0 overflow-hidden rounded-xl border border-border bg-background">
                      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                          <ScrollText size={13} className="text-primary" />
                          <span>Skill definition</span>
                        </div>
                        <div className="max-w-[55%] truncate text-xs text-muted-foreground">{selectedSkill.skill_file_path}</div>
                      </div>
                      {isLoadingPreview ? (
                        <div className="flex min-h-[360px] items-center justify-center">
                          <LoadingState label="Loading SKILL.md..." />
                        </div>
                      ) : skillPreview?.kind === "text" ? (
                        <pre className="h-full min-h-[360px] overflow-auto bg-muted px-5 py-4 font-mono text-xs leading-6 text-foreground">
                          {skillPreview.content || ""}
                        </pre>
                      ) : (
                        <div className="px-4 py-6 text-xs text-muted-foreground">SKILL.md preview is not available.</div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState title="No skill selected" detail="Choose a skill from the list to inspect its SKILL.md file." />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <Badge variant={active ? "default" : "secondary"}>
      {label}
    </Badge>
  );
}

function MetadataRow({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-muted px-3 py-2 ${className}`.trim()}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 break-all text-xs text-foreground">{value}</div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 size={14} className="animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  tone = "neutral"
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
