import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import Database from "better-sqlite3";

import { RuntimeStateStore } from "./store.js";

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

test("workspace registry round trip uses hidden identity file", () => {
  const root = makeTempDir("hb-state-store-");
  const dbPath = path.join(root, "runtime.db");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({ dbPath, workspaceRoot });

  const created = store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Acme",
    harness: "pi",
    status: "active"
  });

  const identityPath = path.join(workspaceRoot, "workspace-1", ".holaboss", "workspace_id");
  assert.equal(fs.readFileSync(identityPath, "utf-8").trim(), "workspace-1");
  assert.equal(created.id, "workspace-1");
  assert.deepEqual(store.getWorkspace("workspace-1"), created);
  assert.deepEqual(
    store.listWorkspaces().map((record) => record.id),
    ["workspace-1"]
  );

  const db = new Database(dbPath, { readonly: true });
  const tables = new Set<string>(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  );
  const row = db.prepare<[string], { workspace_path: string }>("SELECT workspace_path FROM workspaces WHERE id = ?").get("workspace-1");
  db.close();

  assert.ok(row);
  assert.equal(tables.has("workspaces"), true);
  assert.equal(path.resolve(row.workspace_path), path.join(workspaceRoot, "workspace-1"));
  store.close();
});

test("runtime schema migrates workspace rows to registry and identity file", () => {
  const root = makeTempDir("hb-state-store-");
  const dbPath = path.join(root, "runtime.db");
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        harness TEXT,
        main_session_id TEXT,
        error_message TEXT,
        onboarding_status TEXT NOT NULL,
        onboarding_session_id TEXT,
        onboarding_completed_at TEXT,
        onboarding_completion_summary TEXT,
        onboarding_requested_at TEXT,
        onboarding_requested_by TEXT,
        created_at TEXT,
        updated_at TEXT,
        deleted_at_utc TEXT
    );
  `);
  db.prepare(`
    INSERT INTO workspaces (
        id, name, status, harness, main_session_id, error_message,
        onboarding_status, onboarding_session_id, onboarding_completed_at,
        onboarding_completion_summary, onboarding_requested_at, onboarding_requested_by,
        created_at, updated_at, deleted_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "workspace-legacy",
    "Legacy",
    "active",
    "pi",
    "session-1",
    null,
    "not_required",
    null,
    null,
    null,
    null,
    null,
    "2026-01-01T00:00:00+00:00",
    "2026-01-02T00:00:00+00:00",
    null
  );
  db.close();

  const store = new RuntimeStateStore({ dbPath, workspaceRoot });
  const rows = store.listWorkspaces();

  assert.deepEqual(rows.map((record) => record.id), ["workspace-legacy"]);
  const identityPath = path.join(workspaceRoot, "workspace-legacy", ".holaboss", "workspace_id");
  assert.equal(fs.readFileSync(identityPath, "utf-8").trim(), "workspace-legacy");

  const dbAfter = new Database(dbPath, { readonly: true });
  const tables = new Set<string>(
    (dbAfter.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  );
  const row = dbAfter
    .prepare<[string], { workspace_path: string }>("SELECT workspace_path FROM workspaces WHERE id = ?")
    .get("workspace-legacy");
  dbAfter.close();

  assert.ok(row);
  assert.equal(tables.has("workspaces"), true);
  assert.equal(path.resolve(row.workspace_path), path.join(workspaceRoot, "workspace-legacy"));
  store.close();
});

test("workspaceDir recovers when folder is renamed", () => {
  const root = makeTempDir("hb-state-store-");
  const dbPath = path.join(root, "runtime.db");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({ dbPath, workspaceRoot });

  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Acme",
    harness: "pi",
    status: "active"
  });
  const originalPath = path.join(workspaceRoot, "workspace-1");
  const renamedPath = path.join(workspaceRoot, "workspace-renamed");
  fs.renameSync(originalPath, renamedPath);

  const resolved = store.workspaceDir("workspace-1");

  assert.equal(resolved, renamedPath);
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare<[string], { workspace_path: string }>("SELECT workspace_path FROM workspaces WHERE id = ?").get("workspace-1");
  db.close();
  assert.ok(row);
  assert.equal(path.resolve(row.workspace_path), renamedPath);
  store.close();
});

test("getWorkspace recovers missing row from identity file", () => {
  const root = makeTempDir("hb-state-store-");
  const dbPath = path.join(root, "runtime.db");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({
    dbPath,
    workspaceRoot,
    sandboxAgentHarness: "pi"
  });

  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Acme",
    harness: "pi",
    status: "active"
  });
  const db = new Database(dbPath);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run("workspace-1");
  db.close();

  const recovered = store.getWorkspace("workspace-1");

  assert.ok(recovered);
  assert.equal(recovered.id, "workspace-1");
  assert.equal(recovered.name, "workspace-1");
  assert.equal(recovered.harness, "pi");
  assert.equal(recovered.status, "active");

  const dbAfter = new Database(dbPath, { readonly: true });
  const row = dbAfter
    .prepare<[string], { id: string; workspace_path: string; harness: string; status: string }>(
      "SELECT id, workspace_path, harness, status FROM workspaces WHERE id = ?"
    )
    .get("workspace-1");
  dbAfter.close();

  assert.ok(row);
  assert.equal(row.id, "workspace-1");
  assert.equal(path.resolve(row.workspace_path), path.join(workspaceRoot, "workspace-1"));
  assert.equal(row.harness, "pi");
  assert.equal(row.status, "active");
  store.close();
});

test("binding round trip upserts and reloads persisted session binding", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const created = store.upsertBinding({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    harness: "pi",
    harnessSessionId: "harness-1"
  });
  const updated = store.upsertBinding({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    harness: "pi",
    harnessSessionId: "harness-2"
  });

  assert.equal(created.workspaceId, "workspace-1");
  assert.equal(updated.harnessSessionId, "harness-2");
  const session = store.getSession({ workspaceId: "workspace-1", sessionId: "session-main" });
  assert.ok(session);
  assert.equal(session.kind, "workspace_session");
  assert.equal(session.title, null);
  assert.equal(session.parentSessionId, null);
  assert.equal(session.sourceProposalId, null);
  assert.equal(session.createdBy, null);
  assert.equal(session.archivedAt, null);
  assert.deepEqual(
    store.getBinding({ workspaceId: "workspace-1", sessionId: "session-main" }),
    updated
  );
  store.close();
});

