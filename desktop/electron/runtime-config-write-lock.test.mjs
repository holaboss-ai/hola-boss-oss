import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("desktop runtime config mutations are serialized and written atomically", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(
    source,
    /let runtimeConfigMutationPromise: Promise<void> \| null = null;/,
  );
  assert.match(
    source,
    /async function withRuntimeConfigMutationLock<T>\(\s*work: \(\) => Promise<T>,\s*\): Promise<T> \{/,
  );
  assert.match(
    source,
    /while \(runtimeConfigMutationPromise\) \{\s*await runtimeConfigMutationPromise;\s*\}/,
  );
  assert.match(
    source,
    /async function writeRuntimeConfigTextAtomically\(nextText: string\): Promise<void> \{/,
  );
  assert.match(
    source,
    /const tempPath = `\$\{configPath\}\.\$\{process\.pid\}\.\$\{Date\.now\(\)\}\.tmp`;/,
  );
  assert.match(
    source,
    /await fs\.writeFile\(tempPath, nextText, "utf-8"\);/,
  );
  assert.match(
    source,
    /await fs\.rename\(tempPath, configPath\);/,
  );
});

test("desktop runtime config writers use the shared mutation lock", async () => {
  const source = await readFile(mainSourcePath, "utf8");
  const writeRuntimeConfigSection =
    source.match(
      /async function writeRuntimeConfigFile\(update: RuntimeConfigUpdatePayload\) \{[\s\S]*?\n}\n\nfunction runtimeConfigField/,
    )?.[0] ?? "";
  const browserCapabilitySection =
    source.match(
      /async function updateDesktopBrowserCapabilityConfig\(update: \{[\s\S]*?\n}\n\nfunction desktopBrowserServiceTokenFromRequest/,
    )?.[0] ?? "";
  const setRuntimeConfigDocumentSection =
    source.match(
      /async function setRuntimeConfigDocument\([\s\S]*?\n}\n\nfunction runtimeUserProfileNameSourceFromApi/,
    )?.[0] ?? "";

  assert.match(
    writeRuntimeConfigSection,
    /return withRuntimeConfigMutationLock\(async \(\) => \{/,
  );
  assert.match(
    writeRuntimeConfigSection,
    /await writeRuntimeConfigTextAtomically\(/,
  );
  assert.match(
    browserCapabilitySection,
    /await withRuntimeConfigMutationLock\(async \(\) => \{/,
  );
  assert.match(
    browserCapabilitySection,
    /await writeRuntimeConfigTextAtomically\(/,
  );
  assert.match(
    setRuntimeConfigDocumentSection,
    /await withRuntimeConfigMutationLock\(async \(\) => \{/,
  );
  assert.match(
    setRuntimeConfigDocumentSection,
    /await writeRuntimeConfigTextAtomically\(nextText\);/,
  );
});
