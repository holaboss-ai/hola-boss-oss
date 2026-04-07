import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("desktop runtime binding exchange wraps network failures with the exchange URL", async () => {
  const source = await readFile(mainSourcePath, "utf8");
  const exchangeFunction =
    source.match(
      /async function exchangeDesktopRuntimeBinding\([\s\S]*?\n}\n\nfunction emitAuthAuthenticated/,
    )?.[0] ?? "";

  assert.match(
    exchangeFunction,
    /const exchangeUrl = `\$\{controlPlaneBaseUrl\}\$\{DESKTOP_RUNTIME_BINDING_EXCHANGE_PATH\}`;/,
  );
  assert.match(
    exchangeFunction,
    /catch \(error\) \{\s*throw new Error\(\s*`Runtime binding exchange request failed for \$\{exchangeUrl\}: \$\{error instanceof Error \? error\.message : String\(error\)\}`/,
  );
});

test("desktop runtime consumes the authoritative model catalog from exchange and the dedicated catalog endpoint", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(
    source,
    /const DESKTOP_RUNTIME_MODEL_CATALOG_PATH =\s*"\/api\/v1\/desktop-runtime\/model-catalog";/,
  );
  assert.match(
    source,
    /interface RuntimeBindingExchangePayload \{[\s\S]*catalog_version\?: string;[\s\S]*provider_model_groups\?: RuntimeProviderModelGroupPayload\[];/,
  );
  assert.match(
    source,
    /async function fetchDesktopRuntimeModelCatalog\(\): Promise<RuntimeModelCatalogResponsePayload>/,
  );
  assert.match(source, /async function syncRuntimeModelCatalogFromBinding\(/);
  assert.match(source, /await syncRuntimeModelCatalogFromBinding\(binding\);/);
});