test("runtime user profile round trip preserves manual value and auth fallback only fills when empty", () => {
  const root = makeTempDir("hb-state-store-profile-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const fallback = store.applyRuntimeUserProfileAuthFallback({
    name: "Jeffrey",
  });
  const updated = store.upsertRuntimeUserProfile({
    name: "Jeff",
    nameSource: "manual",
  });
  const preserved = store.applyRuntimeUserProfileAuthFallback({
    name: "Ignored Auth Name",
  });

  assert.equal(fallback?.name, "Jeffrey");
  assert.equal(fallback?.nameSource, "auth_fallback");
  assert.equal(updated.name, "Jeff");
  assert.equal(updated.nameSource, "manual");
  assert.equal(preserved?.name, "Jeff");
  assert.equal(preserved?.nameSource, "manual");
  assert.deepEqual(store.getRuntimeUserProfile(), preserved);

  store.close();
});

test("integration connections round trip create list and reload persisted records", () => {
  const root = makeTempDir("hb-state-store-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const created = store.upsertIntegrationConnection({
    connectionId: "conn-google-1",
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    accountExternalId: "google-account-1",
    authMode: "oauth_app",
    grantedScopes: ["gmail.send", "gmail.readonly"],
    status: "active",
    secretRef: "secret/google/1"
  });
  const updated = store.upsertIntegrationConnection({
    connectionId: "conn-google-1",
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    accountExternalId: "google-account-1",
    authMode: "oauth_app",
    grantedScopes: ["gmail.send"],
    status: "needs_reauth",
    secretRef: "secret/google/1"
  });

  assert.equal(created.connectionId, "conn-google-1");
  assert.equal(updated.status, "needs_reauth");
  assert.deepEqual(store.getIntegrationConnection("conn-google-1"), updated);
  assert.deepEqual(store.listIntegrationConnections().map((record) => record.connectionId), ["conn-google-1"]);

  store.close();

  const reopened = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  assert.deepEqual(reopened.getIntegrationConnection("conn-google-1"), updated);
  assert.deepEqual(reopened.listIntegrationConnections().map((record) => record.connectionId), ["conn-google-1"]);
  reopened.close();
});

test("integration bindings round trip upsert list filter and delete by workspace", () => {
  const root = makeTempDir("hb-state-store-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.upsertIntegrationConnection({
    connectionId: "conn-google-1",
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    accountExternalId: "google-account-1",
    authMode: "platform",
    grantedScopes: ["gmail.send"],
    status: "active"
  });
  store.upsertIntegrationConnection({
    connectionId: "conn-github-1",
    providerId: "github",
    ownerUserId: "user-1",
    accountLabel: "holaboss-bot",
    accountExternalId: "github-account-1",
    authMode: "managed",
    grantedScopes: ["repo:read"],
    status: "active"
  });

  const first = store.upsertIntegrationBinding({
    bindingId: "bind-google-default",
    workspaceId: "ws-1",
    targetType: "workspace",
    targetId: "default",
    integrationKey: "google",
    connectionId: "conn-google-1",
    isDefault: true
  });
  const second = store.upsertIntegrationBinding({
    bindingId: "bind-google-app",
    workspaceId: "ws-1",
    targetType: "app",
    targetId: "gmail",
    integrationKey: "google",
    connectionId: "conn-google-1",
    isDefault: false
  });
  const otherWorkspace = store.upsertIntegrationBinding({
    bindingId: "bind-github-default",
    workspaceId: "ws-2",
    targetType: "workspace",
    targetId: "default",
    integrationKey: "github",
    connectionId: "conn-github-1",
    isDefault: true
  });

  assert.equal(first.bindingId, "bind-google-default");
  assert.equal(second.targetType, "app");
  assert.equal(otherWorkspace.workspaceId, "ws-2");
  assert.deepEqual(
    store.listIntegrationBindings({ workspaceId: "ws-1" }).map((record) => record.bindingId),
    ["bind-google-default", "bind-google-app"]
  );
  assert.deepEqual(store.getIntegrationBinding("bind-google-app"), second);

  assert.equal(store.deleteIntegrationBinding("bind-google-default"), true);
  assert.equal(store.getIntegrationBinding("bind-google-default"), null);
  assert.deepEqual(
    store.listIntegrationBindings({ workspaceId: "ws-1" }).map((record) => record.bindingId),
    ["bind-google-app"]
  );
  assert.deepEqual(
    store.listIntegrationBindings({ workspaceId: "ws-2" }).map((record) => record.bindingId),
    ["bind-github-default"]
  );

  store.close();

  const reopened = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  assert.deepEqual(
    reopened.listIntegrationBindings({ workspaceId: "ws-1" }).map((record) => record.bindingId),
    ["bind-google-app"]
  );
  assert.deepEqual(reopened.getIntegrationBinding("bind-google-app"), second);
  reopened.close();
});

test("integration binding upsert replaces the same logical target even with a different binding id", () => {
  const root = makeTempDir("hb-state-store-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.upsertIntegrationConnection({
    connectionId: "conn-google-1",
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    authMode: "oauth_app",
    grantedScopes: ["gmail.send"],
    status: "active"
  });

  const original = store.upsertIntegrationBinding({
    bindingId: "bind-google-original",
    workspaceId: "ws-1",
    targetType: "app",
    targetId: "gmail",
    integrationKey: "google",
    connectionId: "conn-google-1",
    isDefault: false
  });
  const rebound = store.upsertIntegrationBinding({
    bindingId: "bind-google-rebound",
    workspaceId: "ws-1",
    targetType: "app",
    targetId: "gmail",
    integrationKey: "google",
    connectionId: "conn-google-1",
    isDefault: true
  });

  assert.equal(original.bindingId, "bind-google-original");
  assert.equal(rebound.bindingId, "bind-google-rebound");
  assert.equal(store.getIntegrationBinding("bind-google-original"), null);
  assert.deepEqual(
    store.getIntegrationBindingByTarget({
      workspaceId: "ws-1",
      targetType: "app",
      targetId: "gmail",
      integrationKey: "google"
    }),
    rebound
  );
  assert.deepEqual(
    store.listIntegrationBindings({ workspaceId: "ws-1" }).map((record) => record.bindingId),
    ["bind-google-rebound"]
  );
  store.close();
});

