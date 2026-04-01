import { defineConfig } from "tsup";

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
  outExtension() {
    return {
      js: ".mjs"
    };
  }
});
