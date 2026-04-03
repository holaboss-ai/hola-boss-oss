import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { FilesystemMemoryService } from "./memory.js";
import { writeTurnMemory, type TurnMemoryWritebackModelContext } from "./turn-memory-writeback.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeRuntimeState(prefix: string): {
  root: string;
  store: RuntimeStateStore;
  memoryService: FilesystemMemoryService;
} {
  const root = makeTempDir(prefix);
  const workspaceRoot = path.join(root, "workspaces");
  return {
    root,
    store: new RuntimeStateStore({
      dbPath: path.join(root, "runtime.db"),
      workspaceRoot,
    }),
    memoryService: new FilesystemMemoryService({ workspaceRoot }),
  };
}

async function withModelExtractionResponse(params: {
  memories: Array<Record<string, unknown>>;
  run: (modelContext: TurnMemoryWritebackModelContext) => Promise<void>;
}): Promise<void> {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/openai/v1/chat/completions") {
      response.statusCode = 404;
      response.end();
      return;
    }
    void request.resume();
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                memories: params.memories,
              }),
            },
          },
        ],
      })
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const modelContext: TurnMemoryWritebackModelContext = {
      modelClient: {
        baseUrl: `http://127.0.0.1:${address.port}/openai/v1`,
        apiKey: "test-key",
        modelId: "openai/gpt-4.1-mini",
      },
      instruction: "extract durable memory candidates",
    };
    await params.run(modelContext);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function seedWorkspace(store: RuntimeStateStore): void {
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
    mainSessionId: "session-main",
  });
}

test("writeTurnMemory compacts a turn and writes deterministic runtime memory files", async () => {
  const { store, memoryService } = makeRuntimeState("hb-turn-memory-");
  seedWorkspace(store);
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: "Please keep your responses concise.",
    messageId: "user-1",
    createdAt: "2026-04-02T12:00:00.000Z",
  });

  const turnResult = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-04-02T12:00:00.000Z",
    completedAt: "2026-04-02T12:00:05.000Z",
    status: "completed",
    stopReason: "ok",
    assistantText: "Implemented the runtime memory writeback path.\nVerified the affected tests.",
    toolUsageSummary: {
      total_calls: 2,
      completed_calls: 1,
      failed_calls: 1,
      tool_names: ["read", "deploy"],
      tool_ids: ["workspace.deploy"],
    },
    permissionDenials: [
      {
        tool_name: "deploy",
        tool_id: "workspace.deploy",
        reason: "permission denied by policy",
      },
    ],
    promptSectionIds: ["runtime_core", "execution_policy"],
    capabilityManifestFingerprint: "f".repeat(64),
    tokenUsage: { input_tokens: 12, output_tokens: 34 },
  });

  const updated = await writeTurnMemory({
    store,
    memoryService,
    turnResult,
  });
  const captured = await memoryService.capture({ workspace_id: "workspace-1" });
  const files = captured.files as Record<string, string>;
  const permissionBlockerPath = Object.keys(files).find((filePath) =>
    filePath.startsWith("workspace/workspace-1/runtime/permission-blockers/")
  );
  const memoryEntryIds = store.listMemoryEntries({ status: "active" }).map((entry) => entry.memoryId).sort((left, right) =>
    left.localeCompare(right)
  );
  const responseStyleMemory = store.getMemoryEntry({ memoryId: "user-preference:response-style" });

  assert.equal(
    updated.compactedSummary,
    "Implemented the runtime memory writeback path. Verified the affected tests."
  );
  assert.equal(permissionBlockerPath != null, true);
  assert.deepEqual(
    Object.keys(files)
      .filter((filePath) => !filePath.startsWith("workspace/workspace-1/runtime/permission-blockers/"))
      .sort((left, right) => left.localeCompare(right)),
    [
      "MEMORY.md",
      "preference/MEMORY.md",
      "preference/response-style.md",
      "workspace/workspace-1/MEMORY.md",
      "workspace/workspace-1/runtime/blockers/session-main.md",
      "workspace/workspace-1/runtime/latest-turn.md",
      "workspace/workspace-1/runtime/recent-turns/session-main.md",
      "workspace/workspace-1/runtime/session-memory/session-main.md",
      "workspace/workspace-1/runtime/session-state/session-main.md",
    ]
  );
  assert.deepEqual(memoryEntryIds, ["user-preference:response-style"]);
  assert.equal(responseStyleMemory?.verificationPolicy, "none");
  assert.equal(responseStyleMemory?.stalenessPolicy, "stable");
  assert.equal(responseStyleMemory?.staleAfterSeconds, null);
  assert.equal(responseStyleMemory?.sourceType, "session_message");
  assert.equal(responseStyleMemory?.observedAt, "2026-04-02T12:00:00.000Z");
  assert.equal(responseStyleMemory?.lastVerifiedAt, "2026-04-02T12:00:00.000Z");
  assert.equal(responseStyleMemory?.confidence, 0.99);
  assert.match(files["workspace/workspace-1/runtime/session-state/session-main.md"], /Runtime Session Snapshot/);
  assert.match(files["workspace/workspace-1/runtime/session-state/session-main.md"], /execution_policy/);
  assert.match(files["workspace/workspace-1/runtime/latest-turn.md"], /Latest Runtime Turn/);
  assert.match(files["workspace/workspace-1/runtime/recent-turns/session-main.md"], /Recent Runtime Turns/);
  assert.match(files["workspace/workspace-1/runtime/recent-turns/session-main.md"], /input-1/);
  assert.match(files["workspace/workspace-1/runtime/session-memory/session-main.md"], /Session Memory/);
  assert.match(files["workspace/workspace-1/runtime/session-memory/session-main.md"], /Recent User Requests/);
  assert.match(files["preference/response-style.md"], /User Response Style Preference/);
  assert.match(files["preference/response-style.md"], /`concise`/);
  assert.match(files["preference/MEMORY.md"], /User response style/);
  assert.match(files["workspace/workspace-1/MEMORY.md"], /No durable workspace memories indexed yet/);
  assert.match(files["MEMORY.md"], /Preferences/);
  assert.match(String(permissionBlockerPath), /permission-blockers\/[a-f0-9]{16}\.md$/);
  assert.match(files[permissionBlockerPath as string], /permission denied by policy/);

  store.close();
});

