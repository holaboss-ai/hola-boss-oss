import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import {
  enqueueSessionCheckpointJob,
  processSessionCheckpointJob,
} from "./session-checkpoint.js";

interface PiSessionBranchEntry {
  id: string;
  type?: string;
}

interface PiSessionManagerInstance {
  getBranch(): PiSessionBranchEntry[];
  getEntries(): PiSessionBranchEntry[];
  getLeafId(): string | null;
  getSessionFile(): string | undefined;
  appendMessage(message: unknown): string | undefined;
  appendCompaction(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: unknown,
    fromHook?: boolean,
  ): string | undefined;
}

interface PiSessionManagerStatic {
  create(workspaceDir: string, sessionDir: string): PiSessionManagerInstance;
  open(sessionFile: string): PiSessionManagerInstance;
}

const require = createRequire(import.meta.url);
const { SessionManager } = require(
  "../../harness-host/node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.js",
) as {
  SessionManager: PiSessionManagerStatic;
};

function makeStore(prefix: string): {
  store: RuntimeStateStore;
  root: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const workspaceRoot = path.join(root, "workspace");
  const sandboxRoot = root;
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(path.join(sandboxRoot, "state"), { recursive: true });
  return {
    store: new RuntimeStateStore({
      workspaceRoot,
      sandboxRoot,
      dbPath: path.join(sandboxRoot, "state", "runtime.db"),
    }),
    root,
  };
}

