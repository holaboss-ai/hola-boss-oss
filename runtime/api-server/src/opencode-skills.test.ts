import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { runOpencodeSkillsCli, stageOpencodeSkills } from "./opencode-skills.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function writeWorkspaceYaml(workspaceDir: string, content: string): void {
  fs.writeFileSync(path.join(workspaceDir, "workspace.yaml"), content, "utf8");
}

function makeRequest(workspaceRoot: string, runtimeRoot: string) {
  const workspaceDir = path.join(workspaceRoot, "workspace-1");
  const skillDir = path.join(workspaceDir, "skills", "skill-creator");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Skill Creator\n", "utf8");
  writeWorkspaceYaml(
    workspaceDir,
    [
      "skills:",
      '  path: "skills"',
      "  enabled:",
      '    - "skill-creator"'
    ].join("\n")
  );
  return {
    workspace_dir: workspaceDir,
    runtime_root: runtimeRoot
  };
}

test("stageOpencodeSkills stages skills into workspace and runtime roots", () => {
  const workspaceRoot = makeTempRoot("hb-opencode-skills-workspace-");
  const runtimeRoot = makeTempRoot("hb-opencode-skills-runtime-");
  const request = makeRequest(workspaceRoot, runtimeRoot);

  const result = stageOpencodeSkills(request);

  assert.deepEqual(result, { changed: true, skill_ids: ["skill-creator"] });
  assert.ok(fs.existsSync(path.join(request.workspace_dir, ".opencode", "skills", "skill-creator", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(runtimeRoot, ".opencode", "skills", "skill-creator", "SKILL.md")));
});

test("stageOpencodeSkills is a no-op when manifests already match", () => {
  const workspaceRoot = makeTempRoot("hb-opencode-skills-workspace-");
  const runtimeRoot = makeTempRoot("hb-opencode-skills-runtime-");
  const request = makeRequest(workspaceRoot, runtimeRoot);

  const first = stageOpencodeSkills(request);
  const second = stageOpencodeSkills(request);

  assert.deepEqual(first, { changed: true, skill_ids: ["skill-creator"] });
  assert.deepEqual(second, { changed: false, skill_ids: ["skill-creator"] });
});

test("stageOpencodeSkills resolves all workspace skills when enabled list is omitted", () => {
  const workspaceRoot = makeTempRoot("hb-opencode-skills-workspace-all-");
  const runtimeRoot = makeTempRoot("hb-opencode-skills-runtime-all-");
  const workspaceDir = path.join(workspaceRoot, "workspace-1");
  const alphaDir = path.join(workspaceDir, "skills", "alpha");
  const betaDir = path.join(workspaceDir, "skills", "beta");
  fs.mkdirSync(alphaDir, { recursive: true });
  fs.mkdirSync(betaDir, { recursive: true });
  fs.writeFileSync(path.join(alphaDir, "SKILL.md"), "# Alpha\n", "utf8");
  fs.writeFileSync(path.join(betaDir, "SKILL.md"), "# Beta\n", "utf8");
  writeWorkspaceYaml(
    workspaceDir,
    [
      "skills:",
      '  path: "skills"'
    ].join("\n")
  );

  const result = stageOpencodeSkills({
    workspace_dir: workspaceDir,
    runtime_root: runtimeRoot
  });

  assert.deepEqual(result, { changed: true, skill_ids: ["alpha", "beta"] });
});

test("stageOpencodeSkills removes stale staged roots when workspace skills are disabled", () => {
  const workspaceRoot = makeTempRoot("hb-opencode-skills-workspace-disabled-");
  const runtimeRoot = makeTempRoot("hb-opencode-skills-runtime-disabled-");
  const request = makeRequest(workspaceRoot, runtimeRoot);
  stageOpencodeSkills(request);
  writeWorkspaceYaml(request.workspace_dir, "name: workspace\n");

  const result = stageOpencodeSkills(request);

  assert.deepEqual(result, { changed: true, skill_ids: [] });
  assert.equal(fs.existsSync(path.join(request.workspace_dir, ".opencode", "skills")), false);
  assert.equal(fs.existsSync(path.join(runtimeRoot, ".opencode", "skills")), false);
});

test("runOpencodeSkillsCli writes JSON response for a valid request", async () => {
  const workspaceRoot = makeTempRoot("hb-opencode-skills-workspace-");
  const runtimeRoot = makeTempRoot("hb-opencode-skills-runtime-");
  const request = makeRequest(workspaceRoot, runtimeRoot);
  let stdout = "";
  let stderr = "";

  const exitCode = await runOpencodeSkillsCli(
    ["--request-base64", Buffer.from(JSON.stringify(request), "utf8").toString("base64")],
    {
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
      },
      stageSkills: (parsed) => {
        assert.deepEqual(parsed, request);
        return { changed: true, skill_ids: ["skill-creator"] };
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { changed: true, skill_ids: ["skill-creator"] });
});

test("runOpencodeSkillsCli returns exit code 2 when request is missing", async () => {
  let stdout = "";
  let stderr = "";

  const exitCode = await runOpencodeSkillsCli([], {
    io: {
      stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
      stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
    }
  });

  assert.equal(exitCode, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /request_base64 is required/);
});

test("runOpencodeSkillsCli returns exit code 1 for invalid payload", async () => {
  let stdout = "";
  let stderr = "";

  const exitCode = await runOpencodeSkillsCli(
    ["--request-base64", Buffer.from("[]", "utf8").toString("base64")],
    {
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /request payload must be an object/);
});