test("writeTurnMemory reuses stable blocker paths across repeated matching denials", async () => {
  const { store, memoryService } = makeRuntimeState("hb-turn-memory-dedupe-");
  seedWorkspace(store);

  const firstTurn = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-04-02T12:00:00.000Z",
    completedAt: "2026-04-02T12:00:05.000Z",
    status: "failed",
    stopReason: "policy_denied",
    assistantText: "",
    permissionDenials: [
      {
        tool_name: "deploy",
        tool_id: "workspace.deploy",
        reason: "permission denied by policy",
      },
    ],
  });
  await writeTurnMemory({
    store,
    memoryService,
    turnResult: firstTurn,
  });

  const secondTurn = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-2",
    startedAt: "2026-04-02T12:05:00.000Z",
    completedAt: "2026-04-02T12:05:04.000Z",
    status: "failed",
    stopReason: "policy_denied",
    assistantText: "",
    permissionDenials: [
      {
        tool_name: "deploy",
        tool_id: "workspace.deploy",
        reason: "permission denied by policy",
      },
    ],
  });
  await writeTurnMemory({
    store,
    memoryService,
    turnResult: secondTurn,
  });

  const captured = await memoryService.capture({ workspace_id: "workspace-1" });
  const filePaths = (captured.file_paths as string[]).sort((left, right) => left.localeCompare(right));
  const files = captured.files as Record<string, string>;
  const permissionBlockerPaths = filePaths.filter((filePath) =>
    filePath.startsWith("workspace/workspace-1/runtime/permission-blockers/")
  );
  const durableBlockerPaths = filePaths.filter((filePath) =>
    filePath.startsWith("workspace/workspace-1/knowledge/blockers/")
  );
  const memoryEntries = store.listMemoryEntries({ status: "active" });
  const blockerEntry = memoryEntries.find((entry) => entry.memoryType === "blocker");

  assert.deepEqual(
    filePaths.filter((filePath) => !filePath.startsWith("workspace/workspace-1/runtime/permission-blockers/")),
    [
      "MEMORY.md",
      "preference/MEMORY.md",
      "workspace/workspace-1/MEMORY.md",
      ...durableBlockerPaths,
      "workspace/workspace-1/runtime/blockers/session-main.md",
      "workspace/workspace-1/runtime/latest-turn.md",
      "workspace/workspace-1/runtime/recent-turns/session-main.md",
      "workspace/workspace-1/runtime/session-memory/session-main.md",
      "workspace/workspace-1/runtime/session-state/session-main.md",
    ].sort((left, right) => left.localeCompare(right))
  );
  assert.equal(permissionBlockerPaths.length, 1);
  assert.equal(durableBlockerPaths.length, 1);
  assert.match(permissionBlockerPaths[0], /permission-blockers\/[a-f0-9]{16}\.md$/);
  assert.match(durableBlockerPaths[0], /knowledge\/blockers\/permission-[a-f0-9]{16}\.md$/);
  assert.equal(memoryEntries.some((entry) => entry.memoryType === "blocker"), true);
  assert.equal(blockerEntry?.verificationPolicy, "check_before_use");
  assert.equal(blockerEntry?.stalenessPolicy, "workspace_sensitive");
  assert.equal(blockerEntry?.staleAfterSeconds, 14 * 24 * 60 * 60);
  assert.equal(blockerEntry?.sourceType, "permission_denial");
  assert.equal(blockerEntry?.confidence, 0.92);
  assert.match(files["workspace/workspace-1/runtime/latest-turn.md"], /input-2/);
  assert.match(files["workspace/workspace-1/runtime/recent-turns/session-main.md"], /input-2/);
  assert.match(files["workspace/workspace-1/runtime/recent-turns/session-main.md"], /input-1/);
  assert.match(files["workspace/workspace-1/runtime/session-memory/session-main.md"], /Session Memory/);
  assert.match(files["workspace/workspace-1/runtime/blockers/session-main.md"], /policy_denied/);
  assert.match(files[durableBlockerPaths[0]], /Recurring Permission Blocker/);
  assert.match(files["workspace/workspace-1/MEMORY.md"], /Deploy permission blocker/);
  assert.match(files["MEMORY.md"], /Workspace workspace-1/);

  store.close();
});

