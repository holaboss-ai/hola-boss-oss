import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  EvolveSkillCandidateRecord,
  RuntimeStateStore,
  TurnResultRecord,
} from "@holaboss/runtime-state-store";
import yaml from "js-yaml";

import type { MemoryModelClientConfig } from "./memory-model-client.js";
import { queryMemoryModelJson } from "./memory-model-client.js";
import type { MemoryServiceLike } from "./memory.js";
import { resolveWorkspaceSkills } from "./workspace-skills.js";

const SKILL_REVIEW_INTERVAL_TURNS = 5;
const RECENT_SKILL_REVIEW_TURN_LIMIT = 5;
const RECENT_SKILL_REVIEW_USER_MESSAGES_LIMIT = 4;
const MIN_SKILL_CONFIDENCE = 0.72;

export type SkillCreatePromotionResult =
  | { status: "missing_candidate" | "not_ready" | "missing_draft" | "invalid_live_skill"; targetSkillPath: string | null }
  | { status: "already_promoted" | "promoted_existing_live_skill" | "promoted_from_draft"; targetSkillPath: string };

export interface SkillCreateCandidateDraft {
  kind: "skill_create";
  title: string;
  summary: string;
  slug: string;
  skillMarkdown: string;
  confidence: number | null;
  evaluationNotes: string | null;
  sourceTurnInputIds: string[];
}

export interface SkillCreateCandidateReviewResult {
  draft: SkillCreateCandidateDraft | null;
  reason: "not_due" | "no_model" | "no_candidate" | "duplicate" | "too_weak" | "candidate_ready";
}

interface SkillReviewContext {
  modelClient: MemoryModelClientConfig | null;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  instruction: string;
  assistantText: string;
  toolUsageSummary: Record<string, unknown>;
  permissionDenials: Array<Record<string, unknown>>;
  recentUserMessages: string[];
  recentTurnSummaries: string[];
  existingSkillIds: string[];
}

interface ExtractedSkillReviewCandidate {
  title: string;
  summary: string;
  slug: string;
  whenToUse: string;
  workflow: string[];
  verification: string[];
  confidence: number | null;
  evaluationNotes: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizeSkillSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workspace-skill";
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return null;
}

function normalizeLines(value: unknown, maxItems: number, maxChars = 220): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const line = clipText(item, maxChars);
    if (!line || seen.has(line)) {
      continue;
    }
    seen.add(line);
    normalized.push(line);
    if (normalized.length >= maxItems) {
      break;
    }
  }
  return normalized;
}

function shouldReviewSkillsOnTurn(completedTurnCount: number): boolean {
  return completedTurnCount > 0 && completedTurnCount % SKILL_REVIEW_INTERVAL_TURNS === 0;
}

function skillCandidateIdForInput(inputId: string): string {
  return `evolve-skill-${inputId}`;
}

export function skillCandidateProposalId(candidateId: string): string {
  return `evolve-proposal-${candidateId}`;
}

function skillCandidatePath(workspaceId: string, candidateId: string): string {
  return `workspace/${workspaceId}/evolve/skills/${candidateId}/SKILL.md`;
}

export function promotedWorkspaceSkillPath(slug: string): string {
  return `skills/${normalizeSkillSlug(slug)}/SKILL.md`;
}

function fingerprintText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidateMarkdown(draft: ExtractedSkillReviewCandidate, sourceTurnInputIds: string[]): string {
  const lines = [
    "---",
    `name: ${draft.slug}`,
    `description: ${draft.summary}`,
    "---",
    `# ${draft.title}`,
    "",
    "## When To Use",
    draft.whenToUse,
    "",
    "## Workflow",
    ...(draft.workflow.length > 0
      ? draft.workflow.map((step, index) => `${index + 1}. ${step}`)
      : ["1. Review the linked source turn and refine this draft before promotion."]),
    "",
    "## Verification",
    ...(draft.verification.length > 0
      ? draft.verification.map((step) => `- ${step}`)
      : ["- Verify the workflow against the current workspace before promotion."]),
    "",
    "## Source Context",
    `- Proposed by evolve from turn ids: ${sourceTurnInputIds.map((value) => `\`${value}\``).join(", ") || "`unknown`"}.`,
  ];
  if (draft.evaluationNotes) {
    lines.push(`- Evaluation notes: ${draft.evaluationNotes}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

