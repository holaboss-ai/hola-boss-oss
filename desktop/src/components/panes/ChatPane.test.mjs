import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CHAT_PANE_PATH = new URL("./ChatPane.tsx", import.meta.url);

test("chat model picker keeps holaboss models visible as pending until runtime binding is ready", async () => {
  const source = await readFile(CHAT_PANE_PATH, "utf8");

  assert.match(
    source,
    /pending:\s*isHolabossProviderId\(providerGroup\.providerId\)\s*&&\s*!holabossProxyModelsAvailable/,
  );
  assert.match(source, /disabled: providerGroup\.pending/);
  assert.match(
    source,
    /statusLabel: providerGroup\.pending \? "Pending" : undefined/,
  );
  assert.match(
    source,
    /Holaboss models are finishing setup\. Refresh runtime binding or use another provider\./,
  );
});

test("chat model picker renders pending options without collapsing back to provider setup", async () => {
  const source = await readFile(CHAT_PANE_PATH, "utf8");

  assert.match(source, /const displayLabel =[\s\S]*selectedModelLabel \|\| "Select model"/);
  assert.match(
    source,
    /const noAvailableModels =\s*!runtimeDefaultModelAvailable &&\s*modelOptions\.length === 0 &&\s*modelOptionGroups\.length === 0;/,
  );
  assert.match(source, /disabled=\{optionDisabled\}/);
  assert.match(source, /option\.statusLabel/);
});
