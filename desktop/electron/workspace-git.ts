import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WORKSPACE_GIT_BRANCH = "main";
const WORKSPACE_GIT_USER_NAME = "Holaboss Agent";
const WORKSPACE_GIT_USER_EMAIL = "agent@holaboss.local";
const WORKSPACE_GIT_INITIAL_COMMIT_MESSAGE = "agent: initialize workspace";
const WORKSPACE_GIT_EXCLUDE_PATTERNS = [
  ".DS_Store",
  ".holaboss/",
  ".opencode/",
  ".output/",
  ".turbo/",
  "build/",
  "coverage/",
  "dist/",
  "node_modules/",
  "workspace.json",
];

export interface WorkspaceGitBootstrapResult {
  initialized: boolean;
  initialCommitCreated: boolean;
  branch: string;
  gitDir: string;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function normalizeCommandError(
  args: string[],
  error: unknown,
): Error {
  if (!(error instanceof Error)) {
    return new Error(`git ${args.join(" ")} failed`);
  }

  const stdout =
    typeof (error as { stdout?: string }).stdout === "string"
      ? (error as { stdout?: string }).stdout?.trim()
      : "";
  const stderr =
    typeof (error as { stderr?: string }).stderr === "string"
      ? (error as { stderr?: string }).stderr?.trim()
      : "";
  const detail = stderr || stdout || error.message;
  return new Error(`git ${args.join(" ")} failed: ${detail}`);
}

async function runGit(
  workspaceDir: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, {
      cwd: workspaceDir,
    });
  } catch (error) {
    throw normalizeCommandError(args, error);
  }
}

async function writeWorkspaceGitExcludeFile(workspaceDir: string): Promise<void> {
  const infoDir = path.join(workspaceDir, ".git", "info");
  await fs.mkdir(infoDir, { recursive: true });
  const excludePath = path.join(infoDir, "exclude");
  const content = [
    "# Holaboss workspace-local excludes",
    ...WORKSPACE_GIT_EXCLUDE_PATTERNS,
    "",
  ].join("\n");
  await fs.writeFile(excludePath, content, "utf8");
}

async function hasStagedChanges(workspaceDir: string): Promise<boolean> {
  const { stdout } = await runGit(workspaceDir, ["diff", "--cached", "--name-only"]);
  return stdout.trim().length > 0;
}

export async function ensureWorkspaceGitRepo(
  workspaceDir: string,
): Promise<WorkspaceGitBootstrapResult> {
  const gitDir = path.join(workspaceDir, ".git");
  if (await pathExists(gitDir)) {
    return {
      initialized: false,
      initialCommitCreated: false,
      branch: WORKSPACE_GIT_BRANCH,
      gitDir,
    };
  }

  await fs.mkdir(workspaceDir, { recursive: true });
  await runGit(workspaceDir, ["init", "--initial-branch", WORKSPACE_GIT_BRANCH]);
  await runGit(workspaceDir, ["config", "user.name", WORKSPACE_GIT_USER_NAME]);
  await runGit(workspaceDir, ["config", "user.email", WORKSPACE_GIT_USER_EMAIL]);
  await writeWorkspaceGitExcludeFile(workspaceDir);
  await runGit(workspaceDir, ["add", "-A"]);

  let initialCommitCreated = false;
  if (await hasStagedChanges(workspaceDir)) {
    await runGit(workspaceDir, [
      "commit",
      "-m",
      WORKSPACE_GIT_INITIAL_COMMIT_MESSAGE,
    ]);
    initialCommitCreated = true;
  }

  return {
    initialized: true,
    initialCommitCreated,
    branch: WORKSPACE_GIT_BRANCH,
    gitDir,
  };
}
