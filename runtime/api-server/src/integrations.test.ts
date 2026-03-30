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
  assert.equal(service.deleteBinding(binding.binding_id).deleted, true);

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
