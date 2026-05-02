import type Database from "better-sqlite3";
import type { ComposioService } from "./composio-service.js";
import {
  type TriggerHandlerSpec,
  type TriggersManifest,
  configSha,
} from "./data-schema-triggers.js";

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS _app_trigger_subscriptions (
  app_id              TEXT NOT NULL,
  trigger_slug        TEXT NOT NULL,
  composio_trigger_id TEXT NOT NULL,
  handler_path        TEXT NOT NULL,
  config_sha          TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (app_id, trigger_slug)
);
`;

export type ApplyAppTriggersResult =
  | { kind: "noop" }
  | { kind: "applied"; created: string[]; deleted: string[]; replaced: string[] };

type SubscriptionRow = {
  trigger_slug: string;
  composio_trigger_id: string;
  handler_path: string;
  config_sha: string;
};

// Reconciler. Compare manifest handlers against persisted subscriptions
// in the app's data.db; create new, delete removed, recreate when
// config_sha drifts (Composio offers no triggers.update, so it's a
// delete + create with a brief gap window).
export async function applyAppTriggers(params: {
  appId: string;
  db: Database.Database;
  manifest: TriggersManifest;
  userId: string;
  connectedAccountId: string;
  composio: ComposioService;
}): Promise<ApplyAppTriggersResult> {
  const { appId, db, manifest, userId, connectedAccountId, composio } = params;
  db.exec(TABLE_DDL);

  const existing = db
    .prepare<unknown[], SubscriptionRow>(
      `SELECT trigger_slug, composio_trigger_id, handler_path, config_sha
       FROM _app_trigger_subscriptions WHERE app_id = ?`
    )
    .all(appId);
  const existingBySlug = new Map(existing.map((row) => [row.trigger_slug, row]));

  const desired = new Map<string, { handler: TriggerHandlerSpec; sha: string }>();
  for (const handler of manifest.handlers) {
    desired.set(handler.slug, { handler, sha: configSha(handler) });
  }

  const created: string[] = [];
  const deleted: string[] = [];
  const replaced: string[] = [];

  // Delete subscriptions no longer in the manifest, plus those whose
  // config_sha drifted (will be recreated below).
  for (const row of existing) {
    const want = desired.get(row.trigger_slug);
    const isStale = !want || want.sha !== row.config_sha;
    if (!isStale) {
      continue;
    }
    await deleteComposioTrigger(composio, connectedAccountId, row.composio_trigger_id);
    db.prepare(
      `DELETE FROM _app_trigger_subscriptions WHERE app_id = ? AND trigger_slug = ?`
    ).run(appId, row.trigger_slug);
    if (want && want.sha !== row.config_sha) {
      replaced.push(row.trigger_slug);
    } else {
      deleted.push(row.trigger_slug);
    }
  }

  // Create subscriptions newly in manifest (or recreated post-drift).
  for (const [slug, { handler, sha }] of desired.entries()) {
    const stillExists = existingBySlug.get(slug);
    if (stillExists && stillExists.config_sha === sha) {
      continue;
    }
    const triggerId = await createComposioTrigger({
      composio,
      connectedAccountId,
      userId,
      handler,
    });
    db.prepare(
      `INSERT INTO _app_trigger_subscriptions
         (app_id, trigger_slug, composio_trigger_id, handler_path, config_sha)
       VALUES (?, ?, ?, ?, ?)`
    ).run(appId, slug, triggerId, handler.handlerPath, sha);
    if (!replaced.includes(slug)) {
      created.push(slug);
    }
  }

  if (created.length === 0 && deleted.length === 0 && replaced.length === 0) {
    return { kind: "noop" };
  }
  return { kind: "applied", created, deleted, replaced };
}

// Tear down all subscriptions for an app at uninstall.
export async function teardownAppTriggers(params: {
  appId: string;
  db: Database.Database;
  connectedAccountId: string;
  composio: ComposioService;
}): Promise<{ deleted: string[] }> {
  const { appId, db, connectedAccountId, composio } = params;
  db.exec(TABLE_DDL);
  const rows = db
    .prepare<unknown[], SubscriptionRow>(
      `SELECT trigger_slug, composio_trigger_id, handler_path, config_sha
       FROM _app_trigger_subscriptions WHERE app_id = ?`
    )
    .all(appId);
  const deleted: string[] = [];
  for (const row of rows) {
    await deleteComposioTrigger(composio, connectedAccountId, row.composio_trigger_id);
    deleted.push(row.trigger_slug);
  }
  db.prepare(`DELETE FROM _app_trigger_subscriptions WHERE app_id = ?`).run(appId);
  return { deleted };
}

async function createComposioTrigger(params: {
  composio: ComposioService;
  connectedAccountId: string;
  userId: string;
  handler: TriggerHandlerSpec;
}): Promise<string> {
  const resp = await params.composio.proxyRequest<{
    trigger_id?: string;
    id?: string;
  }>({
    connectedAccountId: params.connectedAccountId,
    method: "POST",
    endpoint: "/api/v3/triggers",
    body: {
      slug: params.handler.slug,
      user_id: params.userId,
      trigger_config: params.handler.config,
    },
  });
  const triggerId = resp.data?.trigger_id ?? resp.data?.id;
  if (!triggerId) {
    throw new Error(
      `Composio triggers.create returned no trigger_id for slug=${params.handler.slug}`
    );
  }
  return triggerId;
}

async function deleteComposioTrigger(
  composio: ComposioService,
  connectedAccountId: string,
  triggerId: string
): Promise<void> {
  await composio.proxyRequest({
    connectedAccountId,
    method: "DELETE",
    endpoint: `/api/v3/triggers/${triggerId}`,
  });
}
