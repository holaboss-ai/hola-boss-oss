import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  release: process.env.HOLABOSS_RUNTIME_VERSION,
  environment: process.env.SENTRY_ENVIRONMENT ?? "production",
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
      delete event.request.headers["x-api-key"];
    }
    return event;
  },
});

import { buildRuntimeApiServer } from "./app.js";

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

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

await main();
