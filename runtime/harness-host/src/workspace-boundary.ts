import fs from "node:fs";
import path from "node:path";

export interface WorkspaceBoundaryPolicy {
  workspaceDir: string;
  workspaceRealDir: string;
  overrideRequested: boolean;
}

const WORKSPACE_PATH_KEY_PATTERN =
  /(?:^|_)(?:path|file|filepath|filename|target|source|destination|cwd|dir|directory|root)$/i;
const TOOL_COMMAND_KEY_PATTERN = /^(?:command|cmd|script)$/i;
const WORKSPACE_LOCAL_TOOL_NAMES = new Set([
  "read",
  "edit",
  "write",
  "bash",
  "glob",
  "grep",
  "find",
  "ls",
  "list",
  "mkdir",
  "rm",
  "mv",
  "cp",
  "todoread",
  "todowrite",
  "skill",
]);

function shouldEnforceWorkspaceBoundaryForTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("mcp__") || normalized.startsWith("holaboss_")) {
    return false;
  }
  return WORKSPACE_LOCAL_TOOL_NAMES.has(normalized);
}

function normalizedWorkspaceDir(workspaceDir: string): { resolved: string; real: string } {
  const resolved = path.resolve(workspaceDir);
  try {
    return { resolved, real: fs.realpathSync(resolved) };
  } catch {
    return { resolved, real: resolved };
  }
}

