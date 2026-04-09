import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  createImageGenerationModelClient,
  resolveImageGenerationModelSelection,
} from "./image-generation-model.js";

const tempDirs: string[] = [];
const ORIGINAL_ENV = {
  HB_SANDBOX_ROOT: process.env.HB_SANDBOX_ROOT,
  HOLABOSS_RUNTIME_CONFIG_PATH: process.env.HOLABOSS_RUNTIME_CONFIG_PATH,
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (ORIGINAL_ENV.HB_SANDBOX_ROOT === undefined) {
    delete process.env.HB_SANDBOX_ROOT;
  } else {
    process.env.HB_SANDBOX_ROOT = ORIGINAL_ENV.HB_SANDBOX_ROOT;
  }
  if (ORIGINAL_ENV.HOLABOSS_RUNTIME_CONFIG_PATH === undefined) {
    delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  } else {
    process.env.HOLABOSS_RUNTIME_CONFIG_PATH = ORIGINAL_ENV.HOLABOSS_RUNTIME_CONFIG_PATH;
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeRuntimeConfig(root: string, document: Record<string, unknown>): void {
  const configPath = path.join(root, "state", "runtime-config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.env.HB_SANDBOX_ROOT = root;
  process.env.HOLABOSS_RUNTIME_CONFIG_PATH = configPath;
}

test("image generation model selection prefers explicit runtime.image_generation settings", () => {
  const root = makeTempDir("hb-image-model-selection-");
  writeRuntimeConfig(root, {
    runtime: {
      image_generation: {
        provider: "openai_direct",
        model: "gpt-image-1.5",
      },
    },
    providers: {
      openai_direct: {
        kind: "openai_compatible",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-openai",
      },
    },
  });

  const selection = resolveImageGenerationModelSelection({
    selectedModel: "openai_direct/gpt-5.4",
    defaultProviderId: "openai_direct",
  });

  assert.deepEqual(selection, {
    providerId: "openai_direct",
    modelId: "gpt-image-1.5",
    source: "configured",
  });
});

test("image generation model selection disables explicit provider without a model", () => {
  const root = makeTempDir("hb-image-model-disabled-");
  writeRuntimeConfig(root, {
    runtime: {
      image_generation: {
        provider: "gemini_direct",
        model: null,
      },
    },
    providers: {
      gemini_direct: {
        kind: "openai_compatible",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        api_key: "gemini-key",
      },
    },
  });

  const selection = resolveImageGenerationModelSelection({
    selectedModel: "gemini_direct/gemini-2.5-pro",
    defaultProviderId: "gemini_direct",
  });

  assert.deepEqual(selection, {
    providerId: "gemini_direct",
    modelId: null,
    source: "disabled",
  });
});

test("image generation model selection falls back to legacy provider image model fields", () => {
  const root = makeTempDir("hb-image-model-legacy-");
  writeRuntimeConfig(root, {
    runtime: {
      default_provider: "openai_direct",
      default_model: "openai_direct/gpt-5.4",
    },
    providers: {
      openai_direct: {
        kind: "openai_compatible",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-openai",
        image_model: "gpt-image-1.5",
      },
    },
  });

  const selection = resolveImageGenerationModelSelection({
    selectedModel: "openai_direct/gpt-5.4",
    defaultProviderId: "openai_direct",
  });

  assert.deepEqual(selection, {
    providerId: "openai_direct",
    modelId: "gpt-image-1.5",
    source: "configured",
  });
});

test("image generation model client resolves Gemini direct providers with native Google image calls", () => {
  const root = makeTempDir("hb-image-model-gemini-");
  writeRuntimeConfig(root, {
    runtime: {
      image_generation: {
        provider: "gemini_direct",
        model: "imagen-4.0-generate-001",
      },
    },
    providers: {
      gemini_direct: {
        kind: "openai_compatible",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        api_key: "gemini-key",
      },
    },
  });

  const client = createImageGenerationModelClient({
    workspaceId: "workspace-1",
    sessionId: "session-1",
    inputId: "input-1",
    selectedModel: "gemini_direct/gemini-2.5-pro",
    defaultProviderId: "gemini_direct",
  });

  assert.deepEqual(client, {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "gemini-key",
    defaultHeaders: null,
    modelId: "gemini-3.1-flash-image-preview",
    apiStyle: "google_native",
  });
});

test("image generation model client resolves OpenRouter image providers with OpenRouter chat image calls", () => {
  const root = makeTempDir("hb-image-model-openrouter-");
  writeRuntimeConfig(root, {
    runtime: {
      image_generation: {
        provider: "openrouter_direct",
        model: "google/gemini-3.1-flash-image-preview",
      },
    },
    providers: {
      openrouter_direct: {
        kind: "openrouter",
        base_url: "https://openrouter.ai/api/v1",
        api_key: "sk-or-test",
      },
    },
  });

  const client = createImageGenerationModelClient({
    workspaceId: "workspace-1",
    sessionId: "session-1",
    inputId: "input-1",
    selectedModel: "openrouter_direct/openai/gpt-5.4",
    defaultProviderId: "openrouter_direct",
  });

  assert.deepEqual(client, {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "sk-or-test",
    defaultHeaders: null,
    modelId: "google/gemini-3.1-flash-image-preview",
    apiStyle: "openrouter_image",
  });
});

test("image generation model client routes managed Holaboss Gemini image models to the Google proxy path", () => {
  const root = makeTempDir("hb-image-model-holaboss-google-");
  writeRuntimeConfig(root, {
    runtime: {
      image_generation: {
        provider: "holaboss_model_proxy",
        model: "gemini-2.5-flash-image",
      },
    },
    providers: {
      holaboss_model_proxy: {
        kind: "holaboss_proxy",
        base_url: "https://runtime.example/api/v1/model-proxy",
        api_key: "hb-token",
      },
    },
  });

  const client = createImageGenerationModelClient({
    workspaceId: "workspace-1",
    sessionId: "session-1",
    inputId: "input-1",
    selectedModel: "holaboss_model_proxy/gpt-5.4",
    defaultProviderId: "holaboss_model_proxy",
  });

  assert.deepEqual(client, {
    baseUrl: "https://runtime.example/api/v1/model-proxy/google/v1",
    apiKey: "hb-token",
    defaultHeaders: null,
    modelId: "gemini-2.5-flash-image",
    apiStyle: "openai_compatible",
  });
});