async function upsertWorkspaceMemoryFileIfChanged(params: {
  memoryService: MemoryServiceLike;
  workspaceId: string;
  path: string;
  content: string;
}): Promise<void> {
  const existing = await params.memoryService.get({
    workspace_id: params.workspaceId,
    path: params.path,
  });
  if ((existing.text as string | undefined) === params.content) {
    return;
  }
  await params.memoryService.upsert({
    workspace_id: params.workspaceId,
    path: params.path,
    content: params.content,
    append: false,
  });
}

function activeCandidate(records: EvolveSkillCandidateRecord[]): EvolveSkillCandidateRecord[] {
  return records.filter((record) => !["dismissed", "discarded"].includes(record.status));
}

function readWorkspaceYamlDocument(workspaceDir: string): Record<string, unknown> | null {
  const workspaceYamlPath = path.join(workspaceDir, "workspace.yaml");
  if (!fs.existsSync(workspaceYamlPath)) {
    return null;
  }
  try {
    const parsed = yaml.load(fs.readFileSync(workspaceYamlPath, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeWorkspaceYamlDocument(workspaceDir: string, document: Record<string, unknown>): void {
  const workspaceYamlPath = path.join(workspaceDir, "workspace.yaml");
  fs.writeFileSync(workspaceYamlPath, yaml.dump(document, { sortKeys: false, noRefs: true }), "utf8");
}

function ensureWorkspaceSkillEnabled(workspaceDir: string, slug: string): void {
  const document = readWorkspaceYamlDocument(workspaceDir);
  if (!document) {
    return;
  }
  const skills = isRecord(document.skills) ? { ...document.skills } : null;
  if (!skills || !Array.isArray(skills.enabled)) {
    return;
  }
  const enabled = skills.enabled
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  if (enabled.includes(slug)) {
    return;
  }
  skills.enabled = [...enabled, slug];
  document.skills = skills;
  writeWorkspaceYamlDocument(workspaceDir, document);
}

function liveWorkspaceSkillExists(workspaceDir: string, slug: string): boolean {
  return resolveWorkspaceSkills(workspaceDir).some((skill) => skill.origin === "workspace" && skill.skill_id === slug);
}

function existingWorkspaceSkillIds(store: RuntimeStateStore, workspaceId: string): string[] {
  return resolveWorkspaceSkills(store.workspaceDir(workspaceId)).map((skill) => skill.skill_id);
}

function recentCompletedTurnSummaries(store: RuntimeStateStore, turnResult: TurnResultRecord): string[] {
  return store
    .listTurnResults({
      workspaceId: turnResult.workspaceId,
      sessionId: turnResult.sessionId,
      status: "completed",
      limit: RECENT_SKILL_REVIEW_TURN_LIMIT,
      offset: 0,
    })
    .map((item) => clipText(item.compactedSummary ?? item.assistantText ?? "", 220))
    .filter(Boolean);
}

function recentUserMessages(store: RuntimeStateStore, turnResult: TurnResultRecord): string[] {
  return store
    .listSessionMessages({
      workspaceId: turnResult.workspaceId,
      sessionId: turnResult.sessionId,
      role: "user",
      order: "desc",
      limit: RECENT_SKILL_REVIEW_USER_MESSAGES_LIMIT,
      offset: 0,
    })
    .reverse()
    .map((message) => clipText(message.text, 240))
    .filter(Boolean);
}

async function extractSkillCreateCandidateFromModel(context: SkillReviewContext): Promise<ExtractedSkillReviewCandidate | null> {
  if (!context.modelClient) {
    return null;
  }
  const payload = await queryMemoryModelJson(context.modelClient, {
    systemPrompt:
      "Review this completed turn for a reusable workspace-local skill. Return strict JSON only with this shape: " +
      '{"candidate":{"title":"string","summary":"string","slug":"string","when_to_use":"string","workflow":["string"],"verification":["string"],"confidence":0.0,"evaluation_notes":"string"}|null}. ' +
      "Only propose a candidate when the workflow is reusable beyond a single one-off incident. " +
      "Do not propose skills for transient runtime state, general advice, or facts that belong in durable memory instead of a reusable procedure.",
    userPrompt: [
      `Workspace ID: ${context.workspaceId}`,
      `Session ID: ${context.sessionId}`,
      `Input ID: ${context.inputId}`,
      "",
      `Instruction: ${context.instruction || "none"}`,
      "",
      "Recent user messages:",
      ...(context.recentUserMessages.length > 0 ? context.recentUserMessages.map((item) => `- ${item}`) : ["- none"]),
      "",
      "Recent completed turn summaries:",
      ...(context.recentTurnSummaries.length > 0 ? context.recentTurnSummaries.map((item) => `- ${item}`) : ["- none"]),
      "",
      "Latest assistant response:",
      context.assistantText || "none",
      "",
      "Tool usage summary JSON:",
      JSON.stringify(context.toolUsageSummary),
      "",
      "Permission denials JSON:",
      JSON.stringify(context.permissionDenials),
      "",
      "Existing workspace skill ids:",
      context.existingSkillIds.length > 0 ? context.existingSkillIds.join(", ") : "none",
    ].join("\n"),
    timeoutMs: 8000,
  });
  if (!payload || !isRecord(payload.candidate)) {
    return null;
  }
  const candidate = payload.candidate;
  if (candidate === null) {
    return null;
  }
  const title = clipText(String(candidate.title ?? ""), 120);
  const summary = clipText(String(candidate.summary ?? ""), 220);
  const whenToUse = clipText(String(candidate.when_to_use ?? ""), 320);
  const slug = normalizeSkillSlug(String(candidate.slug ?? title));
  const workflow = normalizeLines(candidate.workflow, 8, 240);
  const verification = normalizeLines(candidate.verification, 6, 220);
  const confidence = normalizeConfidence(candidate.confidence);
  const evaluationNotes = clipText(String(candidate.evaluation_notes ?? ""), 280) || null;
  if (!title || !summary || !whenToUse || workflow.length < 2) {
    return null;
  }
  return {
    title,
    summary,
    slug,
    whenToUse,
    workflow,
    verification,
    confidence,
    evaluationNotes,
  };
}

export async function reviewTurnForSkillCreateCandidate(params: {
  store: RuntimeStateStore;
  turnResult: TurnResultRecord;
  modelClient: MemoryModelClientConfig | null;
  instruction: string;
}): Promise<SkillCreateCandidateReviewResult> {
  const completedTurnCount = params.store.countTurnResults({
    workspaceId: params.turnResult.workspaceId,
    sessionId: params.turnResult.sessionId,
    status: "completed",
  });
  if (!shouldReviewSkillsOnTurn(completedTurnCount)) {
    return { draft: null, reason: "not_due" };
  }
  if (!params.modelClient) {
    return { draft: null, reason: "no_model" };
  }
  const existingSkillIds = existingWorkspaceSkillIds(params.store, params.turnResult.workspaceId);
  const extracted = await extractSkillCreateCandidateFromModel({
    modelClient: params.modelClient,
    workspaceId: params.turnResult.workspaceId,
    sessionId: params.turnResult.sessionId,
    inputId: params.turnResult.inputId,
    instruction: params.instruction,
    assistantText: params.turnResult.assistantText,
    toolUsageSummary: params.turnResult.toolUsageSummary,
    permissionDenials: params.turnResult.permissionDenials,
    recentUserMessages: recentUserMessages(params.store, params.turnResult),
    recentTurnSummaries: recentCompletedTurnSummaries(params.store, params.turnResult),
    existingSkillIds,
  });
  if (!extracted) {
    return { draft: null, reason: "no_candidate" };
  }
  if (existingSkillIds.includes(extracted.slug) || existingSkillIds.includes(normalizeSkillSlug(extracted.title))) {
    return { draft: null, reason: "duplicate" };
  }
  if ((extracted.confidence ?? 0) < MIN_SKILL_CONFIDENCE) {
    return { draft: null, reason: "too_weak" };
  }

  const sourceTurnInputIds = [params.turnResult.inputId];
  return {
    draft: {
      kind: "skill_create",
      title: extracted.title,
      summary: extracted.summary,
      slug: extracted.slug,
      skillMarkdown: candidateMarkdown(extracted, sourceTurnInputIds),
      confidence: extracted.confidence,
      evaluationNotes: extracted.evaluationNotes,
      sourceTurnInputIds,
    },
    reason: "candidate_ready",
  };
}

export async function persistSkillCreateCandidate(params: {
  store: RuntimeStateStore;
  memoryService: MemoryServiceLike;
  turnResult: TurnResultRecord;
  draft: SkillCreateCandidateDraft;
}): Promise<EvolveSkillCandidateRecord> {
  const candidateId = skillCandidateIdForInput(params.turnResult.inputId);
  const existingById = params.store.getEvolveSkillCandidate(candidateId);
  if (existingById) {
    return existingById;
  }
  const skillPath = skillCandidatePath(params.turnResult.workspaceId, candidateId);
  const contentFingerprint = fingerprintText(params.draft.skillMarkdown);
  const duplicate = activeCandidate(
    params.store.listEvolveSkillCandidates({
      workspaceId: params.turnResult.workspaceId,
      limit: 200,
      offset: 0,
    })
  ).find((candidate) => candidate.slug === params.draft.slug || candidate.contentFingerprint === contentFingerprint);
  if (duplicate) {
    return duplicate;
  }
  await upsertWorkspaceMemoryFileIfChanged({
    memoryService: params.memoryService,
    workspaceId: params.turnResult.workspaceId,
    path: skillPath,
    content: params.draft.skillMarkdown,
  });
  return params.store.createEvolveSkillCandidate({
    candidateId,
    workspaceId: params.turnResult.workspaceId,
    sessionId: params.turnResult.sessionId,
    inputId: params.turnResult.inputId,
    kind: params.draft.kind,
    title: params.draft.title,
    summary: params.draft.summary,
    slug: params.draft.slug,
    skillPath,
    contentFingerprint,
    confidence: params.draft.confidence,
    evaluationNotes: params.draft.evaluationNotes,
    sourceTurnInputIds: params.draft.sourceTurnInputIds,
  });
}

export async function promoteAcceptedSkillCreateCandidate(params: {
  store: RuntimeStateStore;
  memoryService: MemoryServiceLike;
  candidateId: string;
}): Promise<SkillCreatePromotionResult> {
  const candidate = params.store.getEvolveSkillCandidate(params.candidateId);
  if (!candidate || candidate.kind !== "skill_create") {
    return { status: "missing_candidate", targetSkillPath: null };
  }
  const targetSkillPath = promotedWorkspaceSkillPath(candidate.slug);
  if (candidate.status === "promoted") {
    return { status: "already_promoted", targetSkillPath };
  }
  if (candidate.status !== "accepted") {
    return { status: "not_ready", targetSkillPath };
  }

  const workspaceDir = params.store.workspaceDir(candidate.workspaceId);
  ensureWorkspaceSkillEnabled(workspaceDir, candidate.slug);
  if (liveWorkspaceSkillExists(workspaceDir, candidate.slug)) {
    params.store.updateEvolveSkillCandidate({
      candidateId: candidate.candidateId,
      fields: {
        status: "promoted",
        promotedAt: new Date().toISOString(),
      },
    });
    return { status: "promoted_existing_live_skill", targetSkillPath };
  }

  const draft = await params.memoryService.get({
    workspace_id: candidate.workspaceId,
    path: candidate.skillPath,
  });
  const draftMarkdown = typeof draft.text === "string" ? draft.text : "";
  if (!draftMarkdown.trim()) {
    return { status: "missing_draft", targetSkillPath };
  }

  const targetFilePath = path.join(workspaceDir, targetSkillPath);
  fs.mkdirSync(path.dirname(targetFilePath), { recursive: true });
  const existing = fs.existsSync(targetFilePath) ? fs.readFileSync(targetFilePath, "utf8") : null;
  if (existing !== draftMarkdown) {
    fs.writeFileSync(targetFilePath, draftMarkdown, "utf8");
  }
  ensureWorkspaceSkillEnabled(workspaceDir, candidate.slug);
  if (!liveWorkspaceSkillExists(workspaceDir, candidate.slug)) {
    return { status: "invalid_live_skill", targetSkillPath };
  }

  params.store.updateEvolveSkillCandidate({
    candidateId: candidate.candidateId,
    fields: {
      status: "promoted",
      promotedAt: new Date().toISOString(),
    },
  });
  return { status: "promoted_from_draft", targetSkillPath };
}
