import { defineConfig } from "tsup";

const sentryEnv = {
  ...(process.env.SENTRY_DSN ? { SENTRY_DSN: process.env.SENTRY_DSN } : {}),
  ...(process.env.SENTRY_ENVIRONMENT
    ? { SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT }
    : {}),
  ...(process.env.HOLABOSS_RUNTIME_VERSION
    ? { HOLABOSS_RUNTIME_VERSION: process.env.HOLABOSS_RUNTIME_VERSION }
    : {}),
};

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/app.ts",
    "src/runtime-config-cli.ts",
    "src/workspace-runtime-plan.ts",
    "src/workspace-mcp-host.ts",
    "src/workspace-mcp-sidecar.ts",
    "src/ts-runner.ts"
  ],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  splitting: false,
  platform: "node",
  target: "node20",
  sourcemap: true,
  dts: true,
  env: sentryEnv,
  outExtension() {
    return {
      js: ".mjs"
    };
  }
});
