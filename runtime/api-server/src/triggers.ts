import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RuntimeStateStore } from "@holaboss/runtime-state-store";
import {
  parseTriggersManifest,
  type TriggerHandlerSpec,
} from "./data-schema-triggers.js";
import {
  listWorkspaceApplications,
  portsForWorkspaceApp,
  resolveWorkspaceAppRuntime,
} from "./workspace-apps.js";

type IncomingBody = {
  trigger_slug: string;
  trigger_id: string;
  data: unknown;
  received_at?: string;
};

type RouteDeps = {
  workspaceRoot: string;
  runtimeStateStore?: RuntimeStateStore | null;
};

// POST /api/v1/triggers/incoming — backend session-worker calls this
// after claiming a trigger_event from the queue. We resolve which app
// declared the slug, look up its allocated HTTP port, and POST the
// payload at the module's declared handler path.
export function registerTriggerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post("/api/v1/triggers/incoming", async (request, reply) => {
    return handleIncoming(request, reply, deps);
  });
}

async function handleIncoming(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: RouteDeps
): Promise<unknown> {
  const body = request.body as IncomingBody | undefined;
  if (!body || typeof body.trigger_slug !== "string" || typeof body.trigger_id !== "string") {
    return reply.code(400).send({ error: "request body requires trigger_slug + trigger_id" });
  }

  const workspaceId = extractWorkspaceId(request);
  if (!workspaceId) {
    return reply.code(400).send({ error: "missing workspace context" });
  }

  const workspaceDir = path.join(deps.workspaceRoot, workspaceId);
  const apps = listWorkspaceApplications(workspaceDir);
  let matched: { appId: string; index: number; handler: TriggerHandlerSpec } | null = null;
  for (let i = 0; i < apps.length; i += 1) {
    const entry = apps[i];
    const appId = typeof entry?.app_id === "string" ? entry.app_id : null;
    if (!appId) {
      continue;
    }
    let resolved;
    try {
      resolved = resolveWorkspaceAppRuntime(workspaceDir, appId, {
        store: deps.runtimeStateStore ?? null,
        workspaceId,
      });
    } catch {
      continue;
    }
    const triggersRaw = resolved.resolvedApp.triggersRaw;
    if (!triggersRaw) {
      continue;
    }
    const manifest = parseTriggersManifest(triggersRaw);
    const handler = manifest.handlers.find((h: TriggerHandlerSpec) => h.slug === body.trigger_slug);
    if (handler) {
      matched = { appId: resolved.resolvedApp.appId, index: i, handler };
      break;
    }
  }

  if (!matched) {
    // Uninstall race: dispatched event arrived after the app was removed
    // (or before it installed). Drop with 200 so the worker doesn't retry.
    request.log.info(
      { trigger_slug: body.trigger_slug, trigger_id: body.trigger_id, workspace_id: workspaceId },
      "trigger.incoming.no_handler"
    );
    return reply.code(200).send({ accepted: false, reason: "no_handler" });
  }

  const ports = portsForWorkspaceApp({
    appId: matched.appId,
    fallbackIndex: matched.index,
    store: deps.runtimeStateStore ?? null,
    workspaceId,
  });

  const url = `http://127.0.0.1:${ports.http}${matched.handler.handlerPath}`;
  let upstreamStatus = 0;
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trigger_slug: body.trigger_slug,
        trigger_id: body.trigger_id,
        received_at: body.received_at ?? new Date().toISOString(),
        data: body.data ?? {},
      }),
    });
    upstreamStatus = upstream.status;
    if (upstream.status >= 500) {
      return reply.code(503).send({ error: "handler returned 5xx", upstream_status: upstream.status });
    }
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return reply
        .code(upstream.status)
        .send({ error: "handler returned 4xx", upstream_status: upstream.status, body: text.slice(0, 200) });
    }
  } catch (err) {
    request.log.warn({ err, url }, "trigger.incoming.handler_unreachable");
    return reply.code(503).send({ error: "handler unreachable" });
  }

  request.log.info(
    {
      trigger_slug: body.trigger_slug,
      trigger_id: body.trigger_id,
      app_id: matched.appId,
      upstream_status: upstreamStatus,
    },
    "trigger.incoming.dispatched"
  );
  return reply.code(200).send({ accepted: true, app_id: matched.appId });
}

function extractWorkspaceId(request: FastifyRequest): string | null {
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const fromHeader = headers["x-holaboss-workspace-id"];
  if (typeof fromHeader === "string" && fromHeader.length > 0) {
    return fromHeader;
  }
  const body = request.body as Record<string, unknown> | undefined;
  if (body && typeof body.workspace_id === "string" && body.workspace_id.length > 0) {
    return body.workspace_id;
  }
  return null;
}