test("writeTurnMemory extracts durable workspace facts and procedures from explicit instructions", async () => {
  const { store, memoryService } = makeRuntimeState("hb-turn-memory-facts-");
  seedWorkspace(store);
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: [
      "Please keep your responses concise.",
      "",
      "For verification, use `npm run test`.",
      "",
      "Release procedure:",
      "1. Run `npm run test`.",
      "2. Run `npm run build`.",
      "3. Publish the bundle.",
    ].join("\n"),
    messageId: "user-1",
    createdAt: "2026-04-02T12:00:00.000Z",
  });

  const turnResult = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-04-02T12:00:00.000Z",
    completedAt: "2026-04-02T12:00:05.000Z",
    status: "completed",
    stopReason: "ok",
    assistantText: "Captured workspace-specific instructions for future runs.",
  });

  await writeTurnMemory({
    store,
    memoryService,
    turnResult,
  });

  const captured = await memoryService.capture({ workspace_id: "workspace-1" });
  const files = captured.files as Record<string, string>;
  const memoryEntries = store.listMemoryEntries({ status: "active" });
  const verificationFact = memoryEntries.find((entry) => entry.memoryType === "fact");
  const releaseProcedure = memoryEntries.find((entry) => entry.memoryType === "procedure");

  assert.ok(files["workspace/workspace-1/knowledge/facts/verification-command.md"]);
  assert.ok(files["workspace/workspace-1/knowledge/procedures/release-procedure.md"]);
  assert.match(files["workspace/workspace-1/knowledge/facts/verification-command.md"], /Workspace Fact: Verification Command/);
  assert.match(files["workspace/workspace-1/knowledge/facts/verification-command.md"], /`npm run test`/);
  assert.match(files["workspace/workspace-1/knowledge/procedures/release-procedure.md"], /Workspace Procedure: Release/);
  assert.match(files["workspace/workspace-1/knowledge/procedures/release-procedure.md"], /1\. Run `npm run test`\./);
  assert.match(files["workspace/workspace-1/knowledge/procedures/release-procedure.md"], /2\. Run `npm run build`\./);
  assert.match(files["workspace/workspace-1/MEMORY.md"], /Verification command/);
  assert.match(files["workspace/workspace-1/MEMORY.md"], /Release procedure/);
  assert.equal(verificationFact?.verificationPolicy, "check_before_use");
  assert.equal(verificationFact?.stalenessPolicy, "workspace_sensitive");
  assert.equal(verificationFact?.staleAfterSeconds, 30 * 24 * 60 * 60);
  assert.equal(verificationFact?.sourceType, "session_message");
  assert.equal(verificationFact?.confidence, 0.94);
  assert.equal(releaseProcedure?.verificationPolicy, "check_before_use");
  assert.equal(releaseProcedure?.stalenessPolicy, "workspace_sensitive");
  assert.equal(releaseProcedure?.staleAfterSeconds, 14 * 24 * 60 * 60);
  assert.equal(releaseProcedure?.sourceType, "session_message");
  assert.equal(releaseProcedure?.confidence, 0.93);

  store.close();
});