test("session checkpoint merges snapshot compaction into a live session that only appended new entries", async () => {
  const { store, root } = makeStore("hb-session-checkpoint-merge-");
  try {
    const workspace = store.createWorkspace({
      workspaceId: "workspace-1",
      name: "Workspace 1",
      harness: "pi",
      status: "active",
    });
    const workspaceDir = store.workspaceDir(workspace.id);
    fs.mkdirSync(workspaceDir, { recursive: true });

    const sessionDir = fs.mkdtempSync(path.join(root, "pi-sessions-"));
    const sessionManager = SessionManager.create(workspaceDir, sessionDir);
    sessionManager.appendMessage({
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    });
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      model: "gpt-5.4",
      provider: "openai",
      stopReason: "done",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now() + 1,
    } as never);
    const baseLeafId = sessionManager.getLeafId();
    const liveSessionFile = sessionManager.getSessionFile();
    assert.ok(liveSessionFile);

    store.upsertBinding({
      workspaceId: workspace.id,
      sessionId: "session-main",
      harness: "pi",
      harnessSessionId: liveSessionFile,
    });
    store.upsertTurnResult({
      workspaceId: workspace.id,
      sessionId: "session-main",
      inputId: "input-1",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "completed",
      stopReason: "success",
      assistantText: "done",
      toolUsageSummary: {},
      permissionDenials: [],
      promptSectionIds: [],
      capabilityManifestFingerprint: null,
      requestSnapshotFingerprint: "snap-1",
      promptCacheProfile: null,
      compactedSummary: null,
      compactionBoundaryId: null,
      tokenUsage: null,
      createdAt: new Date().toISOString(),
    });
    store.upsertTurnRequestSnapshot({
      workspaceId: workspace.id,
      sessionId: "session-main",
      inputId: "input-1",
      snapshotKind: "harness_host_request",
      fingerprint: "snap-1",
      payload: {
        harness_request: {
          workspace_id: workspace.id,
          session_id: "session-main",
          input_id: "input-1",
        },
      },
    });

    const queued = enqueueSessionCheckpointJob({
      store,
      workspaceId: workspace.id,
      sessionId: "session-main",
      inputId: "input-1",
      harness: "pi",
      harnessSessionId: liveSessionFile,
      contextUsage: {
        tokens: 50_000,
        contextWindow: 65_536,
        percent: 76.3,
      },
    });
    assert.ok(queued);

    const advancedLiveSession = SessionManager.open(liveSessionFile);
    advancedLiveSession.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "new work" }],
      model: "gpt-5.4",
      provider: "openai",
      stopReason: "done",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now() + 1,
    } as never);

    await processSessionCheckpointJob({
      store,
      record: queued!,
      runPiSessionCompactionFn: async (requestPayload) => {
        const snapshotPath = String(requestPayload.harness_session_id);
        const snapshotSession = SessionManager.open(snapshotPath);
        const firstKeptEntryId = snapshotSession.getEntries()[0]?.id ?? baseLeafId ?? "";
        snapshotSession.appendCompaction(
          "Compacted older context.",
          firstKeptEntryId,
          12345,
          { modifiedFiles: ["src/example.ts"] },
          false,
        );
        return {
          compacted: true,
          session_file: snapshotPath,
        };
      },
    });

    const binding = store.getBinding({
      workspaceId: workspace.id,
      sessionId: "session-main",
    });
    assert.equal(binding?.harnessSessionId, liveSessionFile);

    const mergedLiveSession = SessionManager.open(liveSessionFile);
    const branch = mergedLiveSession.getBranch();
    const latestEntry = branch.at(-1);
    assert.ok(latestEntry);
    assert.equal(latestEntry?.type, "compaction");
    const latestCompactionEntry = latestEntry as unknown as { summary: string };
    assert.equal(latestCompactionEntry.summary, "Compacted older context.");
    assert.ok(branch.some((entry: PiSessionBranchEntry) => entry.id === baseLeafId));

    const boundaries = store.listCompactionBoundaries({
      workspaceId: workspace.id,
      sessionId: "session-main",
      limit: 10,
      offset: 0,
    });
    assert.equal(boundaries[0]?.boundaryType, "harness_auto_compaction");

    const updatedJob = store.getPostRunJob(queued!.jobId);
    assert.equal(
      (
        updatedJob?.payload.checkpoint_result as { outcome?: string } | undefined
      )?.outcome,
      "merged",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("session checkpoint re-resolves model client auth instead of using redacted snapshot credentials", async () => {
  const { store, root } = makeStore("hb-session-checkpoint-auth-");
  try {
    const workspace = store.createWorkspace({
      workspaceId: "workspace-auth",
      name: "Workspace Auth",
      harness: "pi",
      status: "active",
    });
    const workspaceDir = store.workspaceDir(workspace.id);
    fs.mkdirSync(workspaceDir, { recursive: true });

    const sessionDir = fs.mkdtempSync(path.join(root, "pi-sessions-"));
    const sessionManager = SessionManager.create(workspaceDir, sessionDir);
    sessionManager.appendMessage({
      role: "user",
      content: "compact this",
      timestamp: Date.now(),
    });
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      model: "gpt-5.4",
      provider: "openai_codex",
      stopReason: "done",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now() + 1,
    } as never);
    const liveSessionFile = sessionManager.getSessionFile();
    assert.ok(liveSessionFile);

    store.upsertBinding({
      workspaceId: workspace.id,
      sessionId: "session-auth",
      harness: "pi",
      harnessSessionId: liveSessionFile,
    });
    store.upsertTurnResult({
      workspaceId: workspace.id,
      sessionId: "session-auth",
      inputId: "input-auth",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "completed",
      stopReason: "success",
      assistantText: "done",
      toolUsageSummary: {},
      permissionDenials: [],
      promptSectionIds: [],
      capabilityManifestFingerprint: null,
      requestSnapshotFingerprint: "snap-auth",
      promptCacheProfile: null,
      compactedSummary: null,
      compactionBoundaryId: null,
      tokenUsage: null,
      createdAt: new Date().toISOString(),
    });
    store.upsertTurnRequestSnapshot({
      workspaceId: workspace.id,
      sessionId: "session-auth",
      inputId: "input-auth",
      snapshotKind: "harness_host_request",
      fingerprint: "snap-auth",
      payload: {
        runtime_config: {
          provider_id: "openai_codex",
          model_id: "gpt-5.4",
        },
        harness_request: {
          workspace_id: workspace.id,
          session_id: "session-auth",
          input_id: "input-auth",
          provider_id: "openai_codex",
          model_id: "gpt-5.4",
          model_client: {
            api_key: "[redacted]",
            base_url: "https://chatgpt.com/backend-api/codex",
            default_headers: null,
          },
        },
      },
    });

    const queued = enqueueSessionCheckpointJob({
      store,
      workspaceId: workspace.id,
      sessionId: "session-auth",
      inputId: "input-auth",
      harness: "pi",
      harnessSessionId: liveSessionFile,
      contextUsage: {
        tokens: 50_000,
        contextWindow: 65_536,
        percent: 76.3,
      },
    });
    assert.ok(queued);

    let observedRequest: Record<string, unknown> | null = null;
    await processSessionCheckpointJob({
      store,
      record: queued!,
      resolveRuntimeModelClientFn: () => ({
        providerId: "openai_codex",
        configuredProviderId: "openai_codex",
        modelId: "gpt-5.4",
        modelToken: "openai_codex/gpt-5.4",
        modelProxyProvider: "openai_compatible",
        modelClient: {
          model_proxy_provider: "openai_compatible",
          api_key: "real-codex-access-token",
          base_url: "https://chatgpt.com/backend-api/codex",
          default_headers: null,
        },
      }),
      runPiSessionCompactionFn: async (requestPayload) => {
        observedRequest = requestPayload;
        const snapshotPath = String(requestPayload.harness_session_id);
        const snapshotSession = SessionManager.open(snapshotPath);
        const firstKeptEntryId = snapshotSession.getEntries()[0]?.id ?? "";
        snapshotSession.appendCompaction(
          "Compacted with fresh auth.",
          firstKeptEntryId,
          12345,
          {},
          false,
        );
        return {
          compacted: true,
          session_file: snapshotPath,
        };
      },
    });

    assert.ok(observedRequest);
    const observedRequestRecord = observedRequest as Record<string, unknown>;
    const observedModelClient =
      "model_client" in observedRequestRecord
        ? (observedRequestRecord.model_client as { api_key?: string } | undefined)
        : undefined;
    assert.equal(observedModelClient?.api_key, "real-codex-access-token");

    const updatedJob = store.getPostRunJob(queued!.jobId);
    assert.equal(
      (
        updatedJob?.payload.checkpoint_result as { outcome?: string } | undefined
      )?.outcome,
      "merged",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("session checkpoint records not_compacted when PI reports a compaction no-op", async () => {
  const { store, root } = makeStore("hb-session-checkpoint-not-compacted-");
  try {
    const workspace = store.createWorkspace({
      workspaceId: "workspace-not-compacted",
      name: "Workspace Not Compacted",
      harness: "pi",
      status: "active",
    });
    const workspaceDir = store.workspaceDir(workspace.id);
    fs.mkdirSync(workspaceDir, { recursive: true });

    const sessionDir = fs.mkdtempSync(path.join(root, "pi-sessions-"));
    const sessionManager = SessionManager.create(workspaceDir, sessionDir);
    sessionManager.appendMessage({
      role: "user",
      content: "compact if needed",
      timestamp: Date.now(),
    });
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      model: "gpt-5.4",
      provider: "openai",
      stopReason: "done",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now() + 1,
    } as never);
    const liveSessionFile = sessionManager.getSessionFile();
    assert.ok(liveSessionFile);

    store.upsertBinding({
      workspaceId: workspace.id,
      sessionId: "session-not-compacted",
      harness: "pi",
      harnessSessionId: liveSessionFile,
    });
    store.upsertTurnResult({
      workspaceId: workspace.id,
      sessionId: "session-not-compacted",
      inputId: "input-not-compacted",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "completed",
      stopReason: "success",
      assistantText: "done",
      toolUsageSummary: {},
      permissionDenials: [],
      promptSectionIds: [],
      capabilityManifestFingerprint: null,
      requestSnapshotFingerprint: "snap-not-compacted",
      promptCacheProfile: null,
      compactedSummary: null,
      compactionBoundaryId: null,
      tokenUsage: null,
      createdAt: new Date().toISOString(),
    });
    store.upsertTurnRequestSnapshot({
      workspaceId: workspace.id,
      sessionId: "session-not-compacted",
      inputId: "input-not-compacted",
      snapshotKind: "harness_host_request",
      fingerprint: "snap-not-compacted",
      payload: {
        harness_request: {
          workspace_id: workspace.id,
          session_id: "session-not-compacted",
          input_id: "input-not-compacted",
        },
      },
    });

    const queued = enqueueSessionCheckpointJob({
      store,
      workspaceId: workspace.id,
      sessionId: "session-not-compacted",
      inputId: "input-not-compacted",
      harness: "pi",
      harnessSessionId: liveSessionFile,
      contextUsage: {
        tokens: 50_000,
        contextWindow: 65_536,
        percent: 76.3,
      },
    });
    assert.ok(queued);

    await processSessionCheckpointJob({
      store,
      record: queued!,
      runPiSessionCompactionFn: async (requestPayload) => ({
        compacted: false,
        session_file: String(requestPayload.harness_session_id),
        reason: "already_compacted",
      }),
    });

    const updatedJob = store.getPostRunJob(queued!.jobId);
    assert.equal(
      (
        updatedJob?.payload.checkpoint_result as
          | { outcome?: string; reason?: string | null }
          | undefined
      )?.outcome,
      "not_compacted",
    );
    assert.equal(
      (
        updatedJob?.payload.checkpoint_result as
          | { outcome?: string; reason?: string | null }
          | undefined
      )?.reason,
      "already_compacted",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("session checkpoint treats provider 422 summarization failures as a soft no-op", async () => {
  const { store, root } = makeStore("hb-session-checkpoint-soft-422-");
  try {
    const workspace = store.createWorkspace({
      workspaceId: "workspace-soft-422",
      name: "Workspace Soft 422",
      harness: "pi",
      status: "active",
    });
    const workspaceDir = store.workspaceDir(workspace.id);
    fs.mkdirSync(workspaceDir, { recursive: true });

    const sessionDir = fs.mkdtempSync(path.join(root, "pi-sessions-"));
    const sessionManager = SessionManager.create(workspaceDir, sessionDir);
    sessionManager.appendMessage({
      role: "user",
      content: "compact this later",
      timestamp: Date.now(),
    });
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "working on it" }],
      model: "gpt-5.4",
      provider: "openai",
      stopReason: "done",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now() + 1,
    } as never);
    const liveSessionFile = sessionManager.getSessionFile();
    assert.ok(liveSessionFile);

    store.upsertBinding({
      workspaceId: workspace.id,
      sessionId: "session-soft-422",
      harness: "pi",
      harnessSessionId: liveSessionFile,
    });
    store.upsertTurnResult({
      workspaceId: workspace.id,
      sessionId: "session-soft-422",
      inputId: "input-soft-422",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "completed",
      stopReason: "success",
      assistantText: "working on it",
      toolUsageSummary: {},
      permissionDenials: [],
      promptSectionIds: [],
      capabilityManifestFingerprint: null,
      requestSnapshotFingerprint: "snap-soft-422",
      promptCacheProfile: null,
      compactedSummary: null,
      compactionBoundaryId: null,
      tokenUsage: null,
      createdAt: new Date().toISOString(),
    });
    store.upsertTurnRequestSnapshot({
      workspaceId: workspace.id,
      sessionId: "session-soft-422",
      inputId: "input-soft-422",
      snapshotKind: "harness_host_request",
      fingerprint: "snap-soft-422",
      payload: {
        harness_request: {
          workspace_id: workspace.id,
          session_id: "session-soft-422",
          input_id: "input-soft-422",
        },
      },
    });

    const queued = enqueueSessionCheckpointJob({
      store,
      workspaceId: workspace.id,
      sessionId: "session-soft-422",
      inputId: "input-soft-422",
      harness: "pi",
      harnessSessionId: liveSessionFile,
      contextUsage: {
        tokens: 50_000,
        contextWindow: 65_536,
        percent: 76.3,
      },
    });
    assert.ok(queued);

    await processSessionCheckpointJob({
      store,
      record: queued!,
      runPiSessionCompactionFn: async () => {
        throw new Error("Summarization failed: 422 status code (no body)");
      },
    });

    const liveSession = SessionManager.open(liveSessionFile);
    const branch = liveSession.getBranch();
    assert.equal(branch.at(-1)?.type, "message");

    const boundaries = store.listCompactionBoundaries({
      workspaceId: workspace.id,
      sessionId: "session-soft-422",
      limit: 10,
      offset: 0,
    });
    assert.equal(boundaries.length, 0);

    const updatedJob = store.getPostRunJob(queued!.jobId);
    assert.equal(
      (
        updatedJob?.payload.checkpoint_result as { outcome?: string } | undefined
      )?.outcome,
      "soft_provider_422",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
