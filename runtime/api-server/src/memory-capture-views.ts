import type { MemoryEntryRecord } from "@holaboss/runtime-state-store";

function sortedStringEntries(files: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(files)
    .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
    .sort((left, right) => left[0].localeCompare(right[0]));
}

function fileRef(files: Record<string, unknown>, filePath: string): { path: string; text: string } | null {
  const text = files[filePath];
  if (typeof text !== "string") {
    return null;
  }
  return {
    path: filePath,
    text,
  };
}

function sortedRecord(entries: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries(entries.sort((left, right) => left[0].localeCompare(right[0])));
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function runtimeProjectionEntries(files: Record<string, unknown>, workspaceId: string): Array<[string, string]> {
  const runtimePrefix = `workspace/${workspaceId}/runtime/`;
  return sortedStringEntries(files).filter(([filePath]) => filePath.startsWith(runtimePrefix));
}

export function buildCapturedMemoryViews(params: {
  workspaceId: string;
  files: Record<string, unknown>;
  memoryEntries: MemoryEntryRecord[];
}): Record<string, unknown> {
  const runtimeEntries = runtimeProjectionEntries(params.files, params.workspaceId);
  const workspaceKnowledgePrefix = `workspace/${params.workspaceId}/knowledge/`;
  const workspaceKnowledgeEntries = sortedStringEntries(params.files).filter(([filePath]) =>
    filePath.startsWith(workspaceKnowledgePrefix)
  );
  const userScopeEntries = sortedStringEntries(params.files).filter(([filePath]) => {
    if (filePath === "MEMORY.md") {
      return false;
    }
    if (filePath.startsWith("workspace/")) {
      return false;
    }
    return !filePath.endsWith("/MEMORY.md");
  });
  const knownPaths = new Set<string>([
    ...runtimeEntries.map(([filePath]) => filePath),
    ...workspaceKnowledgeEntries.map(([filePath]) => filePath),
    ...userScopeEntries.map(([filePath]) => filePath),
    "MEMORY.md",
    `workspace/${params.workspaceId}/MEMORY.md`,
    "preference/MEMORY.md",
  ]);
  const uncategorizedEntries = sortedStringEntries(params.files).filter(([filePath]) => !knownPaths.has(filePath));
  const runtimeProjections = {
    priority_file_paths: runtimeEntries.slice(0, 8).map(([filePath]) => filePath),
    latest_turn: fileRef(params.files, `workspace/${params.workspaceId}/runtime/latest-turn.md`),
    session_snapshots: sortedRecord(
      runtimeEntries.filter(([filePath]) => filePath.startsWith(`workspace/${params.workspaceId}/runtime/session-state/`))
    ),
    active_blockers: sortedRecord(
      runtimeEntries.filter(([filePath]) => filePath.startsWith(`workspace/${params.workspaceId}/runtime/blockers/`))
    ),
    permission_blockers: sortedRecord(
      runtimeEntries.filter(([filePath]) =>
        filePath.startsWith(`workspace/${params.workspaceId}/runtime/permission-blockers/`)
      )
    ),
    recent_turns: sortedRecord(
      runtimeEntries.filter(([filePath]) => filePath.startsWith(`workspace/${params.workspaceId}/runtime/recent-turns/`))
    ),
  };
  const responseStylePreference = fileRef(params.files, "preference/response-style.md");
  const relevantEntries = params.memoryEntries
    .filter((entry) => entry.scope === "user" || entry.workspaceId === params.workspaceId)
    .sort((left, right) => {
      const updatedAtDiff = right.updatedAt.localeCompare(left.updatedAt);
      if (updatedAtDiff !== 0) {
        return updatedAtDiff;
      }
      return left.memoryId.localeCompare(right.memoryId);
    });

  return {
    runtime_projections: runtimeProjections,
    durable_indexes: {
      root: fileRef(params.files, "MEMORY.md"),
      workspace: fileRef(params.files, `workspace/${params.workspaceId}/MEMORY.md`),
      preference: fileRef(params.files, "preference/MEMORY.md"),
      priority_file_paths: [
        "MEMORY.md",
        `workspace/${params.workspaceId}/MEMORY.md`,
        "preference/MEMORY.md",
      ].filter((filePath) => typeof params.files[filePath] === "string"),
    },
    durable_files: {
      workspace_knowledge: sortedRecord(workspaceKnowledgeEntries),
      user_scopes: sortedRecord(userScopeEntries),
      priority_file_paths: [...workspaceKnowledgeEntries, ...userScopeEntries].slice(0, 8).map(([filePath]) => filePath),
    },
    durable_catalog: {
      total_entries: relevantEntries.length,
      counts_by_scope: countBy(relevantEntries.map((entry) => entry.scope)),
      counts_by_type: countBy(relevantEntries.map((entry) => entry.memoryType)),
      entries: relevantEntries.map((entry) => ({
        memory_id: entry.memoryId,
        scope: entry.scope,
        memory_type: entry.memoryType,
        title: entry.title,
        summary: entry.summary,
        path: entry.path,
        tags: entry.tags,
        verification_policy: entry.verificationPolicy,
        staleness_policy: entry.stalenessPolicy,
        stale_after_seconds: entry.staleAfterSeconds,
        source_turn_input_id: entry.sourceTurnInputId,
        source_message_id: entry.sourceMessageId,
        updated_at: entry.updatedAt,
      })),
    },
    debug_files: {
      uncategorized_paths: uncategorizedEntries.map(([filePath]) => filePath),
      uncategorized_files: sortedRecord(uncategorizedEntries),
      total_uncategorized_files: uncategorizedEntries.length,
    },
    derived_runtime: {
      ...runtimeProjections,
      response_style_preference: responseStylePreference,
    },
  };
}
