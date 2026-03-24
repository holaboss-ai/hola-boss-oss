import { buildRuntimeApiServer } from "./app.js";

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.SANDBOX_RUNTIME_API_PORT ?? process.env.PORT ?? "3060", 10);
  const host = (process.env.SANDBOX_RUNTIME_API_HOST ?? "0.0.0.0").trim() || "0.0.0.0";
  const app = buildRuntimeApiServer({ logger: true });

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

await main();
