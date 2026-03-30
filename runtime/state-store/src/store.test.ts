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
    harness: "opencode",
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
    "opencode",
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
    harness: "opencode",
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
    sandboxAgentHarness: "opencode"
  });

  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Acme",
    harness: "opencode",
    status: "active"
  });
  const db = new Database(dbPath);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run("workspace-1");
  db.close();

  const recovered = store.getWorkspace("workspace-1");

  assert.ok(recovered);
  assert.equal(recovered.id, "workspace-1");
  assert.equal(recovered.name, "workspace-1");
  assert.equal(recovered.harness, "opencode");
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
  assert.equal(row.harness, "opencode");
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
    harness: "opencode",
    harnessSessionId: "harness-1"
  });
  const updated = store.upsertBinding({
    workspaceId: "workspace-1",
    sessionId: "session-main",
    harness: "opencode",
    harnessSessionId: "harness-2"
  });

  assert.equal(created.workspaceId, "workspace-1");
  assert.equal(updated.harnessSessionId, "harness-2");
  assert.deepEqual(
    store.getBinding({ workspaceId: "workspace-1", sessionId: "session-main" }),
    updated
  );
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
    delivery: { mode: "announce", channel: "session_run", to: null }
  });
  const listed = store.listCronjobs({ workspaceId: "workspace-1" });
  const fetched = store.getCronjob(job.id);
  const updated = store.updateCronjob({ jobId: job.id, description: "Updated check" });
  const deleted = store.deleteCronjob(job.id);

  assert.equal(listed.length, 1);
  assert.ok(fetched);
  assert.ok(updated);
  assert.equal(updated.description, "Updated check");
  assert.equal(deleted, true);
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
  assert.equal(listed.length, 1);
  assert.equal(unreviewed.length, 1);
  assert.ok(fetched);
  assert.ok(updated);
  assert.equal(updated.state, "accepted");
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