test("integration binding write rejects dangling connection ids", () => {
  const root = makeTempDir("hb-state-store-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  assert.throws(
    () =>
      store.upsertIntegrationBinding({
        bindingId: "bind-missing-connection",
        workspaceId: "ws-1",
        targetType: "workspace",
        targetId: "default",
        integrationKey: "google",
        connectionId: "conn-missing",
        isDefault: true
      }),
    /integration connection/i
  );
  store.close();
});

test("integration lookup methods support target lookup and provider owner filters", () => {
  const root = makeTempDir("hb-state-store-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const googleOne = store.upsertIntegrationConnection({
    connectionId: "conn-google-1",
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    authMode: "oauth_app",
    grantedScopes: ["gmail.send"],
    status: "active"
  });
  const googleTwo = store.upsertIntegrationConnection({
    connectionId: "conn-google-2",
    providerId: "google",
    ownerUserId: "user-2",
    accountLabel: "joshua+alt@holaboss.ai",
    authMode: "oauth_app",
    grantedScopes: ["gmail.send"],
    status: "active"
  });
  const github = store.upsertIntegrationConnection({
    connectionId: "conn-github-1",
    providerId: "github",
    ownerUserId: "user-1",
    accountLabel: "holaboss-bot",
    authMode: "managed",
    grantedScopes: ["repo:read"],
    status: "active"
  });

  const binding = store.upsertIntegrationBinding({
    bindingId: "bind-google-default",
    workspaceId: "ws-1",
    targetType: "workspace",
    targetId: "default",
    integrationKey: "google",
    connectionId: "conn-google-1",
    isDefault: true
  });
  const appBinding = store.upsertIntegrationBinding({
    bindingId: "bind-google-app",
    workspaceId: "ws-1",
    targetType: "app",
    targetId: "gmail",
    integrationKey: "google",
    connectionId: "conn-google-2",
    isDefault: false
  });
  store.upsertIntegrationBinding({
    bindingId: "bind-github-default",
    workspaceId: "ws-2",
    targetType: "workspace",
    targetId: "default",
    integrationKey: "github",
    connectionId: "conn-github-1",
    isDefault: true
  });

  assert.deepEqual(
    store.getIntegrationBindingByTarget({
      workspaceId: "ws-1",
      targetType: "workspace",
      targetId: "default",
      integrationKey: "google"
    }),
    binding
  );
  assert.deepEqual(
    store.getIntegrationBindingByTarget({
      workspaceId: "ws-1",
      targetType: "app",
      targetId: "gmail",
      integrationKey: "google"
    }),
    appBinding
  );
  assert.deepEqual(
    store.listIntegrationConnections({ providerId: "google", ownerUserId: "user-1" }).map((record) => record.connectionId),
    ["conn-google-1"]
  );
  assert.deepEqual(
    store.listIntegrationConnections({ providerId: "google" }).map((record) => record.connectionId),
    ["conn-google-1", "conn-google-2"]
  );
  assert.deepEqual(
    store.listIntegrationConnections({ ownerUserId: "user-1" }).map((record) => record.connectionId),
    ["conn-github-1", "conn-google-1"]
  );
  assert.deepEqual(googleOne, store.getIntegrationConnection("conn-google-1"));
  assert.deepEqual(googleTwo, store.getIntegrationConnection("conn-google-2"));
  assert.deepEqual(github, store.getIntegrationConnection("conn-github-1"));
  store.close();
});

test("input queue supports idempotent enqueue, update, and claiming by priority", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const first = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "hello" },
    priority: 1,
    idempotencyKey: "idem-1"
  });
  const deduped = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "ignored" },
    priority: 99,
    idempotencyKey: "idem-1"
  });
  const second = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "urgent" },
    priority: 5
  });

  assert.equal(deduped.inputId, first.inputId);
  assert.equal(store.hasAvailableInputsForSession({ sessionId: "session-main", workspaceId: "workspace-1" }), true);

  const updated = store.updateInput(first.inputId, {
    status: "QUEUED",
    claimedBy: "worker-old",
    payload: { text: "hello-updated" }
  });
  assert.ok(updated);
  assert.deepEqual(updated.payload, { text: "hello-updated" });

  const claimed = store.claimInputs({ limit: 2, claimedBy: "worker-1", leaseSeconds: 60 });
  assert.equal(claimed.length, 2);
  assert.equal(claimed[0].inputId, second.inputId);
  assert.equal(claimed[0].status, "CLAIMED");
  assert.equal(claimed[0].claimedBy, "worker-1");
  assert.equal(claimed[1].inputId, first.inputId);
  assert.equal(store.hasAvailableInputsForSession({ sessionId: "session-main", workspaceId: "workspace-1" }), false);
  store.close();
});

test("claimInputs can select at most one queued input per session", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const sessionOneFirst = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-one",
    payload: { text: "session-one-first" },
    priority: 5
  });
  store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-one",
    payload: { text: "session-one-second" },
    priority: 4
  });
  const sessionTwo = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-two",
    payload: { text: "session-two" },
    priority: 3
  });

  const claimed = store.claimInputs({
    limit: 2,
    claimedBy: "worker-1",
    leaseSeconds: 60,
    distinctSessions: true
  });

  assert.equal(claimed.length, 2);
  assert.deepEqual(
    claimed.map((record) => record.inputId),
    [sessionOneFirst.inputId, sessionTwo.inputId]
  );
  assert.deepEqual(
    claimed.map((record) => record.sessionId),
    ["session-one", "session-two"]
  );
  store.close();
});

