import type { MemoryEntryRecord } from "@holaboss/runtime-state-store";

import type { AgentRecalledMemoryContext } from "./agent-runtime-prompt.js";
import { defaultMemoryRecallIndex, type MemoryRecallIndex } from "./memory-recall-index.js";

export function recalledMemoryContextFromEntries(params: {
  query: string;
  entries: MemoryEntryRecord[];
  maxEntries?: number;
  nowIso?: string | null;
  recallIndex?: MemoryRecallIndex | null;
}): AgentRecalledMemoryContext | null {
  const activeEntries = params.entries.filter((entry) => entry.status === "active");
  if (activeEntries.length === 0) {
    return null;
  }

  const ranked = (params.recallIndex ?? defaultMemoryRecallIndex()).rank({
    query: params.query,
    entries: activeEntries,
    nowIso: params.nowIso ?? null,
  });

  const selectedRankedEntries = ranked.slice(0, Math.max(1, params.maxEntries ?? 5));
  const selectedEntries = selectedRankedEntries.map(({ entry, freshness }) => ({
      scope: entry.scope,
      memory_type: entry.memoryType,
      title: entry.title,
      summary: entry.summary,
      path: entry.path,
      verification_policy: entry.verificationPolicy,
      staleness_policy: entry.stalenessPolicy,
      freshness_state: freshness.state,
      freshness_note: freshness.note,
      source_type: entry.sourceType,
      observed_at: entry.observedAt,
      last_verified_at: entry.lastVerifiedAt,
      confidence: entry.confidence,
      updated_at: entry.updatedAt,
    }));

  if (selectedEntries.length === 0) {
    return null;
  }

  return {
    entries: selectedEntries,
    selection_trace: selectedRankedEntries.map(({ entry, score, freshness, trace }) => ({
      memory_id: entry.memoryId,
      score,
      freshness_state: freshness.state,
      matched_tokens: trace.matchedTokens,
      reasons: trace.reasons,
      source_type: entry.sourceType,
    })),
  };
}
