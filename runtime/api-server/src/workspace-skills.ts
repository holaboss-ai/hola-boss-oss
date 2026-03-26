import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

export interface ResolvedWorkspaceSkill {
  skill_id: string;
  source_dir: string;
}

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

function readWorkspaceYamlMapping(workspaceDir: string): Record<string, unknown> | null {
  const workspaceYamlPath = path.join(path.resolve(workspaceDir), "workspace.yaml");
  if (!fs.existsSync(workspaceYamlPath)) {
    return null;
  }
  try {
    const loaded = yaml.load(fs.readFileSync(workspaceYamlPath, "utf8"));
    return loaded && typeof loaded === "object" && !Array.isArray(loaded) ? (loaded as Record<string, unknown>) : null;
  } catch {
    return null;
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

export function resolveWorkspaceSkills(workspaceDirInput: string): ResolvedWorkspaceSkill[] {
  const workspaceDir = path.resolve(workspaceDirInput);
  let workspaceRealRoot: string;
  try {
    workspaceRealRoot = fs.realpathSync(workspaceDir);
  } catch {
    return [];
  }
  const payload = readWorkspaceYamlMapping(workspaceDir);
  if (!payload) {
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

  const skillsStats = fs.statSync(skillsRealPath, { throwIfNoEntry: false });
  if (!skillsStats?.isDirectory()) {
    return [];
  }

  let selectedSkillIds = workspaceEnabledSkillIds(payload);
  if (selectedSkillIds.length === 0) {
    selectedSkillIds = fs
      .readdirSync(skillsRealPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRealPath, entry.name, "SKILL.md")))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  }

  const resolvedSkills: ResolvedWorkspaceSkill[] = [];
  for (const skillId of selectedSkillIds) {
    const normalizedSkillId = normalizeSkillId(skillId);
    if (!normalizedSkillId) {
      continue;
    }
    const sourceDir = path.resolve(skillsRealPath, normalizedSkillId);
    let sourceRealPath: string;
    try {
      sourceRealPath = fs.realpathSync(sourceDir);
    } catch {
      continue;
    }
    const relativeSourcePath = path.relative(workspaceRealRoot, sourceRealPath);
    if (relativeSourcePath.startsWith("..") || path.isAbsolute(relativeSourcePath)) {
      continue;
    }
    if (!fs.existsSync(path.join(sourceRealPath, "SKILL.md"))) {
      continue;
    }
    resolvedSkills.push({
      skill_id: normalizedSkillId,
      source_dir: sourceRealPath,
    });
  }
  return resolvedSkills;
}