test("post-run job queue supports idempotent enqueue, update, and claiming by priority", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const first = store.enqueuePostRunJob({
    jobType: "durable_memory_writeback",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    payload: { instruction: "hello" },
    priority: 1,
    idempotencyKey: "post-run-idem-1"
  });
  const deduped = store.enqueuePostRunJob({
    jobType: "durable_memory_writeback",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    payload: { instruction: "ignored" },
    priority: 99,
    idempotencyKey: "post-run-idem-1"
  });
  const second = store.enqueuePostRunJob({
    jobType: "durable_memory_writeback",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-2",
    payload: { instruction: "urgent" },
    priority: 5
  });

  assert.equal(deduped.jobId, first.jobId);

  const updated = store.updatePostRunJob(first.jobId, {
    status: "QUEUED",
    claimedBy: "worker-old",
    payload: { instruction: "hello-updated" }
  });
  assert.ok(updated);
  assert.deepEqual(updated.payload, { instruction: "hello-updated" });

  const claimed = store.claimPostRunJobs({ limit: 2, claimedBy: "worker-1", leaseSeconds: 60 });
  assert.equal(claimed.length, 2);
  assert.equal(claimed[0].jobId, second.jobId);
  assert.equal(claimed[0].status, "CLAIMED");
  assert.equal(claimed[0].claimedBy, "worker-1");
  assert.equal(claimed[1].jobId, first.jobId);
  store.close();
});

test("state store lists expired claimed post-run jobs", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.enqueuePostRunJob({
    jobType: "durable_memory_writeback",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-queued",
    payload: {}
  });
  const stale = store.enqueuePostRunJob({
    jobType: "durable_memory_writeback",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-stale",
    payload: {}
  });
  const active = store.enqueuePostRunJob({
    jobType: "durable_memory_writeback",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-active",
    payload: {}
  });

  store.updatePostRunJob(stale.jobId, {
    status: "CLAIMED",
    claimedBy: "worker-old",
    claimedUntil: "2000-01-01T00:00:00.000Z"
  });
  store.updatePostRunJob(active.jobId, {
    status: "CLAIMED",
    claimedBy: "worker-new",
    claimedUntil: "2999-01-01T00:00:00.000Z"
  });

  const expired = store.listExpiredClaimedPostRunJobs("2026-01-01T00:00:00.000Z");

  assert.deepEqual(expired.map((record) => record.jobId), [stale.jobId]);
  store.close();
});

test("runtime state round trip supports ensure, update, list, and lookup", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const ensured = store.ensureRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    status: "QUEUED",
    currentInputId: "input-1"
  });
  const updated = store.updateRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    status: "WAITING_USER",
    currentInputId: "input-1",
    currentWorkerId: "worker-1",
    leaseUntil: "2026-01-02T00:00:00+00:00",
    heartbeatAt: "2026-01-01T00:00:00+00:00",
    lastError: { message: "blocked" }
  });

  assert.equal(ensured.status, "QUEUED");
  assert.equal(updated.status, "WAITING_USER");
  assert.deepEqual(updated.lastError, { message: "blocked" });
  assert.deepEqual(store.getRuntimeState({ sessionId: "session-main", workspaceId: "workspace-1" }), updated);
  assert.deepEqual(store.listRuntimeStates("workspace-1"), [updated]);
  store.close();
});

test("runtime state migration expands the status check constraint to include paused", () => {
  const root = makeTempDir("hb-state-store-paused-runtime-state-");
  const dbPath = path.join(root, "runtime.db");
  const workspaceRoot = path.join(root, "workspace");
  const store = new RuntimeStateStore({ dbPath, workspaceRoot });

  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active",
  });
  store.ensureRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    status: "QUEUED",
    currentInputId: "input-1",
  });
  store.close();

  const db = new Database(dbPath);
  db.exec(`
    ALTER TABLE session_runtime_state RENAME TO session_runtime_state_current;

    CREATE TABLE session_runtime_state (
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('IDLE', 'BUSY', 'WAITING_USER', 'ERROR', 'QUEUED')),
        current_input_id TEXT,
        current_worker_id TEXT,
        lease_until TEXT,
        heartbeat_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, session_id)
    );

    INSERT INTO session_runtime_state
    SELECT * FROM session_runtime_state_current;

    DROP TABLE session_runtime_state_current;
  `);
  db.close();

  const reopened = new RuntimeStateStore({ dbPath, workspaceRoot });
  const updated = reopened.updateRuntimeState({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    status: "PAUSED",
    currentInputId: null,
    currentWorkerId: null,
    leaseUntil: null,
    heartbeatAt: "2026-01-01T00:00:00.000Z",
    lastError: null,
  });

  assert.equal(updated.status, "PAUSED");
  reopened.close();
});

test("state store lists expired claimed inputs", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "queued" }
  });
  const stale = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "stale" }
  });
  const active = store.enqueueInput({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    payload: { text: "active" }
  });

  store.updateInput(stale.inputId, {
    status: "CLAIMED",
    claimedBy: "worker-old",
    claimedUntil: "2000-01-01T00:00:00.000Z"
  });
  store.updateInput(active.inputId, {
    status: "CLAIMED",
    claimedBy: "worker-new",
    claimedUntil: "2999-01-01T00:00:00.000Z"
  });

  const expired = store.listExpiredClaimedInputs("2026-01-01T00:00:00.000Z");

  assert.deepEqual(expired.map((record) => record.inputId), [stale.inputId]);
  store.close();
});