test("writeTurnMemory extracts durable business facts and procedures from explicit workspace instructions", async () => {
  const { store, memoryService } = makeRuntimeState("hb-turn-memory-business-");
  seedWorkspace(store);
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: [
      "Weekly sales review is every Monday at 9am.",
      "",
      "Invoices over $5000 require finance approval.",
      "",
      "Customer follow-up process:",
      "1. Review the CRM record.",
      "2. Draft the follow-up email.",
      "3. Send it within 24 hours.",
    ].join("\n"),
    messageId: "user-1",
    createdAt: "2026-04-02T12:00:00.000Z",
  });

  const turnResult = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-04-02T12:00:00.000Z",
    completedAt: "2026-04-02T12:00:05.000Z",
    status: "completed",
    stopReason: "ok",
    assistantText: "Captured business workflow rules for later recall.",
  });

  await writeTurnMemory({
    store,
    memoryService,
    turnResult,
  });

  const captured = await memoryService.capture({ workspace_id: "workspace-1" });
  const files = captured.files as Record<string, string>;
  const memoryEntries = store.listMemoryEntries({ status: "active" });
  const cadenceFact = memoryEntries.find((entry) => entry.title === "Sales review cadence");
  const approvalFact = memoryEntries.find((entry) => entry.title === "Finance approval rule");
  const followUpProcedure = memoryEntries.find((entry) => entry.title === "Follow-up procedure");

  assert.ok(files["workspace/workspace-1/knowledge/facts/sales-review-cadence.md"]);
  assert.ok(files["workspace/workspace-1/knowledge/facts/invoices-over-5000-approval-rule.md"]);
  assert.ok(files["workspace/workspace-1/knowledge/procedures/follow-up-procedure.md"]);
  assert.match(files["workspace/workspace-1/knowledge/facts/sales-review-cadence.md"], /Workspace Fact: Sales review cadence/);
  assert.match(files["workspace/workspace-1/knowledge/facts/sales-review-cadence.md"], /Weekly sales review is every Monday at 9am\./);
  assert.match(files["workspace/workspace-1/knowledge/facts/invoices-over-5000-approval-rule.md"], /Workspace Fact: Finance approval rule/);
  assert.match(files["workspace/workspace-1/knowledge/facts/invoices-over-5000-approval-rule.md"], /Invoices over \$5000 require finance approval in this workspace\./);
  assert.match(files["workspace/workspace-1/knowledge/procedures/follow-up-procedure.md"], /Workspace Procedure: Follow-up/);
  assert.match(files["workspace/workspace-1/knowledge/procedures/follow-up-procedure.md"], /1\. Review the CRM record\./);
  assert.match(files["workspace/workspace-1/MEMORY.md"], /Sales review cadence/);
  assert.match(files["workspace/workspace-1/MEMORY.md"], /Finance approval rule/);
  assert.match(files["workspace/workspace-1/MEMORY.md"], /Follow-up procedure/);
  assert.equal(cadenceFact?.memoryType, "fact");
  assert.equal(cadenceFact?.sourceType, "session_message");
  assert.equal(cadenceFact?.confidence, 0.91);
  assert.equal(approvalFact?.memoryType, "fact");
  assert.equal(approvalFact?.sourceType, "session_message");
  assert.equal(approvalFact?.confidence, 0.91);
  assert.equal(followUpProcedure?.memoryType, "procedure");
  assert.equal(followUpProcedure?.sourceType, "session_message");
  assert.equal(followUpProcedure?.confidence, 0.93);

  store.close();
});

