import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { RUNTIME_AGENT_TOOL_IDS } from "../../harnesses/src/runtime-agent-tools.js";
import { stageOpencodeRuntimeToolsPlugin } from "./opencode-runtime-tools.js";

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

test("stageOpencodeRuntimeToolsPlugin writes the runtime tools plugin and package dependency", () => {
  const workspaceDir = makeTempDir("hb-opencode-runtime-tools-");

  const result = stageOpencodeRuntimeToolsPlugin({
    workspace_dir: workspaceDir
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.tool_ids, [...RUNTIME_AGENT_TOOL_IDS]);

  const pluginPath = path.join(workspaceDir, ".opencode", "plugins", "holaboss-runtime-tools.js");
  const packageJsonPath = path.join(workspaceDir, ".opencode", "package.json");
  const pluginSource = fs.readFileSync(pluginPath, "utf8");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  assert.match(pluginSource, /SANDBOX_RUNTIME_API_URL/);
  assert.match(pluginSource, /HOLABOSS_WORKSPACE_ID/);
  assert.match(pluginSource, /holaboss_onboarding_complete/);
  assert.match(pluginSource, /holaboss_cronjobs_create/);
  assert.match(pluginSource, /metadata_json/);
  assert.equal(packageJson.dependencies["@opencode-ai/plugin"], "^1.3.2");
});