function isPathInsideWorkspaceRoot(workspaceRealDir: string, candidatePath: string): boolean {
  const normalizedRoot = path.resolve(workspaceRealDir);
  const normalizedCandidate = path.resolve(candidatePath);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolvePathWithinWorkspace(
  policy: Pick<WorkspaceBoundaryPolicy, "workspaceDir" | "workspaceRealDir">,
  candidate: string
): string | null {
  const raw = candidate.trim();
  if (!raw) {
    return null;
  }
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(policy.workspaceDir, raw);
  let canonical = resolved;
  try {
    canonical = fs.realpathSync(resolved);
  } catch {
    canonical = resolved;
  }
  return isPathInsideWorkspaceRoot(policy.workspaceRealDir, canonical) ? canonical : null;
}

export function createWorkspaceBoundaryPolicy(
  workspaceDir: string,
  overrideRequested: boolean
): WorkspaceBoundaryPolicy {
  const normalized = normalizedWorkspaceDir(workspaceDir);
  return {
    workspaceDir: normalized.resolved,
    workspaceRealDir: normalized.real,
    overrideRequested,
  };
}

function commandTokens(command: string): string[] {
  const tokens: string[] = [];
  const tokenPattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`|(\S+)/g;
  let match: RegExpExecArray | null = tokenPattern.exec(command);
  while (match) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    const trimmed = value.trim();
    if (trimmed) {
      tokens.push(trimmed);
    }
    match = tokenPattern.exec(command);
  }
  return tokens;
}

function pathCandidatesFromCommandToken(token: string): string[] {
  const candidates = new Set<string>();
  const normalized = token.trim();
  if (!normalized) {
    return [];
  }
  candidates.add(normalized);

  const assignmentIndex = normalized.indexOf("=");
  if (assignmentIndex >= 0 && assignmentIndex < normalized.length - 1) {
    candidates.add(normalized.slice(assignmentIndex + 1));
  }

  if (normalized.startsWith("--")) {
    const pathMatch = normalized.match(/^--(?:cwd|directory|dir|path|file|root)=(.+)$/i);
    if (pathMatch?.[1]) {
      candidates.add(pathMatch[1]);
    }
  }
  return [...candidates];
}

function commandPathLooksExternal(pathValue: string): boolean {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return false;
  }
  if (trimmed === ".." || trimmed.startsWith("../") || trimmed.includes("/../") || trimmed.includes("\\..\\")) {
    return true;
  }
  if (trimmed.startsWith("~")) {
    return true;
  }
  return false;
}

function workspaceBoundaryViolationForCommand(command: string, policy: WorkspaceBoundaryPolicy): string | null {
  const trimmed = command.trim();
  if (!trimmed || policy.overrideRequested) {
    return null;
  }

  const tokens = commandTokens(trimmed);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const normalized = token.toLowerCase();

    if (normalized === "cd") {
      const destination = tokens[index + 1] ?? "";
      if (commandPathLooksExternal(destination)) {
        return `command uses external directory '${destination}'`;
      }
      const resolved = resolvePathWithinWorkspace(policy, destination);
      if (destination.trim() && !resolved) {
        return `command changes directory outside workspace: '${destination}'`;
      }
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      const repositoryRoot = tokens[index + 2] ?? "";
      if (!repositoryRoot.trim()) {
        continue;
      }
      if (commandPathLooksExternal(repositoryRoot)) {
        return `git command points outside workspace: '${repositoryRoot}'`;
      }
      if (!resolvePathWithinWorkspace(policy, repositoryRoot)) {
        return `git command points outside workspace: '${repositoryRoot}'`;
      }
      continue;
    }

    for (const candidate of pathCandidatesFromCommandToken(token)) {
      if (!candidate) {
        continue;
      }
      if (commandPathLooksExternal(candidate)) {
        return `command references outside-workspace path '${candidate}'`;
      }
      const hasPathSignal =
        path.isAbsolute(candidate) ||
        candidate.includes("/") ||
        candidate.includes("\\") ||
        candidate.startsWith(".");
      if (!hasPathSignal) {
        continue;
      }
      if (!resolvePathWithinWorkspace(policy, candidate)) {
        return `command references outside-workspace path '${candidate}'`;
      }
    }
  }
  return null;
}

function workspacePathViolationForValue(
  value: string,
  pathRef: string,
  policy: WorkspaceBoundaryPolicy
): string | null {
  const trimmed = value.trim();
  if (!trimmed || policy.overrideRequested) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return null;
  }
  if (commandPathLooksExternal(trimmed)) {
    return `${pathRef} points outside workspace: '${trimmed}'`;
  }
  if (!resolvePathWithinWorkspace(policy, trimmed)) {
    return `${pathRef} points outside workspace: '${trimmed}'`;
  }
  return null;
}

export function workspaceBoundaryViolationForToolCall(params: {
  toolName: string;
  toolParams: unknown;
  policy: WorkspaceBoundaryPolicy;
}): string | null {
  const normalizedToolName = params.toolName.trim().toLowerCase();
  if (!normalizedToolName) {
    return null;
  }
  if (!shouldEnforceWorkspaceBoundaryForTool(normalizedToolName)) {
    return null;
  }
  if (params.policy.overrideRequested) {
    return null;
  }
  if (!isRecord(params.toolParams)) {
    return null;
  }

  const queue: Array<{ value: unknown; ref: string }> = [{ value: params.toolParams, ref: "params" }];
  while (queue.length > 0) {
    const current = queue.shift() as { value: unknown; ref: string };
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => queue.push({ value: entry, ref: `${current.ref}[${index}]` }));
      continue;
    }
    if (!isRecord(current.value)) {
      continue;
    }

    for (const [key, value] of Object.entries(current.value)) {
      const childRef = `${current.ref}.${key}`;
      if (typeof value === "string") {
        if (TOOL_COMMAND_KEY_PATTERN.test(key)) {
          const violation = workspaceBoundaryViolationForCommand(value, params.policy);
          if (violation) {
            return violation;
          }
        }
        if (WORKSPACE_PATH_KEY_PATTERN.test(key)) {
          const violation = workspacePathViolationForValue(value, childRef, params.policy);
          if (violation) {
            return violation;
          }
        }
      } else if (value && typeof value === "object") {
        queue.push({ value, ref: childRef });
      }
    }
  }

  return null;
}

export function workspaceBoundaryOverrideRequested(instruction: string): boolean {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    /(?:workspace[_ -]?boundary[_ -]?override\s*[:=]\s*(?:1|true|yes|on))|(?:#allow-outside-workspace)/i.test(
      normalized
    )
  ) {
    return true;
  }
  const insist = /\b(i insist|insist|override|must)\b/i.test(normalized);
  const outsideScope =
    /\b(outside (?:the )?workspace|outside workspace|cross[- ]workspace|parent directory|external path|beyond (?:the )?workspace)\b/i.test(
      normalized
    ) || /(?:\.\.\/|~\/|\/users\/|\/etc\/|\/var\/)/i.test(normalized);
  return insist && outsideScope;
}

export function resolveAttachmentAbsolutePath(params: {
  workspaceDir: string;
  attachmentName: string;
  workspacePath: string;
}): string {
  const policy = createWorkspaceBoundaryPolicy(params.workspaceDir, false);
  const resolved = resolvePathWithinWorkspace(policy, params.workspacePath);
  if (!resolved) {
    throw new Error(
      `Attachment '${params.attachmentName}' resolves outside workspace boundary: ${params.workspacePath}`
    );
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
