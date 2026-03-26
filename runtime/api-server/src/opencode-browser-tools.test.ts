import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { stageOpencodeDesktopBrowserPlugin } from "./opencode-browser-tools.js";

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

test("stageOpencodeDesktopBrowserPlugin writes the project plugin and package dependency", () => {
  const workspaceDir = makeTempDir("hb-opencode-browser-plugin-");

  const result = stageOpencodeDesktopBrowserPlugin(
    { workspace_dir: workspaceDir },
    {
      resolveConfig: () => ({
        authToken: "",
        userId: "",
        sandboxId: "",
        modelProxyBaseUrl: "",
        defaultModel: "openai/gpt-5.1",
        runtimeMode: "oss",
        defaultProvider: "",
        holabossEnabled: false,
        desktopBrowserEnabled: true,
        desktopBrowserUrl: "http://127.0.0.1:8787/api/v1/browser",
        desktopBrowserAuthToken: "browser-token",
        configPath: "/tmp/runtime-config.json",
        loadedFromFile: true
      })
    }
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.tool_ids, [
    "browser_navigate",
    "browser_get_state",
    "browser_click",
    "browser_type",
    "browser_press",
    "browser_scroll",
    "browser_back",
    "browser_forward",
    "browser_reload",
    "browser_screenshot",
    "browser_list_tabs"
  ]);

  const pluginPath = path.join(workspaceDir, ".opencode", "plugins", "holaboss-desktop-browser.js");
  const packageJsonPath = path.join(workspaceDir, ".opencode", "package.json");
  const pluginSource = fs.readFileSync(pluginPath, "utf8");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  assert.match(pluginSource, /SANDBOX_RUNTIME_API_URL/);
  assert.match(pluginSource, /browser_get_state/);
  assert.match(pluginSource, /JSON\.stringify\(payload, null, 2\)/);
  assert.equal(packageJson.dependencies["@opencode-ai/plugin"], "^1.3.2");
});

test("stageOpencodeDesktopBrowserPlugin removes the staged plugin when browser tools are unavailable", () => {
  const workspaceDir = makeTempDir("hb-opencode-browser-plugin-remove-");
  const pluginPath = path.join(workspaceDir, ".opencode", "plugins", "holaboss-desktop-browser.js");
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(pluginPath, "stale", "utf8");

  const result = stageOpencodeDesktopBrowserPlugin(
    { workspace_dir: workspaceDir },
    {
      resolveConfig: () => ({
        authToken: "",
        userId: "",
        sandboxId: "",
        modelProxyBaseUrl: "",
        defaultModel: "openai/gpt-5.1",
        runtimeMode: "oss",
        defaultProvider: "",
        holabossEnabled: false,
        desktopBrowserEnabled: false,
        desktopBrowserUrl: "",
        desktopBrowserAuthToken: "",
        configPath: "/tmp/runtime-config.json",
        loadedFromFile: true
      })
    }
  );

  assert.deepEqual(result, {
    changed: true,
    tool_ids: []
  });
  assert.equal(fs.existsSync(pluginPath), false);
});
