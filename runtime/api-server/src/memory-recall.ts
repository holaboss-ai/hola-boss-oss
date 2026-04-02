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

  const selectedEntries = ranked
    .slice(0, Math.max(1, params.maxEntries ?? 5))
    .map(({ entry, freshness }) => ({
      scope: entry.scope,
      memory_type: entry.memoryType,
      title: entry.title,
      summary: entry.summary,
      path: entry.path,
      verification_policy: entry.verificationPolicy,
      staleness_policy: entry.stalenessPolicy,
      freshness_state: freshness.state,
      freshness_note: freshness.note,
      updated_at: entry.updatedAt,
    }));

  if (selectedEntries.length === 0) {
    return null;
  }

  return {
    entries: selectedEntries,
  };
}
