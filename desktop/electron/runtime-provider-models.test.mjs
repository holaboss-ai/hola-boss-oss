import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("desktop runtime excludes claude models from holaboss proxy seed catalogs", async () => {
  const source = await readFile(mainSourcePath, "utf8");
  const legacyModelsBlock =
    source.match(/const RUNTIME_HOLABOSS_LEGACY_PROXY_MODELS = \[[\s\S]*?\] as const;/)?.[0] ?? "";

  assert.match(legacyModelsBlock, /"gpt-5\.4"/);
  assert.match(legacyModelsBlock, /"gpt-5\.4-mini"/);
  assert.match(legacyModelsBlock, /"gpt-5\.3-codex"/);
  assert.doesNotMatch(legacyModelsBlock, /claude-/);
  assert.match(source, /function isClaudeRuntimeModelId\(modelId: string\): boolean/);
  assert.match(
    source,
    /isUnsupportedHolabossRuntimeModel\(\s*normalizedProviderId,\s*normalizedModelId,\s*\)/,
  );
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
