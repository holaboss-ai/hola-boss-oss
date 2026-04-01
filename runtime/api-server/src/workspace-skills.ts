import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

export type ResolvedSkillOrigin = "workspace" | "embedded";

export interface ResolvedWorkspaceSkill {
  skill_id: string;
  source_dir: string;
  origin: ResolvedSkillOrigin;
}

const EMBEDDED_SKILLS_DIR_ENV = "HOLABOSS_EMBEDDED_SKILLS_DIR";

function normalizeSkillId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const skillId = value.trim();
  if (!skillId || skillId === "." || skillId === "..") {
    return null;
  }
  if (skillId.includes("/") || skillId.includes("\\") || skillId.includes("\0")) {
    return null;
  }
  return skillId;
}

function runtimeRootDir(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_ROOT ?? "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function embeddedSkillsRoot(): string {
  const override = (process.env[EMBEDDED_SKILLS_DIR_ENV] ?? "").trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(runtimeRootDir(), "harnesses", "src", "embedded-skills");
}

function readWorkspaceYamlMapping(workspaceDir: string): Record<string, unknown> {
  const workspaceYamlPath = path.join(path.resolve(workspaceDir), "workspace.yaml");
  if (!fs.existsSync(workspaceYamlPath)) {
    return {};
  }
  try {
    const loaded = yaml.load(fs.readFileSync(workspaceYamlPath, "utf8"));
    return loaded && typeof loaded === "object" && !Array.isArray(loaded) ? (loaded as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function workspaceSkillsPathToken(payload: Record<string, unknown>): string | null {
  const skills = payload.skills;
  if (skills && typeof skills === "object" && !Array.isArray(skills)) {
    const raw = (skills as Record<string, unknown>).path;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }

  const agents = payload.agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return null;
  }
  const proactive = (agents as Record<string, unknown>).proactive;
  if (!proactive || typeof proactive !== "object" || Array.isArray(proactive)) {
    return null;
  }
  const raw = (proactive as Record<string, unknown>).skills_path;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function workspaceEnabledSkillIds(payload: Record<string, unknown>): string[] {
  const skills = payload.skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) {
    return [];
  }
  const enabled = (skills as Record<string, unknown>).enabled;
  if (!Array.isArray(enabled)) {
    return [];
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const item of enabled) {
    const skillId = normalizeSkillId(item);
    if (!skillId || seen.has(skillId)) {
      continue;
    }
    seen.add(skillId);
    ordered.push(skillId);
  }
  return ordered;
}

function listSkillsInRoot(skillRoot: string, origin: ResolvedSkillOrigin): ResolvedWorkspaceSkill[] {
  const skillRootPath = path.resolve(skillRoot);
  const stats = fs.statSync(skillRootPath, { throwIfNoEntry: false });
  if (!stats?.isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(skillRootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillId = normalizeSkillId(entry.name);
      if (!skillId) {
        return null;
      }
      const sourceDir = path.join(skillRootPath, entry.name);
      let sourceRealPath: string;
      try {
        sourceRealPath = fs.realpathSync(sourceDir);
      } catch {
        return null;
      }
      if (!fs.existsSync(path.join(sourceRealPath, "SKILL.md"))) {
        return null;
      }
      return {
        skill_id: skillId,
        source_dir: sourceRealPath,
        origin,
      } satisfies ResolvedWorkspaceSkill;
    })
    .filter((skill): skill is ResolvedWorkspaceSkill => Boolean(skill))
    .sort((left, right) => left.skill_id.localeCompare(right.skill_id));
}

function resolveWorkspaceLocalSkills(workspaceDirInput: string, payload: Record<string, unknown>): ResolvedWorkspaceSkill[] {
  const workspaceDir = path.resolve(workspaceDirInput);
  let workspaceRealRoot: string;
  try {
    workspaceRealRoot = fs.realpathSync(workspaceDir);
  } catch {
    return [];
  }

  const skillsPathToken = workspaceSkillsPathToken(payload);
  if (!skillsPathToken) {
    return [];
  }

  const relative = path.normalize(skillsPathToken);
  if (path.isAbsolute(relative) || relative.split(path.sep).includes("..")) {
    return [];
  }

  const skillsPath = path.resolve(workspaceDir, relative);
  let skillsRealPath: string;
  try {
    skillsRealPath = fs.realpathSync(skillsPath);
  } catch {
    return [];
  }
  const relativeSkillsPath = path.relative(workspaceRealRoot, skillsRealPath);
  if (relativeSkillsPath.startsWith("..") || path.isAbsolute(relativeSkillsPath)) {
    return [];
  }

  return listSkillsInRoot(skillsRealPath, "workspace").filter((skill) => {
    const relativeSourcePath = path.relative(workspaceRealRoot, skill.source_dir);
    return !(relativeSourcePath.startsWith("..") || path.isAbsolute(relativeSourcePath));
  });
}

export function resolveWorkspaceSkills(workspaceDirInput: string): ResolvedWorkspaceSkill[] {
  const payload = readWorkspaceYamlMapping(workspaceDirInput);
  const enabledSkillIds = workspaceEnabledSkillIds(payload);
  const embeddedSkills = listSkillsInRoot(embeddedSkillsRoot(), "embedded");
  const workspaceSkills = resolveWorkspaceLocalSkills(workspaceDirInput, payload);

  const resolvedById = new Map<string, ResolvedWorkspaceSkill>();
  for (const skill of workspaceSkills) {
    resolvedById.set(skill.skill_id, skill);
  }
  for (const skill of embeddedSkills) {
    resolvedById.set(skill.skill_id, skill);
  }

  const orderedSkillIds =
    enabledSkillIds.length > 0
      ? enabledSkillIds
      : (() => {
          const ordered: string[] = [];
          const seen = new Set<string>();
          for (const skill of [...embeddedSkills, ...workspaceSkills]) {
            if (seen.has(skill.skill_id)) {
              continue;
            }
            seen.add(skill.skill_id);
            ordered.push(skill.skill_id);
          }
          return ordered;
        })();

  return orderedSkillIds
    .map((skillId) => {
      const normalizedSkillId = normalizeSkillId(skillId);
      return normalizedSkillId ? resolvedById.get(normalizedSkillId) ?? null : null;
    })
    .filter((skill): skill is ResolvedWorkspaceSkill => Boolean(skill));
}
