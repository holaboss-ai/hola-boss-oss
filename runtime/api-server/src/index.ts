import * as Sentry from "@sentry/node";
import { setTimeout as sleep } from "node:timers/promises";
import { buildRuntimeSentryDiagnostics } from "./runtime-sentry.js";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  enableLogs: !!process.env.SENTRY_DSN,
  release: process.env.HOLABOSS_RUNTIME_VERSION,
  environment: process.env.SENTRY_ENVIRONMENT ?? "production",
  maxBreadcrumbs: 200,
  integrations: [
    Sentry.pinoIntegration({
      log: {
        levels: ["info", "warn", "error", "fatal"],
      },
      error: {
        levels: ["error", "fatal"],
        handled: true,
      },
    }),
    Sentry.consoleLoggingIntegration({
      levels: ["warn", "error"],
    }),
  ],
  beforeSend(event, hint) {
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
      delete event.request.headers["x-api-key"];
    }
    const diagnostics = buildRuntimeSentryDiagnostics();
    event.contexts = {
      ...(event.contexts ?? {}),
      ...diagnostics.contexts,
    };
    const attachments = diagnostics.attachments.map((attachment) => ({
      filename: attachment.filename,
      data: attachment.data,
      contentType: attachment.contentType,
    }));
    if (hint && attachments.length > 0) {
      hint.attachments = [...(hint.attachments ?? []), ...attachments];
    }
    return event;
  },
});

Sentry.setTags({
  runtime_surface:
    process.env.HOLABOSS_EMBEDDED_RUNTIME === "1"
      ? "desktop_embedded"
      : "standalone",
  runtime_workflow_backend:
    process.env.HOLABOSS_RUNTIME_WORKFLOW_BACKEND ?? "unknown",
});

if (process.env.HOLABOSS_DESKTOP_LAUNCH_ID?.trim()) {
  Sentry.setTag(
    "desktop_launch_id",
    process.env.HOLABOSS_DESKTOP_LAUNCH_ID.trim(),
  );
}

import { buildRuntimeApiServer } from "./app.js";

const SENTRY_FLUSH_TIMEOUT_MS = 2_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;

function signalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 0;
  }
}

async function flushSentry(): Promise<void> {
  try {
    await Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS);
  } catch {
    // Best-effort during process shutdown.
  }
}

async function main(): Promise<void> {
  const port = Number.parseInt(
    process.env.SANDBOX_RUNTIME_API_PORT ??
      process.env.SANDBOX_AGENT_BIND_PORT ??
      process.env.PORT ??
      "3060",
    10,
  );
  const host =
    (
      process.env.SANDBOX_RUNTIME_API_HOST ??
      process.env.SANDBOX_AGENT_BIND_HOST ??
      "0.0.0.0"
    ).trim() || "0.0.0.0";
  const app = buildRuntimeApiServer({ logger: true });
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void (async () => {
      try {
        await Promise.race([
          app.close().catch(() => undefined),
          sleep(SHUTDOWN_TIMEOUT_MS),
        ]);
      } finally {
        await flushSentry();
        process.exit(signalExitCode(signal));
      }
    })();
  };

  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    Sentry.captureException(error);
    await flushSentry();
    process.exit(1);
  }
}

await main();
