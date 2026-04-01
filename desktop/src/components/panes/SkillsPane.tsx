import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileWarning, FolderTree, Loader2, ScrollText, Search, Sparkles } from "lucide-react";
import { useWorkspaceSelection } from "@/lib/workspaceSelection";

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
  const selectedSkillStatusLabel = selectedSkill?.enabled ? "Enabled in workspace.yaml" : "Available in skills path";

  return (
    <section className="theme-shell soft-vignette neon-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--theme-radius-card)] shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.03),transparent_24%)]" />

      <div className="relative mx-auto min-h-0 max-w-5xl flex-1 p-4">
        {!hasWorkspace ? (
          <EmptyState title="No workspace selected" detail="Select a workspace to load its configured skills." />
        ) : isLoadingCatalog ? (
          <LoadingState label="Loading workspace skills..." />
        ) : errorMessage ? (
          <EmptyState title="Skills failed to load" detail={errorMessage} tone="error" />
        ) : !catalog || !hasSkills ? (
          <EmptyState
            title="No skills found"
            detail={
              catalog
                ? `No skill folders with SKILL.md were found under ${catalog.configured_path}.`
                : "No skill folders with SKILL.md were found for the selected workspace."
            }
          />
        ) : (
          <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="theme-subtle-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-panel-border/35 shadow-card">
              <div className="border-b border-panel-border/35 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-text-dim/72">Registry</div>
                    <div className="mt-1 text-[14px] font-medium text-text-main">Workspace skill catalog</div>
                  </div>
                  <div className="rounded-full border border-panel-border/35 bg-black/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-text-dim/72">
                    {filteredSkills.length} shown
                  </div>
                </div>

                <label className="theme-control-surface mt-4 flex items-center gap-2 rounded-[16px] border border-panel-border/45 px-3 py-2.5 text-[12px] text-text-muted">
                  <Search size={13} className="text-text-dim/72" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search skills by name or summary"
                    className="w-full bg-transparent text-text-main outline-none placeholder:text-text-dim/48"
                  />
                </label>

              </div>

              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                {filteredSkills.length === 0 ? (
                  <div className="rounded-[18px] border border-panel-border/35 bg-black/10 px-4 py-5 text-[12px] leading-6 text-text-dim/76">
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
                      className={`group relative overflow-hidden rounded-[20px] border px-4 py-4 text-left transition-all duration-200 ${
                        active
                          ? "border-[rgba(247,90,84,0.3)] bg-[linear-gradient(145deg,rgba(247,90,84,0.08),rgba(255,255,255,0.02))] shadow-card"
                          : "border-panel-border/35 bg-panel-bg/18 hover:border-[rgba(247,90,84,0.24)] hover:bg-[var(--theme-hover-bg)]"
                      }`}
                    >
                      <div
                        className={`absolute inset-y-4 left-0 w-1 rounded-r-full transition-all duration-200 ${
                          active ? "bg-[rgba(247,90,84,0.82)]" : "bg-transparent group-hover:bg-[rgba(247,90,84,0.35)]"
                        }`}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-text-main">{skill.title}</div>
                          <div className="mt-1 truncate text-[11px] uppercase tracking-[0.14em] text-text-dim/72">
                            {skill.skill_id}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                            skill.enabled
                              ? "border-[rgba(247,90,84,0.24)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.92)]"
                              : "border-panel-border/35 bg-black/10 text-text-dim/74"
                          }`}
                        >
                          {skill.enabled ? "Enabled" : "Detected"}
                        </span>
                      </div>
                      <div
                        className="mt-2 text-[12px] leading-6 text-text-muted/82"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden"
                        }}
                      >
                        {skill.summary}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em] text-text-dim/68">
                        <span>{formatModifiedAt(skill.modified_at)}</span>
                        <span>{skill.enabled ? "Configured" : "Detected"}</span>
                      </div>
                    </button>
                  );
                    })}
                  </div>
                )}
              </div>
            </aside>

            <div className="theme-subtle-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-panel-border/35 shadow-card">
              {selectedSkill ? (
                <>
                  <div className="relative overflow-hidden border-b border-panel-border/35 px-5 py-5">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(247,90,84,0.08),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.04),transparent_32%)]" />
                    <div className="relative">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2 rounded-full border border-panel-border/35 bg-black/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-text-dim/76">
                            <FolderTree size={12} className="text-text-dim/78" />
                            <span>{selectedSkill.skill_id}</span>
                          </div>
                          <div className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-text-main">{selectedSkill.title}</div>
                          <div className="mt-2 max-w-[760px] text-[13px] leading-7 text-text-muted/84">{selectedSkill.summary}</div>
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
                    <div className="min-h-0 overflow-hidden rounded-[24px] border border-[rgba(17,22,30,0.42)] bg-[rgba(12,16,22,0.96)]">
                      <div className="flex items-center justify-between gap-3 border-b border-panel-border/35 px-4 py-3">
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-text-dim/76">
                          <ScrollText size={13} className="text-[rgba(247,138,132,0.86)]" />
                          <span>Skill definition</span>
                        </div>
                        <div className="max-w-[55%] truncate text-[11px] text-text-dim/72">{selectedSkill.skill_file_path}</div>
                      </div>
                      {isLoadingPreview ? (
                        <div className="flex min-h-[360px] items-center justify-center">
                          <LoadingState label="Loading SKILL.md..." />
                        </div>
                      ) : skillPreview?.kind === "text" ? (
                        <pre className="h-full min-h-[360px] overflow-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0.12))] px-5 py-4 font-mono text-[11px] leading-6 text-[rgba(235,239,244,0.92)]">
                          {skillPreview.content || ""}
                        </pre>
                      ) : (
                        <div className="px-4 py-6 text-[12px] text-text-muted/82">SKILL.md preview is not available.</div>
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
    <div
      className={`rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] ${
        active
          ? "border-[rgba(247,90,84,0.24)] bg-[rgba(247,90,84,0.08)] text-[rgba(206,92,84,0.92)]"
          : "border-panel-border/35 bg-black/10 text-text-dim/74"
      }`}
    >
      {label}
    </div>
  );
}

function MetadataRow({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-[16px] border border-panel-border/35 bg-[var(--theme-subtle-bg)] px-3 py-2 ${className}`.trim()}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-dim/72">{label}</div>
      <div className="mt-1 break-all text-[12px] text-text-main/86">{value}</div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-[12px] text-text-muted">
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
    <div className="flex h-full min-h-[320px] items-center justify-center px-6 py-8">
      <div
        className={`w-full max-w-[420px] rounded-[24px] border px-8 py-9 text-center shadow-card ${
          tone === "error"
            ? "border-[rgba(255,153,102,0.24)] bg-[linear-gradient(180deg,rgba(255,153,102,0.08),rgba(255,255,255,0.38))]"
            : "border-panel-border/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(255,255,255,0.42))]"
        }`}
      >
        <div
          className={`mx-auto grid h-10 w-10 place-items-center rounded-full border ${
            tone === "error"
              ? "border-[rgba(255,153,102,0.24)] text-[rgba(255,153,102,0.92)]"
              : "border-[rgba(247,90,84,0.18)] text-[rgba(247,90,84,0.84)]"
          }`}
        >
          {tone === "error" ? <FileWarning size={18} /> : <Sparkles size={18} />}
        </div>
        <div className="mt-3 text-[16px] font-medium text-text-main">{title}</div>
        <div className="mt-2 text-[12px] leading-6 text-text-muted/82">{detail}</div>
      </div>
    </div>
  );
}
