import fs from "node:fs/promises";
import path from "node:path";

const SESSION_SCRATCHPAD_DIR_SEGMENTS = [".holaboss", "scratchpads"] as const;
const SESSION_SCRATCHPAD_PREVIEW_CHARS = 280;

export type SessionScratchpadWriteOperation = "append" | "replace" | "clear";

export interface SessionScratchpadPayload {
  exists: boolean;
  file_path: string;
  updated_at: string | null;
  size_bytes: number;
  preview: string | null;
  content?: string | null;
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScratchpadContent(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return normalized ? `${normalized}\n` : "";
}

function scratchpadPreview(content: string): string | null {
  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= SESSION_SCRATCHPAD_PREVIEW_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, SESSION_SCRATCHPAD_PREVIEW_CHARS - 1).trimEnd()}…`;
}

function sanitizeSessionScratchpadSegment(sessionId: string): string {
  const normalized = nonEmptyString(sessionId);
  if (!normalized) {
    throw new Error("session_id is required");
  }
  return normalized.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "session";
}

export function sessionScratchpadRelativePath(sessionId: string): string {
  return path.posix.join(
    ...SESSION_SCRATCHPAD_DIR_SEGMENTS,
    `${sanitizeSessionScratchpadSegment(sessionId)}.md`,
  );
}

function sessionScratchpadAbsolutePath(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
}): { absolutePath: string; relativePath: string } {
  const relativePath = sessionScratchpadRelativePath(params.sessionId);
  return {
    absolutePath: path.join(params.workspaceRoot, params.workspaceId, relativePath),
    relativePath,
  };
}

export async function readSessionScratchpad(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
  includeContent?: boolean;
}): Promise<SessionScratchpadPayload> {
  const { absolutePath, relativePath } = sessionScratchpadAbsolutePath(params);
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return {
        exists: false,
        file_path: relativePath,
        updated_at: null,
        size_bytes: 0,
        preview: null,
        ...(params.includeContent ? { content: null } : {}),
      };
    }

    const content = await fs.readFile(absolutePath, "utf8");
    return {
      exists: true,
      file_path: relativePath,
      updated_at: stat.mtime.toISOString(),
      size_bytes: stat.size,
      preview: scratchpadPreview(content),
      ...(params.includeContent ? { content } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exists: false,
        file_path: relativePath,
        updated_at: null,
        size_bytes: 0,
        preview: null,
        ...(params.includeContent ? { content: null } : {}),
      };
    }
    throw error;
  }
}

export async function writeSessionScratchpad(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
  op: SessionScratchpadWriteOperation;
  content?: string | null;
}): Promise<SessionScratchpadPayload> {
  const { absolutePath } = sessionScratchpadAbsolutePath(params);
  if (params.op === "clear") {
    try {
      await fs.unlink(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    return readSessionScratchpad({
      workspaceRoot: params.workspaceRoot,
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
    });
  }

  const nextContent = normalizeScratchpadContent(String(params.content ?? ""));
  if (!nextContent) {
    throw new Error("content is required");
  }

  let resolvedContent = nextContent;
  if (params.op === "append") {
    const existing = await readSessionScratchpad({
      workspaceRoot: params.workspaceRoot,
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      includeContent: true,
    });
    const previousContent = existing.exists ? String(existing.content ?? "") : "";
    const normalizedPrevious = previousContent.trimEnd();
    resolvedContent = normalizedPrevious ? `${normalizedPrevious}\n\n${nextContent}` : nextContent;
  }

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp`;
  await fs.writeFile(tempPath, resolvedContent, "utf8");
  await fs.rename(tempPath, absolutePath);

  return readSessionScratchpad({
    workspaceRoot: params.workspaceRoot,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
  });
}