test("writeTurnMemory rejects weak uncorroborated model-extracted durable candidates", async () => {
  const { store, memoryService } = makeRuntimeState("hb-turn-memory-model-reject-");
  seedWorkspace(store);
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: "Please keep your responses concise.",
    messageId: "user-1",
    createdAt: "2026-04-02T12:00:00.000Z",
  });

  const turnResult = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-04-02T12:00:00.000Z",
    completedAt: "2026-04-02T12:00:05.000Z",
    status: "completed",
    stopReason: "ok",
    assistantText: "Done.",
  });

  await withModelExtractionResponse({
    memories: [
      {
        scope: "workspace",
        memory_type: "reference",
        subject_key: "untrusted-note",
        title: "Untrusted Note",
        summary: "Persist random note.",
        tags: ["random"],
        evidence: "short",
        confidence: 0.42,
      },
    ],
    run: async (modelContext) => {
      await writeTurnMemory({
        store,
        memoryService,
        turnResult,
        modelContext,
      });
    },
  });

  const captured = await memoryService.capture({ workspace_id: "workspace-1" });
  const files = captured.files as Record<string, string>;
  const memoryEntries = store.listMemoryEntries({ status: "active" });

  assert.equal(files["workspace/workspace-1/knowledge/reference/untrusted-note.md"], undefined);
  assert.equal(
    memoryEntries.some((entry) => entry.path === "workspace/workspace-1/knowledge/reference/untrusted-note.md"),
    false
  );
  assert.ok(files["preference/response-style.md"]);

  store.close();
});

test("writeTurnMemory accepts corroborated model-extracted durable candidates with relaxed threshold", async () => {
  const { store, memoryService } = makeRuntimeState("hb-turn-memory-model-corroborated-");
  seedWorkspace(store);
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: "For verification, use `npm run test`.",
    messageId: "user-1",
    createdAt: "2026-04-02T12:00:00.000Z",
  });

  const turnResult = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-04-02T12:00:00.000Z",
    completedAt: "2026-04-02T12:00:05.000Z",
    status: "completed",
    stopReason: "ok",
    assistantText: "Captured verification guidance.",
  });

  await withModelExtractionResponse({
    memories: [
      {
        scope: "workspace",
        memory_type: "fact",
        subject_key: "verification-command",
        title: "Verification command (model)",
        summary: "Use `npm run test:ci` as the verification command for this workspace.",
        tags: ["verification", "command"],
        evidence: "This was explicitly provided as persistent verification guidance for the workspace.",
        confidence: 0.61,
      },
    ],
    run: async (modelContext) => {
      await writeTurnMemory({
        store,
        memoryService,
        turnResult,
        modelContext,
      });
    },
  });

  const captured = await memoryService.capture({ workspace_id: "workspace-1" });
  const files = captured.files as Record<string, string>;
  const verificationFactPath = "workspace/workspace-1/knowledge/facts/verification-command.md";
  const verificationFact = store
    .listMemoryEntries({ status: "active" })
    .find((entry) => entry.path === verificationFactPath);

  assert.ok(files[verificationFactPath]);
  assert.match(files[verificationFactPath], /Verification command \(model\)/);
  assert.match(files[verificationFactPath], /npm run test:ci/);
  assert.equal(verificationFact?.title, "Verification command (model)");
  assert.equal(verificationFact?.confidence, 0.61);

  store.close();
});
