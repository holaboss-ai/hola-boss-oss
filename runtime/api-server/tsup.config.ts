import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/hb.ts",
    "src/index.ts",
    "src/app.ts",
    "src/opencode-app-bootstrap.ts",
    "src/opencode-commands.ts",
    "src/opencode-config.ts",
    "src/runtime-config-cli.ts",
    "src/workspace-runtime-plan.ts",
    "src/opencode-runtime-config.ts",
    "src/opencode-skills.ts",
    "src/workspace-mcp-host.ts",
    "src/workspace-mcp-sidecar.ts",
    "src/opencode-sidecar.ts"
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