test("session messages preserve ascending order and include metadata placeholder", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "user",
    text: "hello",
    messageId: "m-1",
    createdAt: "2026-01-01T00:00:00+00:00"
  });
  store.insertSessionMessage({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    role: "assistant",
    text: "hi",
    messageId: "m-2",
    createdAt: "2026-01-01T00:00:01+00:00"
  });

  assert.deepEqual(store.listSessionMessages({ workspaceId: "workspace-1", sessionId: "session-main" }), [
    {
      id: "m-1",
      role: "user",
      text: "hello",
      createdAt: "2026-01-01T00:00:00+00:00",
      metadata: {}
    },
    {
      id: "m-2",
      role: "assistant",
      text: "hi",
      createdAt: "2026-01-01T00:00:01+00:00",
      metadata: {}
    }
  ]);
  assert.deepEqual(
    store.listSessionMessages({
      workspaceId: "workspace-1",
      sessionId: "session-main",
      role: "user",
      order: "desc",
      limit: 1,
    }),
    [
      {
        id: "m-1",
        role: "user",
        text: "hello",
        createdAt: "2026-01-01T00:00:00+00:00",
        metadata: {}
      }
    ]
  );
  store.close();
});

test("output events support latest id, incremental listing, and tail mode", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.appendOutputEvent({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    sequence: 1,
    eventType: "run_started",
    payload: { instruction_preview: "hello" }
  });
  store.appendOutputEvent({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    sequence: 2,
    eventType: "output_delta",
    payload: { delta: "hi" }
  });

  const latest = store.latestOutputEventId({ sessionId: "session-main", inputId: "input-1" });
  const incremental = store.listOutputEvents({
    sessionId: "session-main",
    inputId: "input-1",
    afterEventId: 1
  });
  const tail = store.listOutputEvents({
    sessionId: "session-main",
    inputId: "input-1",
    includeHistory: false
  });

  assert.equal(latest, 2);
  assert.equal(incremental.length, 1);
  assert.equal(incremental[0].eventType, "output_delta");
  assert.deepEqual(incremental[0].payload, { delta: "hi" });
  assert.deepEqual(tail, []);
  store.close();
});

test("turn results support upsert, lookup, count, and listing", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    status: "completed",
    stopReason: "ok",
    assistantText: "done",
    toolUsageSummary: {
      total_calls: 1,
      completed_calls: 1,
      failed_calls: 0,
      tool_names: ["read"],
      tool_ids: []
    },
    permissionDenials: [],
    promptSectionIds: ["runtime_core", "execution_policy"],
    capabilityManifestFingerprint: "abc123",
    requestSnapshotFingerprint: "snap-1",
    promptCacheProfile: {
      cacheable_section_ids: ["runtime_core"],
      volatile_section_ids: ["execution_policy"],
    },
    compactedSummary: null,
    compactionBoundaryId: null,
    tokenUsage: { input_tokens: 10, output_tokens: 20 },
  });
  const updated = store.upsertTurnResult({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:06.000Z",
    status: "waiting_user",
    stopReason: "waiting_user",
    assistantText: "need confirmation",
    toolUsageSummary: {
      total_calls: 2,
      completed_calls: 2,
      failed_calls: 0,
      tool_names: ["question", "read"],
      tool_ids: []
    },
    permissionDenials: [{ tool_name: "deploy", tool_id: null, reason: "permission denied" }],
    promptSectionIds: ["runtime_core", "session_policy"],
    capabilityManifestFingerprint: "def456",
    requestSnapshotFingerprint: "snap-2",
    promptCacheProfile: {
      cacheable_section_ids: ["runtime_core"],
      volatile_section_ids: ["session_policy"],
    },
    compactedSummary: "summary",
    compactionBoundaryId: "compaction:input-1",
    tokenUsage: { input_tokens: 11, output_tokens: 21 },
  });

  assert.equal(updated.status, "waiting_user");
  assert.equal(updated.stopReason, "waiting_user");
  assert.equal(updated.assistantText, "need confirmation");
  assert.deepEqual(updated.promptSectionIds, ["runtime_core", "session_policy"]);
  assert.equal(updated.requestSnapshotFingerprint, "snap-2");
  assert.deepEqual(updated.promptCacheProfile, {
    cacheable_section_ids: ["runtime_core"],
    volatile_section_ids: ["session_policy"],
  });
  assert.equal(updated.compactionBoundaryId, "compaction:input-1");
  assert.deepEqual(updated.permissionDenials, [
    { tool_name: "deploy", tool_id: null, reason: "permission denied" }
  ]);
  assert.deepEqual(store.getTurnResult({ inputId: "input-1" }), updated);
  assert.equal(store.countTurnResults({ workspaceId: "workspace-1", sessionId: "session-main" }), 1);
  assert.equal(store.countTurnResults({ workspaceId: "workspace-1", sessionId: "session-main", status: "completed" }), 0);
  assert.equal(store.countTurnResults({ workspaceId: "workspace-1", sessionId: "session-main", status: "waiting_user" }), 1);
  assert.deepEqual(store.listTurnResults({ workspaceId: "workspace-1", sessionId: "session-main" }), [updated]);
  assert.deepEqual(store.listTurnResults({ workspaceId: "workspace-1", sessionId: "session-main", status: "waiting_user" }), [updated]);
  store.close();
});

test("turn request snapshots and compaction boundaries round trip", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const snapshot = store.upsertTurnRequestSnapshot({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    snapshotKind: "harness_host_request",
    fingerprint: "f".repeat(64),
    payload: {
      provider_id: "openai",
      model_id: "gpt-5.4",
      system_prompt: "You are concise.",
    },
  });
  const boundary = store.upsertCompactionBoundary({
    boundaryId: "compaction:input-1",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    previousBoundaryId: null,
    summary: "Recent work summary.",
    recentRuntimeContext: {
      summary: "Recent work summary.",
      last_stop_reason: "ok",
    },
    restorationContext: {
      session_resume_context: {
        recent_turns: [{ input_id: "input-1", status: "completed", summary: "Recent work summary." }],
        recent_user_messages: ["Continue from here."],
      },
      restored_memory_paths: ["workspace/workspace-1/runtime/latest-turn.md"],
    },
    preservedTurnInputIds: ["input-1"],
    requestSnapshotFingerprint: snapshot.fingerprint,
  });

  assert.deepEqual(store.getTurnRequestSnapshot({ inputId: "input-1" }), snapshot);
  assert.deepEqual(store.listTurnRequestSnapshots({ workspaceId: "workspace-1", sessionId: "session-main" }), [snapshot]);
  assert.equal(boundary.boundaryType, "executor_post_turn");
  assert.deepEqual(store.getCompactionBoundary({ boundaryId: "compaction:input-1" }), boundary);
  assert.deepEqual(store.listCompactionBoundaries({ workspaceId: "workspace-1", sessionId: "session-main" }), [boundary]);
  store.close();
});

