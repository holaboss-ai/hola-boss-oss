import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { FileRuntimeConfigService, runtimeConfigHeaders } from "./runtime-config.js";

const tempDirs: string[] = [];
const envNames = [
  "HB_SANDBOX_ROOT",
  "HOLABOSS_RUNTIME_CONFIG_PATH",
  "HOLABOSS_SANDBOX_AUTH_TOKEN",
  "HOLABOSS_USER_ID",
  "HOLABOSS_MODEL_PROXY_BASE_URL",
  "HOLABOSS_DEFAULT_MODEL",
  "SANDBOX_AGENT_HARNESS"
] as const;

const envSnapshot = new Map<string, string | undefined>();

for (const name of envNames) {
  envSnapshot.set(name, process.env[name]);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const name of envNames) {
    const value = envSnapshot.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

test("file runtime config service updates runtime config and writes opencode bootstrap config", async () => {
  const root = makeTempDir("hb-runtime-config-");
  process.env.HB_SANDBOX_ROOT = root;
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = path.join(root, "state", "runtime-config.json");
  process.env.SANDBOX_AGENT_HARNESS = "opencode";

  let ensureCalls = 0;
  const service = new FileRuntimeConfigService({
    ensureSelectedHarnessReady: async () => {
      ensureCalls += 1;
    }
  });

  const updated = await service.updateConfig({
    auth_token: "token-1",
    user_id: "user-1",
    sandbox_id: "sandbox-1",
    model_proxy_base_url: "https://runtime.example/api/v1/model-proxy",
    default_model: "openai/gpt-5.1",
    desktop_browser_enabled: true,
    desktop_browser_url: "http://127.0.0.1:8787/api/v1/browser",
    desktop_browser_auth_token: "browser-token"
  });

  assert.deepEqual(updated, {
    config_path: path.join(root, "state", "runtime-config.json"),
    loaded_from_file: true,
    auth_token_present: true,
    user_id: "user-1",
    sandbox_id: "sandbox-1",
    model_proxy_base_url: "https://runtime.example/api/v1/model-proxy",
    default_model: "openai/gpt-5.1",
    runtime_mode: "oss",
    default_provider: "holaboss_model_proxy",
    holaboss_enabled: true,
    desktop_browser_enabled: true,
    desktop_browser_url: "http://127.0.0.1:8787/api/v1/browser"
  });
  assert.equal(ensureCalls, 0);

  const configDocument = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime-config.json"), "utf8"));
  assert.equal(configDocument.runtime.default_model, "openai/gpt-5.1");
  assert.equal(configDocument.providers.holaboss_model_proxy.base_url, "https://runtime.example/api/v1/model-proxy");
  assert.equal(configDocument.integrations.holaboss.user_id, "user-1");
  assert.equal(configDocument.capabilities.desktop_browser.url, "http://127.0.0.1:8787/api/v1/browser");
  assert.equal(configDocument.capabilities.desktop_browser.auth_token, "browser-token");

  const opencodeDocument = JSON.parse(fs.readFileSync(path.join(root, "workspace", "opencode.json"), "utf8"));
  assert.equal(opencodeDocument.model, "openai/gpt-5.1");
  assert.equal(
    opencodeDocument.provider.openai.options.baseURL,
    "https://runtime.example/api/v1/model-proxy/openai/v1"
  );
});

test("file runtime config service returns harness and browser readiness state", async () => {
  const root = makeTempDir("hb-runtime-config-");
  process.env.HB_SANDBOX_ROOT = root;
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = path.join(root, "state", "runtime-config.json");
  process.env.SANDBOX_AGENT_HARNESS = "opencode";

  fs.mkdirSync(path.join(root, "state"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "state", "runtime-config.json"),
    `${JSON.stringify({
      runtime: {
        default_model: "openai/gpt-5.1",
        sandbox_id: "sandbox-1",
        default_provider: "holaboss_model_proxy"
      },
      providers: {
        holaboss_model_proxy: {
          kind: "openai_compatible",
          base_url: "https://runtime.example/api/v1/model-proxy",
          api_key: "token-1"
        }
      },
      integrations: {
        holaboss: {
          enabled: true,
          sandbox_id: "sandbox-1",
          user_id: "user-1",
          auth_token: "token-1"
        }
      },
      capabilities: {
        desktop_browser: {
          enabled: true,
          url: "http://127.0.0.1:8787/api/v1/browser"
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );
  fs.mkdirSync(path.join(root, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(root, "workspace", "opencode.json"), "{}\n", "utf8");

  const service = new FileRuntimeConfigService({
    fetchImpl: async () =>
      new Response("", {
        status: 200
      })
  });

  const status = await service.getStatus();

  assert.deepEqual(status, {
    harness: "opencode",
    config_loaded: true,
    config_path: path.join(root, "state", "runtime-config.json"),
    backend_config_present: true,
    opencode_config_present: true,
    harness_ready: true,
    harness_state: "ready",
    browser_available: true,
    browser_state: "available",
    browser_url: "http://127.0.0.1:8787/api/v1/browser"
  });
});

test("file runtime config service treats pi harness as ready without opencode bootstrap", async () => {
  const root = makeTempDir("hb-runtime-config-");
  process.env.HB_SANDBOX_ROOT = root;
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = path.join(root, "state", "runtime-config.json");
  process.env.SANDBOX_AGENT_HARNESS = "pi";

  fs.mkdirSync(path.join(root, "state"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "state", "runtime-config.json"),
    `${JSON.stringify({
      runtime: {
        default_model: "openai/gpt-5.1",
        sandbox_id: "sandbox-1",
        default_provider: "holaboss_model_proxy"
      },
      providers: {
        holaboss_model_proxy: {
          kind: "openai_compatible",
          base_url: "https://runtime.example/api/v1/model-proxy",
          api_key: "token-1"
        }
      },
      integrations: {
        holaboss: {
          enabled: true,
          sandbox_id: "sandbox-1",
          user_id: "user-1",
          auth_token: "token-1"
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );
  fs.mkdirSync(path.join(root, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(root, "workspace", "opencode.json"), "{}\n", "utf8");

  const service = new FileRuntimeConfigService();
  const status = await service.getStatus();

  assert.deepEqual(status, {
    harness: "pi",
    config_loaded: true,
    config_path: path.join(root, "state", "runtime-config.json"),
    backend_config_present: false,
    opencode_config_present: false,
    harness_ready: true,
    harness_state: "ready",
    browser_available: false,
    browser_state: "unavailable",
    browser_url: null
  });
});

test("runtime config headers reuse the shared runtime config parser", () => {
  const root = makeTempDir("hb-runtime-config-");
  process.env.HB_SANDBOX_ROOT = root;
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = path.join(root, "state", "runtime-config.json");

  fs.mkdirSync(path.join(root, "state"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "state", "runtime-config.json"),
    `${JSON.stringify({
      runtime: {
        sandbox_id: "sandbox-1"
      },
      providers: {
        holaboss_model_proxy: {
          api_key: "token-1"
        }
      },
      integrations: {
        holaboss: {
          user_id: "user-1"
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );

  assert.deepEqual(runtimeConfigHeaders({ requireAuth: true, requireUser: false }), {
    "X-API-Key": "token-1",
    "X-Holaboss-User-Id": "user-1",
    "X-Holaboss-Sandbox-Id": "sandbox-1"
  });
});
