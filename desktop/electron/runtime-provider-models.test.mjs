import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("desktop runtime uses the managed holaboss catalog instead of local seed catalogs", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /function normalizeRuntimeProviderModelGroups\(/);
  assert.match(source, /mergeManagedCatalog\(managedCatalogGroups\);/);
  assert.match(source, /function syncRuntimeModelCatalogFromBinding\(/);
  assert.match(source, /function isClaudeRuntimeModelId\(modelId: string\): boolean/);
  assert.match(
    source,
    /isUnsupportedHolabossRuntimeModel\(\s*normalizedProviderId,\s*normalizedModelId,\s*\)/,
  );
  assert.doesNotMatch(source, /seedLegacyHolabossProxyModels/);
  assert.doesNotMatch(source, /RUNTIME_HOLABOSS_LEGACY_PROXY_MODELS/);
});

test("desktop runtime normalizes stale direct-provider model aliases for Anthropic and Gemini", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /const RUNTIME_LEGACY_DIRECT_PROVIDER_MODEL_ALIASES: Record<string, Record<string, string>> = \{/);
  assert.match(source, /anthropic_direct:\s*\{[\s\S]*"claude-sonnet-4-5": "claude-sonnet-4-6"/);
  assert.match(source, /gemini_direct:\s*\{[\s\S]*"gemini-3.1-pro-preview": "gemini-2.5-pro"/);
  assert.match(source, /function normalizeRuntimeProviderModelId\(/);
});

test("desktop runtime recognizes minimax provider label and strips minimax token prefix", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /normalized\.includes\("minimax"\)[\s\S]*?return "MiniMax"/);
  assert.match(source, /normalizedPrefix\.includes\("minimax"\)/);
});
