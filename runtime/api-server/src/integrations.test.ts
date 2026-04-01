import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import { IntegrationServiceError, RuntimeIntegrationService } from "./integrations.js";

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

test("returns the phase 1 integration catalog with google first", () => {
  const root = makeTempDir("hb-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const service = new RuntimeIntegrationService(store);

  const catalog = service.getCatalog();

  assert.equal(catalog.providers[0]?.provider_id, "google");
  assert.deepEqual(
    catalog.providers.map((provider) => provider.provider_id),
    ["google", "github", "reddit", "twitter", "linkedin"]
  );

  store.close();
});

test("upserts workspace-scoped bindings and rejects invalid target types", () => {
  const root = makeTempDir("hb-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const service = new RuntimeIntegrationService(store);
  const connection = store.upsertIntegrationConnection({
    connectionId: "conn-google-1",
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    authMode: "oauth_app",
    grantedScopes: ["gmail.send"],
    status: "active"
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active"
  });

  const binding = service.upsertBinding({
    workspaceId: "workspace-1",
    targetType: "workspace",
    targetId: "default",
    integrationKey: "google",
    connectionId: connection.connectionId,
    isDefault: true
  });

  assert.equal(binding.workspace_id, "workspace-1");
  assert.equal(binding.connection_id, connection.connectionId);
  assert.equal(service.listBindings({ workspaceId: "workspace-1" }).bindings[0]?.workspace_id, "workspace-1");
  assert.equal(service.deleteBinding(binding.binding_id, "workspace-1").deleted, true);

  assert.throws(
    () =>
      service.upsertBinding({
        workspaceId: "workspace-1",
        targetType: "invalid",
        targetId: "default",
        integrationKey: "google",
        connectionId: connection.connectionId,
        isDefault: false
      }),
    (error: unknown) =>
      error instanceof IntegrationServiceError &&
      error.statusCode === 400 &&
      error.message.includes("target_type")
  );

  store.close();
});

test("rejects missing connections, cross-provider bindings, and missing workspaces", () => {
  const root = makeTempDir("hb-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const service = new RuntimeIntegrationService(store);
  const githubConnection = store.upsertIntegrationConnection({
    connectionId: "conn-github-1",
    providerId: "github",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    authMode: "oauth_app",
    grantedScopes: ["repo"],
    status: "active"
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active"
  });

  assert.throws(
    () =>
      service.upsertBinding({
        workspaceId: "workspace-1",
        targetType: "workspace",
        targetId: "default",
        integrationKey: "github",
        connectionId: "missing-connection",
        isDefault: true
      }),
    (error: unknown) =>
      error instanceof IntegrationServiceError &&
      error.statusCode === 404 &&
      error.message.includes("integration connection")
  );

  assert.throws(
    () =>
      service.upsertBinding({
        workspaceId: "workspace-1",
        targetType: "workspace",
        targetId: "default",
        integrationKey: "google",
        connectionId: githubConnection.connectionId,
        isDefault: true
      }),
    (error: unknown) =>
      error instanceof IntegrationServiceError &&
      error.statusCode === 400 &&
      error.message.includes("does not match")
  );

  assert.throws(
    () => service.listBindings({ workspaceId: "missing-workspace" }),
    (error: unknown) =>
      error instanceof IntegrationServiceError &&
      error.statusCode === 404 &&
      error.message === "workspace not found"
  );

  store.close();
});

test("rejects delete binding requests without workspace scoping or with the wrong workspace", () => {
  const root = makeTempDir("hb-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const service = new RuntimeIntegrationService(store);
  const connection = store.upsertIntegrationConnection({
    connectionId: "conn-google-1",
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    authMode: "oauth_app",
    grantedScopes: ["gmail.send"],
    status: "active"
  });
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active"
  });
  store.createWorkspace({
    workspaceId: "workspace-2",
    name: "Workspace 2",
    harness: "pi",
    status: "active"
  });
  const binding = service.upsertBinding({
    workspaceId: "workspace-1",
    targetType: "workspace",
    targetId: "default",
    integrationKey: "google",
    connectionId: connection.connectionId,
    isDefault: true
  });

  assert.throws(
    () => service.deleteBinding(binding.binding_id),
    (error: unknown) =>
      error instanceof IntegrationServiceError &&
      error.statusCode === 400 &&
      error.message.includes("workspace_id")
  );

  assert.throws(
    () => service.deleteBinding(binding.binding_id, "workspace-2" as never),
    (error: unknown) =>
      error instanceof IntegrationServiceError &&
      error.statusCode === 404 &&
      error.message === "binding not found"
  );

  store.close();
});

test("creates a connection via manual token import and lists it", () => {
  const root = makeTempDir("hb-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const service = new RuntimeIntegrationService(store);

  const connection = service.createConnection({
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    authMode: "manual_token",
    grantedScopes: ["gmail.send", "gmail.readonly"],
    secretRef: "gya_manual-token-value"
  });

  assert.equal(connection.provider_id, "google");
  assert.equal(connection.account_label, "joshua@holaboss.ai");
  assert.equal(connection.auth_mode, "manual_token");
  assert.equal(connection.status, "active");
  assert.ok(connection.connection_id);

  const listed = service.listConnections({ providerId: "google" });
  assert.equal(listed.connections.length, 1);
  assert.equal(listed.connections[0]?.connection_id, connection.connection_id);

  store.close();
});

test("manual token import generates a default account label when none is provided", () => {
  const root = makeTempDir("hb-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const service = new RuntimeIntegrationService(store);

  const connection = service.createConnection({
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "   ",
    authMode: "manual_token",
    grantedScopes: ["gmail.send"],
    secretRef: "gya_manual-token-value"
  });

  assert.equal(connection.account_label, "Google connection");

  store.close();
});

test("updates connection status and secret_ref", () => {
  const root = makeTempDir("hb-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const service = new RuntimeIntegrationService(store);
  const connection = service.createConnection({
    providerId: "github",
    ownerUserId: "user-1",
    accountLabel: "holaboss-bot",
    authMode: "manual_token",
    grantedScopes: ["repo"],
    secretRef: "ghp_old-token"
  });

  const updated = service.updateConnection(connection.connection_id, {
    status: "expired"
  });
  assert.equal(updated.status, "expired");

  const rotated = service.updateConnection(connection.connection_id, {
    secretRef: "ghp_new-token",
    status: "active"
  });
  assert.equal(rotated.status, "active");

  store.close();
});

test("deletes a connection and rejects deletion when bindings exist", () => {
  const root = makeTempDir("hb-integrations-");
  const store = new RuntimeStateStore({
    dbPath: path.join(root, "runtime.db"),
    workspaceRoot: path.join(root, "workspace")
  });
  const service = new RuntimeIntegrationService(store);
  store.createWorkspace({
    workspaceId: "workspace-1",
    name: "Workspace 1",
    harness: "pi",
    status: "active"
  });
  const connection = service.createConnection({
    providerId: "google",
    ownerUserId: "user-1",
    accountLabel: "joshua@holaboss.ai",
    authMode: "manual_token",
    grantedScopes: ["gmail.send"],
    secretRef: "gya_token"
  });

  service.upsertBinding({
    workspaceId: "workspace-1",
    targetType: "workspace",
    targetId: "default",
    integrationKey: "google",
    connectionId: connection.connection_id,
    isDefault: true
  });

  assert.throws(
    () => service.deleteConnection(connection.connection_id),
    (error: unknown) =>
      error instanceof IntegrationServiceError &&
      error.statusCode === 409 &&
      error.message.includes("bound")
  );

  service.deleteBinding(
    service.listBindings({ workspaceId: "workspace-1" }).bindings[0]!.binding_id,
    "workspace-1"
  );

  const result = service.deleteConnection(connection.connection_id);
  assert.equal(result.deleted, true);
  assert.equal(service.listConnections({ providerId: "google" }).connections.length, 0);

  store.close();
});
