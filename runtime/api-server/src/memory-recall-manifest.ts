import fs from "node:fs";
import path from "node:path";

import type { MemoryEntryRecord, MemoryEntryScope, MemoryEntryType } from "@holaboss/runtime-state-store";
import yaml from "js-yaml";

import type { AgentRecalledMemoryContext } from "./agent-runtime-prompt.js";
import { governanceRuleForMemoryType, assessMemoryFreshness } from "./memory-governance.js";
import type { MemoryModelClientConfig } from "./memory-model-client.js";
import { normalizedStringArray, queryMemoryModelJson } from "./memory-model-client.js";
import { recalledMemoryContextFromEntries } from "./memory-recall.js";

const MAX_MANIFEST_FILES = 200;
const MAX_MANIFEST_FRONTMATTER_LINES = 40;
const MAX_MEMORY_SNIPPET_CHARS = 360;

interface ManifestMemoryRecord {
  path: string;
  absPath: string;
  scope: MemoryEntryScope;
  memoryType: MemoryEntryType;
  title: string;
  summary: string;
  tags: string[];
  updatedAt: string;
  snippet: string;
}

interface SelectorResult {
  selectedPaths: string[];
  reasonsByPath: Map<string, string>;
  matchedTokensByPath: Map<string, string[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clipText(value: string, maxChars: number): string {
  const normalized = compactWhitespace(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function normalizeRelPath(value: string): string {
  return value.split(path.sep).join("/");
}

function resolveMemoryRootDir(workspaceRoot: string, workspaceId: string): string {
  const configured = (process.env.MEMORY_ROOT_DIR ?? "").trim();
  if (!configured) {
    return path.join(workspaceRoot, "memory");
  }
  if (path.isAbsolute(configured)) {
    return path.resolve(configured);
  }
  return path.resolve(path.join(workspaceRoot, configured));
}

function listMarkdownFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const stat = fs.statSync(root, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) {
    return [];
  }
  const stack = [root];
  const files: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(candidate);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(candidate);
      }
    }
  }
  return files.sort();
}

function frontmatterBlock(value: string): string | null {
  const normalized = value.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return typeof match?.[1] === "string" ? match[1] : null;
}

function contentWithoutFrontmatter(value: string): string {
  const normalized = value.replace(/^\uFEFF/, "");
  return normalized.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}

function frontmatterMetadata(rawFrontmatter: string | null): {
  title: string;
  summary: string;
  memoryType: MemoryEntryType | null;
  scope: MemoryEntryScope | null;
  tags: string[];
} {
  if (!rawFrontmatter) {
    return {
      title: "",
      summary: "",
      memoryType: null,
      scope: null,
      tags: [],
    };
  }

  const bounded = rawFrontmatter
    .split(/\r?\n/)
    .slice(0, MAX_MANIFEST_FRONTMATTER_LINES)
    .join("\n");
  let parsed: unknown;
  try {
    parsed = yaml.load(bounded);
  } catch {
    parsed = null;
  }
  if (!isRecord(parsed)) {
    return {
      title: "",
      summary: "",
      memoryType: null,
      scope: null,
      tags: [],
    };
  }
  const title = firstNonEmptyString(parsed.title, parsed.name);
  const summary = firstNonEmptyString(parsed.summary, parsed.description);
  const typeToken = firstNonEmptyString(parsed.memory_type, parsed.type).toLowerCase();
  const scopeToken = firstNonEmptyString(parsed.scope).toLowerCase();
  const memoryType =
    typeToken === "preference" ||
    typeToken === "identity" ||
    typeToken === "fact" ||
    typeToken === "procedure" ||
    typeToken === "blocker" ||
    typeToken === "reference"
      ? (typeToken as MemoryEntryType)
      : null;
  const scope =
    scopeToken === "workspace" || scopeToken === "session" || scopeToken === "user" || scopeToken === "ephemeral"
      ? (scopeToken as MemoryEntryScope)
      : null;
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
        .filter(Boolean)
    : [];

  return {
    title,
    summary,
    memoryType,
    scope,
    tags,
  };
}