test("memory entries round trip and filter by workspace or scope", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const preference = store.upsertMemoryEntry({
    memoryId: "user-preference:response-style",
    workspaceId: null,
    sessionId: "session-main",
    scope: "user",
    memoryType: "preference",
    subjectKey: "response-style",
    path: "preference/response-style.md",
    title: "User response style",
    summary: "User prefers concise responses.",
    tags: ["concise", "response-style"],
    verificationPolicy: "none",
    stalenessPolicy: "stable",
    staleAfterSeconds: null,
    sourceTurnInputId: "input-1",
    sourceMessageId: "user-1",
    sourceType: "session_message",
    observedAt: "2026-04-02T12:00:00.000Z",
    lastVerifiedAt: "2026-04-02T12:00:00.000Z",
    confidence: 0.99,
    fingerprint: "p".repeat(64),
  });
  const blocker = store.upsertMemoryEntry({
    memoryId: "workspace-blocker:workspace-1:deploy",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    scope: "workspace",
    memoryType: "blocker",
    subjectKey: "permission:deploy",
    path: "workspace/workspace-1/knowledge/blockers/deploy.md",
    title: "Deploy permission blocker",
    summary: "Deploy calls may be denied by policy.",
    tags: ["deploy", "permission", "blocker"],
    verificationPolicy: "check_before_use",
    stalenessPolicy: "workspace_sensitive",
    staleAfterSeconds: 14 * 24 * 60 * 60,
    sourceTurnInputId: "input-2",
    sourceMessageId: null,
    sourceType: "permission_denial",
    observedAt: "2026-04-02T12:05:00.000Z",
    lastVerifiedAt: "2026-04-02T12:05:00.000Z",
    confidence: 0.92,
    fingerprint: "b".repeat(64),
  });

  assert.deepEqual(store.getMemoryEntry({ memoryId: "user-preference:response-style" }), preference);
  assert.deepEqual(store.listMemoryEntries({ scope: "user", status: "active" }), [preference]);
  assert.deepEqual(
    store.listMemoryEntries({ scope: "user", memoryType: "preference", status: "active" }),
    [preference]
  );
  assert.deepEqual(store.listMemoryEntries({ workspaceId: "workspace-1", status: "active" }), [blocker]);
  assert.deepEqual(store.listWorkspaceMemoryEntryCounts({ status: "active" }), [
    { workspaceId: "workspace-1", count: 1 }
  ]);
  assert.deepEqual(
    store.listMemoryEntries({ status: "active" }).map((entry) => entry.memoryId),
    [preference.memoryId, blocker.memoryId]
  );
  store.close();
});

test("app build status round trip supports upsert, lookup, and delete", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const building = store.upsertAppBuild({
    workspaceId: "workspace-1",
    appId: "app-a",
    status: "building"
  });
  const failed = store.upsertAppBuild({
    workspaceId: "workspace-1",
    appId: "app-a",
    status: "failed",
    error: "boom"
  });
  const completed = store.upsertAppBuild({
    workspaceId: "workspace-1",
    appId: "app-a",
    status: "completed"
  });
  const fetched = store.getAppBuild({
    workspaceId: "workspace-1",
    appId: "app-a"
  });
  const deleted = store.deleteAppBuild({
    workspaceId: "workspace-1",
    appId: "app-a"
  });

  assert.equal(building.status, "building");
  assert.ok(building.startedAt);
  assert.equal(building.completedAt, null);
  assert.equal(building.error, null);
  assert.equal(failed.status, "failed");
  assert.ok(failed.completedAt);
  assert.equal(failed.error, "boom");
  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt);
  assert.equal(completed.error, null);
  assert.ok(fetched);
  assert.equal(fetched.status, "completed");
  assert.equal(deleted, true);
  assert.equal(
    store.getAppBuild({
      workspaceId: "workspace-1",
      appId: "app-a"
    }),
    null
  );
  store.close();
});

test("cronjobs round trip supports create, list, update, get, and delete", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const job = store.createCronjob({
    workspaceId: "workspace-1",
    initiatedBy: "workspace_agent",
    cron: "0 9 * * *",
    description: "Daily check",
    instruction: "Say hello",
    delivery: { mode: "announce", channel: "session_run", to: null }
  });
  const listed = store.listCronjobs({ workspaceId: "workspace-1" });
  const fetched = store.getCronjob(job.id);
  const updated = store.updateCronjob({ jobId: job.id, description: "Updated check", instruction: "Say hello loudly" });
  const deleted = store.deleteCronjob(job.id);

  assert.equal(listed.length, 1);
  assert.ok(fetched);
  assert.equal(fetched.instruction, "Say hello");
  assert.ok(updated);
  assert.equal(updated.description, "Updated check");
  assert.equal(updated.instruction, "Say hello loudly");
  assert.equal(deleted, true);
  store.close();
});

test("cronjob schema migration backfills instruction from legacy description", () => {
  const root = makeTempDir("hb-state-store-");
  const dbPath = path.join(root, "runtime.db");
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE cronjobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        initiated_by TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        cron TEXT NOT NULL,
        description TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        delivery TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        last_run_at TEXT,
        next_run_at TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        last_status TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO cronjobs (
      id, workspace_id, initiated_by, name, cron, description, enabled, delivery, metadata,
      last_run_at, next_run_at, run_count, last_status, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "job-1",
    "workspace-1",
    "workspace_agent",
    "Greeting",
    "*/5 * * * *",
    "Say hello every 5 minutes.",
    1,
    JSON.stringify({ channel: "session_run" }),
    "{}",
    null,
    null,
    0,
    null,
    null,
    "2026-01-01T00:00:00+00:00",
    "2026-01-01T00:00:00+00:00"
  );
  db.close();

  const store = new RuntimeStateStore({ dbPath, workspaceRoot });
  const migrated = store.getCronjob("job-1");

  assert.ok(migrated);
  assert.equal(migrated.instruction, "Say hello every 5 minutes.");
  store.close();
});

