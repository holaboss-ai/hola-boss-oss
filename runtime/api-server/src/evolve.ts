import { randomUUID } from "node:crypto";

import type { PostRunJobRecord, RuntimeStateStore, TaskProposalRecord } from "@holaboss/runtime-state-store";

import { createBackgroundTaskMemoryModelClient } from "./background-task-model.js";
import {
  persistSkillCreateCandidate,
  reviewTurnForSkillCreateCandidate,
  skillCandidateProposalId,
} from "./evolve-skill-review.js";
import type { MemoryServiceLike } from "./memory.js";
import { writeTurnDurableMemory, type TurnMemoryWritebackModelContext } from "./turn-memory-writeback.js";

export const EVOLVE_JOB_TYPE = "evolve";
export const LEGACY_REINFORCE_MEMORY_WRITEBACK_JOB_TYPE = "reinforce_memory_writeback";
export const LEGACY_DURABLE_MEMORY_WRITEBACK_JOB_TYPE = "durable_memory_writeback";

interface EvolveJobPayload {
  instruction?: string | null;
}

export function createEvolveTaskProposal(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  taskName: string;
  taskPrompt: string;
  taskGenerationRationale: string;
  sourceEventIds?: string[];
  proposalId?: string;
  createdAt?: string;
  state?: string;
}): TaskProposalRecord {
  const existing = params.proposalId ? params.store.getTaskProposal(params.proposalId) : null;
  if (existing) {
    return existing;
  }
  return params.store.createTaskProposal({
    proposalId: params.proposalId ?? randomUUID(),
    workspaceId: params.workspaceId,
    taskName: params.taskName,
    taskPrompt: params.taskPrompt,
    taskGenerationRationale: params.taskGenerationRationale,
    proposalSource: "evolve",
    sourceEventIds: params.sourceEventIds,
    createdAt: params.createdAt ?? new Date().toISOString(),
    state: params.state,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function trimmedInstruction(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function evolveModelContext(params: {
  workspaceId: string;
  sessionId: string;
  inputId: string;
  instruction?: string | null;
}): TurnMemoryWritebackModelContext | null {
  const modelClient = createBackgroundTaskMemoryModelClient({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    inputId: params.inputId,
  });
  if (!modelClient && !trimmedInstruction(params.instruction)) {
    return null;
  }
  return {
    modelClient,
    instruction: trimmedInstruction(params.instruction),
  };
}

export function enqueueEvolveJob(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  instruction?: string | null;
  wakeWorker?: (() => void) | null;
}): PostRunJobRecord {
  const evolveIdempotencyKey = `${EVOLVE_JOB_TYPE}:${params.inputId}`;
  const legacyReinforceIdempotencyKey = `${LEGACY_REINFORCE_MEMORY_WRITEBACK_JOB_TYPE}:${params.inputId}`;
  const legacyIdempotencyKey = `${LEGACY_DURABLE_MEMORY_WRITEBACK_JOB_TYPE}:${params.inputId}`;
  const existing =
    params.store.getPostRunJobByIdempotencyKey(evolveIdempotencyKey) ??
    params.store.getPostRunJobByIdempotencyKey(legacyReinforceIdempotencyKey) ??
    params.store.getPostRunJobByIdempotencyKey(legacyIdempotencyKey);
  if (existing) {
    params.wakeWorker?.();
    return existing;
  }
  const record = params.store.enqueuePostRunJob({
    jobType: EVOLVE_JOB_TYPE,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    inputId: params.inputId,
    payload: {
      instruction: trimmedInstruction(params.instruction),
    },
    idempotencyKey: evolveIdempotencyKey,
  });
  params.wakeWorker?.();
  return record;
}

export async function processEvolveJob(params: {
  store: RuntimeStateStore;
  record: PostRunJobRecord;
  memoryService: MemoryServiceLike;
}): Promise<void> {
  if (
    params.record.jobType !== EVOLVE_JOB_TYPE &&
    params.record.jobType !== LEGACY_REINFORCE_MEMORY_WRITEBACK_JOB_TYPE &&
    params.record.jobType !== LEGACY_DURABLE_MEMORY_WRITEBACK_JOB_TYPE
  ) {
    throw new Error(`unsupported evolve job type: ${params.record.jobType}`);
  }
  const turnResult = params.store.getTurnResult({ inputId: params.record.inputId });
  if (!turnResult) {
    throw new Error(`turn result not found for evolve job input ${params.record.inputId}`);
  }
  const payload = asRecord(params.record.payload) as EvolveJobPayload;
  const modelContext = evolveModelContext({
    workspaceId: turnResult.workspaceId,
    sessionId: turnResult.sessionId,
    inputId: turnResult.inputId,
    instruction: trimmedInstruction(payload.instruction),
  });
  await writeTurnDurableMemory({
    store: params.store,
    memoryService: params.memoryService,
    turnResult,
    modelContext,
  });

  const skillReview = await reviewTurnForSkillCreateCandidate({
    store: params.store,
    turnResult,
    modelClient: modelContext?.modelClient ?? null,
    instruction: modelContext?.instruction ?? trimmedInstruction(payload.instruction) ?? "",
  });
  if (!skillReview.draft) {
    return;
  }
  const candidate = await persistSkillCreateCandidate({
    store: params.store,
    memoryService: params.memoryService,
    turnResult,
    draft: skillReview.draft,
  });
  if (candidate.taskProposalId || candidate.status === "proposed" || candidate.status === "accepted" || candidate.status === "promoted") {
    return;
  }
  const proposal = createEvolveTaskProposal({
    store: params.store,
    workspaceId: candidate.workspaceId,
    proposalId: skillCandidateProposalId(candidate.candidateId),
    taskName: `Review new reusable skill: ${candidate.title}`,
    taskPrompt: `Review and promote the candidate skill "${candidate.title}" for this workspace. Inspect the draft artifact at ${candidate.skillPath}, refine it if needed, and promote it only if it is broadly reusable.`,
    taskGenerationRationale:
      candidate.evaluationNotes ??
      "Evolve identified a reusable workflow that is not captured in the current promoted skill set.",
    sourceEventIds: candidate.sourceTurnInputIds,
  });
  params.store.updateEvolveSkillCandidate({
    candidateId: candidate.candidateId,
    fields: {
      taskProposalId: proposal.proposalId,
      status: "proposed",
      proposedAt: new Date().toISOString(),
    },
  });
}