function firstHeading(content: string): string {
  const match = content.match(/^\s*#\s+(.+?)\s*$/m);
  return match ? compactWhitespace(match[1]) : "";
}

function firstSummaryLine(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#") && !line.startsWith("- "));
  return lines[0] ? clipText(lines[0], 180) : "";
}

function snippetFromContent(content: string): string {
  return clipText(content, MAX_MEMORY_SNIPPET_CHARS);
}

function scopeFromPath(relPath: string, workspaceId: string): MemoryEntryScope {
  if (relPath.startsWith(`workspace/${workspaceId}/`)) {
    return "workspace";
  }
  if (relPath.startsWith("preference/") || relPath.startsWith("identity/")) {
    return "user";
  }
  if (relPath.includes("/runtime/")) {
    return "session";
  }
  return "workspace";
}

function typeFromPath(relPath: string): MemoryEntryType {
  if (relPath.startsWith("preference/")) {
    return "preference";
  }
  if (relPath.startsWith("identity/")) {
    return "identity";
  }
  if (relPath.includes("/procedures/")) {
    return "procedure";
  }
  if (relPath.includes("/blockers/")) {
    return "blocker";
  }
  if (relPath.includes("/references/") || relPath.includes("/reference/")) {
    return "reference";
  }
  return "fact";
}

function pathSortByUpdatedDescending(records: ManifestMemoryRecord[]): ManifestMemoryRecord[] {
  return [...records].sort((left, right) => {
    const updatedDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (updatedDiff !== 0 && Number.isFinite(updatedDiff)) {
      return updatedDiff;
    }
    return left.path.localeCompare(right.path);
  });
}

function listManifestRecords(params: {
  workspaceRoot: string;
  workspaceId: string;
}): ManifestMemoryRecord[] {
  const memoryRootDir = resolveMemoryRootDir(params.workspaceRoot, params.workspaceId);
  const files = listMarkdownFiles(memoryRootDir);
  const records: ManifestMemoryRecord[] = [];

  for (const absPath of files) {
    const relPath = normalizeRelPath(path.relative(memoryRootDir, absPath));
    if (!relPath || relPath === "MEMORY.md" || relPath.endsWith("/MEMORY.md")) {
      continue;
    }
    if (
      !relPath.startsWith(`workspace/${params.workspaceId}/`) &&
      !relPath.startsWith("preference/") &&
      !relPath.startsWith("identity/")
    ) {
      continue;
    }
    // Keep query-time recall focused on durable memory and knowledge paths.
    if (relPath.includes("/runtime/")) {
      continue;
    }

    let raw: string;
    try {
      raw = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const frontmatter = frontmatterMetadata(frontmatterBlock(raw));
    const content = contentWithoutFrontmatter(raw);
    const stat = fs.statSync(absPath, { throwIfNoEntry: false });
    const updatedAt = stat?.mtime?.toISOString?.() ?? new Date().toISOString();
    const title = firstNonEmptyString(frontmatter.title, firstHeading(content), path.basename(relPath, ".md"));
    const summary = firstNonEmptyString(frontmatter.summary, firstSummaryLine(content), "No summary available.");
    const scope = frontmatter.scope ?? scopeFromPath(relPath, params.workspaceId);
    const memoryType = frontmatter.memoryType ?? typeFromPath(relPath);

    records.push({
      path: relPath,
      absPath,
      scope,
      memoryType,
      title,
      summary,
      tags: frontmatter.tags,
      updatedAt,
      snippet: snippetFromContent(content),
    });
  }
  return pathSortByUpdatedDescending(records).slice(0, MAX_MANIFEST_FILES);
}

function tokenize(value: string): string[] {
  const matches = value.match(/[a-z0-9]{2,}/gi);
  if (!matches) {
    return [];
  }
  return [...new Set(matches.map((token) => token.toLowerCase()))];
}

function fallbackSelectManifestRecords(params: {
  query: string;
  manifest: ManifestMemoryRecord[];
  maxEntries: number;
}): SelectorResult {
  const tokens = tokenize(params.query);
  const scored = params.manifest.map((record) => {
    const searchable = [record.path, record.title, record.summary, ...record.tags, record.memoryType].join(" ").toLowerCase();
    let score = 0;
    const matchedTokens = new Set<string>();
    if (record.scope === "user") {
      score += 4;
    }
    const normalizedQuery = params.query.trim().toLowerCase();
    if (normalizedQuery && searchable.includes(normalizedQuery)) {
      score += 2;
    }
    for (const token of tokens) {
      if (searchable.includes(token)) {
        score += 1;
        matchedTokens.add(token);
      }
    }
    if (record.memoryType === "procedure" && tokens.some((token) => ["how", "steps", "process"].includes(token))) {
      score += 2;
    }
    if (record.memoryType === "blocker" && tokens.some((token) => ["blocked", "denied", "permission"].includes(token))) {
      score += 2;
    }
    if (record.memoryType === "fact" && tokens.some((token) => ["what", "when", "who", "owner"].includes(token))) {
      score += 1;
    }
    return {
      record,
      score,
      matchedTokens: [...matchedTokens],
    };
  });

  const selected = scored
    .filter((item) => item.score > 0 || item.record.scope === "user")
    .sort((left, right) => {
      if (left.record.scope !== right.record.scope) {
        return left.record.scope === "user" ? -1 : 1;
      }
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return right.record.updatedAt.localeCompare(left.record.updatedAt);
    })
    .slice(0, Math.max(1, params.maxEntries));

  const reasonsByPath = new Map<string, string>();
  const matchedTokensByPath = new Map<string, string[]>();
  for (const item of selected) {
    reasonsByPath.set(item.record.path, `fallback_score:${item.score}`);
    matchedTokensByPath.set(item.record.path, item.matchedTokens);
  }
  return {
    selectedPaths: selected.map((item) => item.record.path),
    reasonsByPath,
    matchedTokensByPath,
  };
}

async function modelSelectManifestRecords(params: {
  query: string;
  manifest: ManifestMemoryRecord[];
  maxEntries: number;
  modelClient: MemoryModelClientConfig;
}): Promise<SelectorResult | null> {
  if (params.manifest.length === 0) {
    return null;
  }
  const manifestLines = params.manifest.map((record) =>
    JSON.stringify({
      path: record.path,
      scope: record.scope,
      memory_type: record.memoryType,
      title: record.title,
      summary: record.summary,
      tags: record.tags,
      updated_at: record.updatedAt,
    })
  );
  const payload = await queryMemoryModelJson(params.modelClient, {
    systemPrompt:
      "Select the most relevant memory files for the request. Return strict JSON only: " +
      '{"selections":[{"path":"<path>","reason":"<why relevant>"}]}. ' +
      `Select at most ${Math.max(1, params.maxEntries)} files. Only return paths from the provided manifest.`,
    userPrompt: [
      `Request: ${params.query}`,
      "",
      "Memory manifest (JSONL):",
      ...manifestLines,
    ].join("\n"),
    timeoutMs: 7000,
  });
  if (!payload) {
    return null;
  }

  const selections = Array.isArray(payload.selections) ? payload.selections : [];
  const allowedPaths = new Set(params.manifest.map((record) => record.path));
  const selectedPaths: string[] = [];
  const reasonsByPath = new Map<string, string>();
  const matchedTokensByPath = new Map<string, string[]>();
  for (const selection of selections) {
    if (!isRecord(selection)) {
      continue;
    }
    const selectedPath = firstNonEmptyString(selection.path);
    if (!selectedPath || !allowedPaths.has(selectedPath) || selectedPaths.includes(selectedPath)) {
      continue;
    }
    selectedPaths.push(selectedPath);
    reasonsByPath.set(selectedPath, firstNonEmptyString(selection.reason, "model_selected"));
    matchedTokensByPath.set(selectedPath, []);
    if (selectedPaths.length >= Math.max(1, params.maxEntries)) {
      break;
    }
  }

  if (selectedPaths.length === 0) {
    const fallbackPaths = normalizedStringArray(payload.paths).filter((candidate) => allowedPaths.has(candidate));
    for (const candidate of fallbackPaths.slice(0, Math.max(1, params.maxEntries))) {
      if (selectedPaths.includes(candidate)) {
        continue;
      }
      selectedPaths.push(candidate);
      reasonsByPath.set(candidate, "model_paths");
      matchedTokensByPath.set(candidate, []);
    }
  }

  if (selectedPaths.length === 0) {
    return null;
  }

  return {
    selectedPaths,
    reasonsByPath,
    matchedTokensByPath,
  };
}

function pathScopedEntries(params: {
  entries: MemoryEntryRecord[];
  workspaceId: string;
}): MemoryEntryRecord[] {
  return params.entries.filter((entry) => entry.scope === "user" || entry.workspaceId === params.workspaceId);
}

function entryByPath(entries: MemoryEntryRecord[]): Map<string, MemoryEntryRecord> {
  const map = new Map<string, MemoryEntryRecord>();
  for (const entry of entries) {
    if (!map.has(entry.path)) {
      map.set(entry.path, entry);
    }
  }
  return map;
}

export async function recalledMemoryContextFromManifest(params: {
  query: string;
  workspaceRoot: string;
  workspaceId: string;
  entries: MemoryEntryRecord[];
  maxEntries?: number;
  nowIso?: string | null;
  modelClient?: MemoryModelClientConfig | null;
}): Promise<AgentRecalledMemoryContext | null> {
  const maxEntries = Math.max(1, params.maxEntries ?? 5);
  const scopedEntries = pathScopedEntries({
    entries: params.entries.filter((entry) => entry.status === "active"),
    workspaceId: params.workspaceId,
  });
  const manifest = listManifestRecords({
    workspaceRoot: params.workspaceRoot,
    workspaceId: params.workspaceId,
  });
  if (manifest.length === 0) {
    return recalledMemoryContextFromEntries({
      query: params.query,
      entries: scopedEntries,
      maxEntries,
      nowIso: params.nowIso ?? null,
    });
  }

  const selector =
    (params.modelClient
      ? await modelSelectManifestRecords({
          query: params.query,
          manifest,
          maxEntries,
          modelClient: params.modelClient,
        })
      : null) ??
    fallbackSelectManifestRecords({
      query: params.query,
      manifest,
      maxEntries,
    });

  if (selector.selectedPaths.length === 0) {
    return recalledMemoryContextFromEntries({
      query: params.query,
      entries: scopedEntries,
      maxEntries,
      nowIso: params.nowIso ?? null,
    });
  }

  const manifestByPath = new Map(manifest.map((record) => [record.path, record]));
  const dbEntryByPath = entryByPath(scopedEntries);
  const entries: NonNullable<AgentRecalledMemoryContext["entries"]> = [];
  const traces: NonNullable<AgentRecalledMemoryContext["selection_trace"]> = [];
  for (const selectedPath of selector.selectedPaths.slice(0, maxEntries)) {
    const manifestRecord = manifestByPath.get(selectedPath);
    if (!manifestRecord) {
      continue;
    }
    const persisted = dbEntryByPath.get(selectedPath) ?? null;
    const inferredGovernance = governanceRuleForMemoryType(manifestRecord.memoryType);
    const freshness = assessMemoryFreshness(
      {
        memoryType: persisted?.memoryType ?? manifestRecord.memoryType,
        verificationPolicy: persisted?.verificationPolicy ?? inferredGovernance.verificationPolicy,
        stalenessPolicy: persisted?.stalenessPolicy ?? inferredGovernance.stalenessPolicy,
        staleAfterSeconds: persisted?.staleAfterSeconds ?? inferredGovernance.staleAfterSeconds,
        updatedAt: persisted?.updatedAt ?? manifestRecord.updatedAt,
      },
      params.nowIso ?? null
    );
    const scoreReason = selector.reasonsByPath.get(selectedPath) ?? "manifest_selected";
    const matchedTokens = selector.matchedTokensByPath.get(selectedPath) ?? [];
    entries.push({
      scope: persisted?.scope ?? manifestRecord.scope,
      memory_type: persisted?.memoryType ?? manifestRecord.memoryType,
      title: firstNonEmptyString(persisted?.title, manifestRecord.title, selectedPath),
      summary: firstNonEmptyString(persisted?.summary, manifestRecord.summary, "No summary available."),
      path: selectedPath,
      verification_policy: persisted?.verificationPolicy ?? inferredGovernance.verificationPolicy,
      staleness_policy: persisted?.stalenessPolicy ?? inferredGovernance.stalenessPolicy,
      freshness_state: freshness.state,
      freshness_note: freshness.note,
      source_type: persisted?.sourceType ?? null,
      observed_at: persisted?.observedAt ?? null,
      last_verified_at: persisted?.lastVerifiedAt ?? null,
      confidence: persisted?.confidence ?? null,
      updated_at: persisted?.updatedAt ?? manifestRecord.updatedAt,
      excerpt: manifestRecord.snippet || null,
    });
    traces.push({
      memory_id: persisted?.memoryId ?? `manifest:${selectedPath}`,
      score: scoreReason.startsWith("fallback_score:")
        ? Number.parseFloat(scoreReason.replace("fallback_score:", "")) || 1
        : 1,
      freshness_state: freshness.state,
      matched_tokens: matchedTokens,
      reasons: [scoreReason],
      source_type: persisted?.sourceType ?? "manual",
    });
  }

  if (entries.length === 0) {
    return recalledMemoryContextFromEntries({
      query: params.query,
      entries: scopedEntries,
      maxEntries,
      nowIso: params.nowIso ?? null,
    });
  }
  return {
    entries,
    selection_trace: traces,
  };
}