test("runtime notifications round trip supports create, list, update, get, and dismiss", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const created = store.createRuntimeNotification({
    workspaceId: "workspace-1",
    cronjobId: "cronjob-1",
    sourceType: "cronjob",
    sourceLabel: "Workspace 1",
    title: "Drink Water",
    message: "Time to drink water.",
    level: "info",
    priority: "high"
  });
  const listed = store.listRuntimeNotifications({ workspaceId: "workspace-1" });
  const fetched = store.getRuntimeNotification(created.id);
  const updated = store.updateRuntimeNotification({
    notificationId: created.id,
    state: "read"
  });
  const dismissed = store.updateRuntimeNotification({
    notificationId: created.id,
    state: "dismissed"
  });
  const listedWithoutDismissed = store.listRuntimeNotifications({
    workspaceId: "workspace-1"
  });
  const listedIncludingDismissed = store.listRuntimeNotifications({
    workspaceId: "workspace-1",
    includeDismissed: true
  });

  assert.equal(listed.length, 1);
  assert.ok(fetched);
  assert.equal(fetched.priority, "high");
  assert.ok(updated);
  assert.equal(updated.state, "read");
  assert.ok(updated.readAt);
  assert.ok(dismissed);
  assert.equal(dismissed.state, "dismissed");
  assert.ok(dismissed.dismissedAt);
  assert.equal(listedWithoutDismissed.length, 0);
  assert.equal(listedIncludingDismissed.length, 1);
  store.close();
});

test("runtime notifications sort by priority before recency", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.createRuntimeNotification({
    workspaceId: "workspace-1",
    title: "Normal",
    message: "Normal priority",
    priority: "normal",
    createdAt: "2026-01-01T10:00:00.000Z"
  });
  store.createRuntimeNotification({
    workspaceId: "workspace-1",
    title: "Critical",
    message: "Critical priority",
    priority: "critical",
    createdAt: "2026-01-01T09:00:00.000Z"
  });
  store.createRuntimeNotification({
    workspaceId: "workspace-1",
    title: "High",
    message: "High priority",
    priority: "high",
    createdAt: "2026-01-01T11:00:00.000Z"
  });

  const listed = store.listRuntimeNotifications({ workspaceId: "workspace-1" });

  assert.deepEqual(
    listed.map((item) => item.title),
    ["Critical", "High", "Normal"]
  );
  assert.deepEqual(
    listed.map((item) => item.priority),
    ["critical", "high", "normal"]
  );
  store.close();
});

test("task proposals round trip supports create, list, unreviewed, get, and state update", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const proposal = store.createTaskProposal({
    proposalId: "proposal-1",
    workspaceId: "workspace-1",
    taskName: "Follow up",
    taskPrompt: "Write a follow-up message",
    taskGenerationRationale: "User has not replied",
    sourceEventIds: ["evt-1"],
    createdAt: "2026-01-01T00:00:00+00:00"
  });
  const listed = store.listTaskProposals({ workspaceId: "workspace-1" });
  const unreviewed = store.listUnreviewedTaskProposals({ workspaceId: "workspace-1" });
  const fetched = store.getTaskProposal("proposal-1");
  const updated = store.updateTaskProposalState({ proposalId: "proposal-1", state: "accepted" });

  assert.equal(proposal.proposalId, "proposal-1");
  assert.equal(proposal.proposalSource, "proactive");
  assert.equal(listed.length, 1);
  assert.equal(unreviewed.length, 1);
  assert.ok(fetched);
  assert.equal(fetched?.proposalSource, "proactive");
  assert.ok(updated);
  assert.equal(updated.state, "accepted");
  store.close();
});

test("task proposal acceptance fields and child session metadata round trip", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const session = store.ensureSession({
    workspaceId: "workspace-1",
    sessionId: "proposal-session-1",
    kind: "task_proposal",
    title: "Follow up",
    parentSessionId: "session-main",
    sourceProposalId: "proposal-1",
    createdBy: "workspace_user"
  });
  store.createTaskProposal({
    proposalId: "proposal-1",
    workspaceId: "workspace-1",
    taskName: "Follow up",
    taskPrompt: "Write a follow-up message",
    taskGenerationRationale: "User has not replied",
    sourceEventIds: ["evt-1"],
    createdAt: "2026-01-01T00:00:00+00:00"
  });

  const sessions = store.listSessions({ workspaceId: "workspace-1" });
  const updated = store.updateTaskProposal({
    proposalId: "proposal-1",
    fields: {
      state: "accepted",
      acceptedSessionId: session.sessionId,
      acceptedInputId: "input-1",
      acceptedAt: "2026-01-01T01:00:00+00:00"
    }
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.kind, "task_proposal");
  assert.equal(sessions[0]?.parentSessionId, "session-main");
  assert.equal(sessions[0]?.sourceProposalId, "proposal-1");
  assert.ok(updated);
  assert.equal(updated.acceptedSessionId, "proposal-session-1");
  assert.equal(updated.acceptedInputId, "input-1");
  assert.equal(updated.acceptedAt, "2026-01-01T01:00:00+00:00");
  store.close();
});

test("task proposal round trip preserves explicit evolve source", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const proposal = store.createTaskProposal({
    proposalId: "proposal-evolve-1",
    workspaceId: "workspace-1",
    taskName: "Review generated skill patch",
    taskPrompt: "Inspect the queued evolve skill patch.",
    taskGenerationRationale: "Evolve flagged a risky patch for review",
    proposalSource: "evolve",
    createdAt: "2026-01-01T00:00:00+00:00"
  });

  assert.equal(proposal.proposalSource, "evolve");
  assert.equal(store.getTaskProposal("proposal-evolve-1")?.proposalSource, "evolve");
  store.close();
});

