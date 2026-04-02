import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { resolveWorkspaceSkills } from "./workspace-skills.js";

const ORIGINAL_ENV = {
  HOLABOSS_EMBEDDED_SKILLS_DIR: process.env.HOLABOSS_EMBEDDED_SKILLS_DIR,
};

const TEMP_DIRS: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}

function writeSkill(root: string, skillId: string, description = `${skillId} skill`): string {
  const skillDir = path.join(root, skillId);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\ndescription: ${description}\n---\n# ${skillId}\n`,
    "utf8"
  );
  return skillDir;
}

afterEach(() => {
  if (ORIGINAL_ENV.HOLABOSS_EMBEDDED_SKILLS_DIR === undefined) {
    delete process.env.HOLABOSS_EMBEDDED_SKILLS_DIR;
  } else {
    process.env.HOLABOSS_EMBEDDED_SKILLS_DIR = ORIGINAL_ENV.HOLABOSS_EMBEDDED_SKILLS_DIR;
  }
  for (const dir of TEMP_DIRS.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveWorkspaceSkills includes embedded defaults when no workspace skills are configured", () => {
  const embeddedRoot = makeTempDir("hb-embedded-skills-");
  process.env.HOLABOSS_EMBEDDED_SKILLS_DIR = embeddedRoot;
  writeSkill(embeddedRoot, "holaboss-runtime");

  const workspaceDir = makeTempDir("hb-workspace-no-skills-");

  assert.deepEqual(resolveWorkspaceSkills(workspaceDir), [
    {
      skill_id: "holaboss-runtime",
      source_dir: fs.realpathSync(path.join(embeddedRoot, "holaboss-runtime")),
      origin: "embedded"
    }
  ]);
});

test("resolveWorkspaceSkills keeps embedded defaults authoritative when workspace skills reuse the same id", () => {
  const embeddedRoot = makeTempDir("hb-embedded-skills-");
  process.env.HOLABOSS_EMBEDDED_SKILLS_DIR = embeddedRoot;
  writeSkill(embeddedRoot, "alpha", "embedded alpha");
  writeSkill(embeddedRoot, "beta", "embedded beta");

  const workspaceDir = makeTempDir("hb-workspace-skills-");
  const workspaceSkillsRoot = path.join(workspaceDir, "skills");
  writeSkill(workspaceSkillsRoot, "alpha", "workspace alpha");
  writeSkill(workspaceSkillsRoot, "gamma", "workspace gamma");
  fs.writeFileSync(path.join(workspaceDir, "workspace.yaml"), "skills:\n  path: skills\n", "utf8");

  const resolved = resolveWorkspaceSkills(workspaceDir);
  assert.deepEqual(
    resolved.map((skill) => ({ skill_id: skill.skill_id, origin: skill.origin })),
    [
      { skill_id: "alpha", origin: "embedded" },
      { skill_id: "beta", origin: "embedded" },
      { skill_id: "gamma", origin: "workspace" }
    ]
  );
  assert.equal(resolved[0]?.source_dir, fs.realpathSync(path.join(embeddedRoot, "alpha")));
});

test("resolveWorkspaceSkills follows explicit enabled ordering across embedded and workspace skills", () => {
  const embeddedRoot = makeTempDir("hb-embedded-skills-");
  process.env.HOLABOSS_EMBEDDED_SKILLS_DIR = embeddedRoot;
  writeSkill(embeddedRoot, "holaboss-runtime");
  writeSkill(embeddedRoot, "beta");

  const workspaceDir = makeTempDir("hb-workspace-enabled-skills-");
  const workspaceSkillsRoot = path.join(workspaceDir, "skills");
  writeSkill(workspaceSkillsRoot, "alpha");
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    ['skills:', '  path: "skills"', '  enabled:', '    - "alpha"', '    - "holaboss-runtime"', '    - "missing"'].join("\n"),
    "utf8"
  );

  const resolved = resolveWorkspaceSkills(workspaceDir);
  assert.deepEqual(
    resolved.map((skill) => ({ skill_id: skill.skill_id, origin: skill.origin })),
    [
      { skill_id: "alpha", origin: "workspace" },
      { skill_id: "holaboss-runtime", origin: "embedded" }
    ]
  );
});

test("resolveWorkspaceSkills ignores legacy agents.proactive.skills_path fallback", () => {
  const embeddedRoot = makeTempDir("hb-embedded-skills-empty-");
  process.env.HOLABOSS_EMBEDDED_SKILLS_DIR = embeddedRoot;
  const workspaceDir = makeTempDir("hb-workspace-legacy-skills-path-");
  const legacySkillsRoot = path.join(workspaceDir, "legacy-skills");
  writeSkill(legacySkillsRoot, "legacy-only");
  fs.writeFileSync(
    path.join(workspaceDir, "workspace.yaml"),
    ['agents:', '  proactive:', '    skills_path: "legacy-skills"'].join("\n"),
    "utf8"
  );

  assert.deepEqual(resolveWorkspaceSkills(workspaceDir), []);
});
