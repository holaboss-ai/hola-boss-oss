import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveWorkspaceSkills, type ResolvedWorkspaceSkill } from "./workspace-skills.js";

const OPENCODE_SKILL_MANIFEST_FILE_NAME = ".skill-manifest.json";

export interface OpencodeSkillsCliRequest {
  workspace_dir: string;
  runtime_root: string;
}

export interface OpencodeSkillsCliResponse {
  changed: boolean;
  skill_ids: string[];
}

function decodeCliRequest(encoded: string): OpencodeSkillsCliRequest {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error("request_base64 is required");
  }
  const raw = Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request payload must be an object");
  }
  return parsed as OpencodeSkillsCliRequest;
}

function removePath(target: string): void {
  if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink() || fs.existsSync(target) && fs.statSync(target).isFile()) {
    fs.rmSync(target, { force: true });
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

function skillManifestPayload(skills: ResolvedWorkspaceSkill[]): Record<string, unknown> {
  return {
    skills: skills.map((skill) => ({
      skill_id: skill.skill_id,
      source_dir: path.resolve(skill.source_dir)
    }))
  };
}

function readSkillManifest(stagedRoot: string): Record<string, unknown> | null {
  const manifestPath = path.join(stagedRoot, OPENCODE_SKILL_MANIFEST_FILE_NAME);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const payload = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stagedSkillRootMatchesManifest(stagedRoot: string, manifestPayload: Record<string, unknown>): boolean {
  const existingManifest = readSkillManifest(stagedRoot);
  if (JSON.stringify(existingManifest) !== JSON.stringify(manifestPayload)) {
    return false;
  }

  const manifestSkills = Array.isArray(manifestPayload.skills) ? manifestPayload.skills as Array<Record<string, unknown>> : [];
  const expectedNames = new Set(
    manifestSkills
      .map((item) => String(item.skill_id ?? "").trim())
      .filter(Boolean)
  );
  if (expectedNames.size === 0) {
    return false;
  }

  const actualNames = new Set(
    fs.readdirSync(stagedRoot).filter((name) => name !== OPENCODE_SKILL_MANIFEST_FILE_NAME)
  );
  if (expectedNames.size !== actualNames.size || [...expectedNames].some((name) => !actualNames.has(name))) {
    return false;
  }

  for (const item of manifestSkills) {
    const skillId = String(item.skill_id ?? "").trim();
    const sourceDir = fs.realpathSync(path.resolve(String(item.source_dir ?? "").trim()));
    const targetDir = path.join(stagedRoot, skillId);
    if (!fs.existsSync(targetDir)) {
      return false;
    }
    const stat = fs.lstatSync(targetDir);
    if (stat.isSymbolicLink()) {
      try {
        if (fs.realpathSync(targetDir) !== sourceDir) {
          return false;
        }
      } catch {
        return false;
      }
      continue;
    }
    if (!fs.existsSync(path.join(targetDir, "SKILL.md"))) {
      return false;
    }
  }

  return true;
}

function writeSkillManifest(stagedRoot: string, manifestPayload: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(stagedRoot, OPENCODE_SKILL_MANIFEST_FILE_NAME),
    JSON.stringify(manifestPayload, null, 2),
    "utf8"
  );
}

function stageSkillRoot(stagedRoot: string, skills: ResolvedWorkspaceSkill[], manifestPayload: Record<string, unknown>): boolean {
  if (fs.existsSync(stagedRoot) && stagedSkillRootMatchesManifest(stagedRoot, manifestPayload)) {
    return false;
  }

  if (fs.existsSync(stagedRoot) || fs.lstatSync(stagedRoot, { throwIfNoEntry: false })?.isSymbolicLink()) {
    removePath(stagedRoot);
  }
  fs.mkdirSync(stagedRoot, { recursive: true });

  for (const skill of skills) {
    const sourceDir = path.resolve(skill.source_dir);
    const targetDir = path.join(stagedRoot, skill.skill_id);
    try {
      fs.symlinkSync(sourceDir, targetDir, "dir");
    } catch {
      fs.cpSync(sourceDir, targetDir, { recursive: true, errorOnExist: true });
    }
  }
  writeSkillManifest(stagedRoot, manifestPayload);
  return true;
}

export function stageOpencodeSkills(request: OpencodeSkillsCliRequest): OpencodeSkillsCliResponse {
  const skills = resolveWorkspaceSkills(request.workspace_dir);

  const workspaceStagedRoot = path.resolve(request.workspace_dir, ".opencode", "skills");
  const runtimeStagedRoot = path.resolve(request.runtime_root, ".opencode", "skills");
  const manifestPayload = skillManifestPayload(skills);
  let changed = false;

  if (skills.length === 0) {
    if (fs.lstatSync(workspaceStagedRoot, { throwIfNoEntry: false })) {
      removePath(workspaceStagedRoot);
      changed = true;
    }
    if (runtimeStagedRoot !== workspaceStagedRoot && fs.lstatSync(runtimeStagedRoot, { throwIfNoEntry: false })) {
      removePath(runtimeStagedRoot);
      changed = true;
    }
    return { changed, skill_ids: [] };
  }

  changed = stageSkillRoot(workspaceStagedRoot, skills, manifestPayload) || changed;
  if (runtimeStagedRoot !== workspaceStagedRoot) {
    changed = stageSkillRoot(runtimeStagedRoot, skills, manifestPayload) || changed;
  }
  return { changed, skill_ids: skills.map((skill) => skill.skill_id) };
}

export async function runOpencodeSkillsCli(
  argv: string[],
  options: {
    io?: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
    stageSkills?: (request: OpencodeSkillsCliRequest) => OpencodeSkillsCliResponse;
  } = {}
): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const requestBase64 = argv[0] === "--request-base64" ? argv[1] ?? "" : argv[0] ?? "";
  if (!requestBase64) {
    io.stderr.write("request_base64 is required\n");
    return 2;
  }
  try {
    const request = decodeCliRequest(requestBase64);
    const result = (options.stageSkills ?? stageOpencodeSkills)(request);
    io.stdout.write(JSON.stringify(result));
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runOpencodeSkillsCli(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