test("evolve skill candidates round trip supports create, list, lookup, and update", () => {
  const root = makeTempDir("hb-state-store-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  store.ensureSession({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    kind: "main",
    title: "Main"
  });

  const created = store.createEvolveSkillCandidate({
    candidateId: "candidate-1",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    kind: "skill_create",
    status: "draft",
    title: "Release verification skill",
    summary: "Reusable release verification workflow.",
    slug: "release-verification",
    skillPath: "workspace/workspace-1/evolve/skills/candidate-1/SKILL.md",
    contentFingerprint: "fp-1",
    confidence: 0.91,
    evaluationNotes: "Looks reusable.",
    sourceTurnInputIds: ["input-1"],
  });

  const fetched = store.getEvolveSkillCandidate("candidate-1");
  const listed = store.listEvolveSkillCandidates({ workspaceId: "workspace-1" });
  const updated = store.updateEvolveSkillCandidate({
    candidateId: "candidate-1",
    fields: {
      taskProposalId: "proposal-1",
      status: "proposed",
      proposedAt: "2026-04-10T00:00:00.000Z",
    }
  });

  assert.equal(created.kind, "skill_create");
  assert.equal(created.status, "draft");
  assert.equal(created.slug, "release-verification");
  assert.equal(fetched?.candidateId, "candidate-1");
  assert.equal(fetched?.evaluationNotes, "Looks reusable.");
  assert.equal(listed.length, 1);
  assert.equal(updated?.taskProposalId, "proposal-1");
  assert.equal(updated?.status, "proposed");
  assert.equal(store.getEvolveSkillCandidateByTaskProposalId("proposal-1")?.candidateId, "candidate-1");
  store.close();
});

test("memory update proposals round trip supports create list filter get and accept metadata", () => {
  const root = makeTempDir("hb-state-store-memory-proposals-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.ensureSession({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    kind: "main",
    title: "Main"
  });
  const created = store.createMemoryUpdateProposal({
    proposalId: "memory-proposal-1",
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    proposalKind: "preference",
    targetKey: "response-style",
    title: "Response style preference",
    summary: "Prefer concise responses.",
    payload: {
      preference_type: "response_style",
      style: "concise",
    },
    evidence: "Please keep your responses concise.",
    confidence: 0.99,
    sourceMessageId: "user-input-1",
    createdAt: "2026-04-03T10:00:00.000Z"
  });

  const listed = store.listMemoryUpdateProposals({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    inputId: "input-1",
    limit: 10,
    offset: 0
  });
  const fetched = store.getMemoryUpdateProposal("memory-proposal-1");
  const accepted = store.updateMemoryUpdateProposal({
    proposalId: "memory-proposal-1",
    fields: {
      summary: "Prefer concise responses.",
      state: "accepted",
      persistedMemoryId: "user-preference:response-style",
      acceptedAt: "2026-04-03T10:01:00.000Z",
      dismissedAt: null
    }
  });

  assert.equal(created.state, "pending");
  assert.equal(listed.length, 1);
  assert.ok(fetched);
  assert.deepEqual(fetched?.payload, {
    preference_type: "response_style",
    style: "concise",
  });
  assert.equal(accepted?.state, "accepted");
  assert.equal(accepted?.persistedMemoryId, "user-preference:response-style");
  assert.equal(accepted?.acceptedAt, "2026-04-03T10:01:00.000Z");
  assert.deepEqual(
    store.listMemoryUpdateProposals({
      workspaceId: "workspace-1",
      state: "accepted",
      limit: 10,
      offset: 0
    }).map((proposal) => proposal.proposalId),
    ["memory-proposal-1"]
  );

  store.close();
});

test("allocateAppPort assigns sequential ports starting from 38080", () => {
  const root = makeTempDir("hb-store-ports-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "test.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const p1 = store.allocateAppPort({ workspaceId: "ws-1", appId: "gmail" });
  const p2 = store.allocateAppPort({ workspaceId: "ws-1", appId: "sheets" });

  assert.equal(p1.port, 38080);
  assert.equal(p2.port, 38081);
  assert.equal(p1.appId, "gmail");
  assert.equal(p2.appId, "sheets");

  store.close();
});

test("allocateAppPort reuses existing port for same app", () => {
  const root = makeTempDir("hb-store-ports-reuse-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "test.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const p1 = store.allocateAppPort({ workspaceId: "ws-1", appId: "gmail" });
  const p2 = store.allocateAppPort({ workspaceId: "ws-1", appId: "gmail" });

  assert.equal(p1.port, p2.port);

  store.close();
});

test("listAppPorts returns all ports for workspace", () => {
  const root = makeTempDir("hb-store-ports-list-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "test.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  store.allocateAppPort({ workspaceId: "ws-1", appId: "gmail" });
  store.allocateAppPort({ workspaceId: "ws-1", appId: "sheets" });
  store.allocateAppPort({ workspaceId: "ws-2", appId: "github" });

  const ws1Ports = store.listAppPorts({ workspaceId: "ws-1" });
  assert.equal(ws1Ports.length, 2);

  const ws2Ports = store.listAppPorts({ workspaceId: "ws-2" });
  assert.equal(ws2Ports.length, 1);

  store.close();
});

test("deleteAppPort removes port and frees it for reuse", () => {
  const root = makeTempDir("hb-store-ports-delete-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "test.db"),
    workspaceRoot: path.join(root, "workspace")
  });

  const p1 = store.allocateAppPort({ workspaceId: "ws-1", appId: "gmail" });
  store.deleteAppPort({ workspaceId: "ws-1", appId: "gmail" });

  const deleted = store.getAppPort({ workspaceId: "ws-1", appId: "gmail" });
  assert.equal(deleted, null);

  // Port should be available again
  const p2 = store.allocateAppPort({ workspaceId: "ws-1", appId: "twitter" });
  assert.equal(p2.port, p1.port);

  store.close();
});
