import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  buildOpencodeProviderConfigPayload,
  runOpencodeConfigCli,
  updateOpencodeConfig
} from "./opencode-config.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempWorkspaceRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function makeRequest(workspaceRoot: string) {
  return {
    workspace_root: workspaceRoot,
    provider_id: "hb_openai",
    model_id: "gpt-5.4",
    model_client: {
      model_proxy_provider: "openai_compatible",
      api_key: "hbrt.v1.proxy-user-key",
      base_url: "http://sandbox-runtime:3060/api/v1/model-proxy/openai/v1",
      default_headers: {
        "X-API-Key": "hbrt.v1.proxy-user-key",
        "X-Holaboss-Sandbox-Id": "sandbox-1",
        "X-Holaboss-Run-Id": "run-ctx-1"
      }
    }
  } as const;
}

test("buildOpencodeProviderConfigPayload preserves only allowlisted headers", () => {
  const payload = buildOpencodeProviderConfigPayload("hb_openai", "gpt-5.4", {
    model_proxy_provider: "openai_compatible",
    api_key: "hbrt.v1.proxy-user-key",
    base_url: "http://sandbox-runtime:3060/api/v1/model-proxy/openai/v1",
    default_headers: {
      "X-API-Key": "hbrt.v1.proxy-user-key",
      "X-Holaboss-Sandbox-Id": "sandbox-1",
      "X-Holaboss-Run-Id": "run-ctx-1"
    }
  });

  const provider = (payload.provider as Record<string, unknown>).hb_openai as Record<string, unknown>;
  assert.equal(provider.npm, "@ai-sdk/openai");
  const options = provider.options as Record<string, unknown>;
  const headers = options.headers as Record<string, string>;
  assert.equal(headers["X-API-Key"], "hbrt.v1.proxy-user-key");
  assert.equal(headers["X-Holaboss-Sandbox-Id"], "sandbox-1");
  assert.equal("X-Holaboss-Run-Id" in headers, false);
});

test("updateOpencodeConfig writes provider config and model selection", () => {
  const workspaceRoot = makeTempWorkspaceRoot("hb-opencode-config-");
  const result = updateOpencodeConfig(makeRequest(workspaceRoot));

  assert.equal(result.provider_config_changed, true);
  assert.equal(result.model_selection_changed, false);
  const payload = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "opencode.json"), "utf8"));
  assert.equal(payload.model, "hb_openai/gpt-5.4");
  assert.equal(payload.provider.hb_openai.npm, "@ai-sdk/openai");
  assert.equal(payload.provider.hb_openai.options.baseURL, "http://sandbox-runtime:3060/api/v1/model-proxy/openai/v1");
});

test("updateOpencodeConfig rewrites provider config when the stored top-level model drifts", () => {
  const workspaceRoot = makeTempWorkspaceRoot("hb-opencode-config-model-");
  const initialRequest = makeRequest(workspaceRoot);
  updateOpencodeConfig(initialRequest);
  const existing = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "opencode.json"), "utf8"));
  existing.model = "hb_openai/gpt-5.0";
  fs.writeFileSync(path.join(workspaceRoot, "opencode.json"), JSON.stringify(existing, null, 2), "utf8");

  const result = updateOpencodeConfig(initialRequest);

  assert.equal(result.provider_config_changed, true);
  assert.equal(result.model_selection_changed, false);
  const payload = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "opencode.json"), "utf8"));
  assert.equal(payload.model, "hb_openai/gpt-5.4");
});

test("buildOpencodeProviderConfigPayload keeps non-OpenAI-compatible providers on openai-compatible sdk", () => {
  const payload = buildOpencodeProviderConfigPayload("openrouter_direct", "openai/gpt-5.4", {
    model_proxy_provider: "openai_compatible",
    api_key: "sk-or-test",
    base_url: "https://openrouter.ai/api/v1",
    default_headers: {
      "X-API-Key": "sk-or-test"
    }
  });

  const provider = (payload.provider as Record<string, unknown>).openrouter_direct as Record<string, unknown>;
  assert.equal(provider.npm, "@ai-sdk/openai-compatible");
});

test("runOpencodeConfigCli writes JSON response for a valid request", async () => {
  const request = makeRequest(makeTempWorkspaceRoot("hb-opencode-config-cli-"));
  let stdout = "";
  let stderr = "";
  const exitCode = await runOpencodeConfigCli(
    ["--request-base64", Buffer.from(JSON.stringify(request), "utf8").toString("base64")],
    {
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
      },
      updateConfig: (parsed) => {
        assert.deepEqual(parsed, request);
        return {
          path: path.join(request.workspace_root, "opencode.json"),
          provider_config_changed: true,
          model_selection_changed: false
        };
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    path: path.join(request.workspace_root, "opencode.json"),
    provider_config_changed: true,
    model_selection_changed: false
  });
});

test("runOpencodeConfigCli returns exit code 2 when request is missing", async () => {
  let stdout = "";
  let stderr = "";

  const exitCode = await runOpencodeConfigCli([], {
    io: {
      stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
      stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
    }
  });

  assert.equal(exitCode, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /request_base64 is required/);
});

test("runOpencodeConfigCli returns exit code 1 for invalid payload", async () => {
  let stdout = "";
  let stderr = "";

  const exitCode = await runOpencodeConfigCli(
    ["--request-base64", Buffer.from("[]", "utf8").toString("base64")],
    {
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /request payload must be an object/);
});
