import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "ChatPane.tsx");

test("chat pane shows provider setup CTA when no chat models are available", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /No models available\. Configure a provider to start chatting\./);
  assert.match(source, /const requiresModelProviderSetup = !hasConfiguredProviderCatalog && !holabossProxyModelsAvailable;/);
  assert.match(source, /const availableChatModelOptions = hasConfiguredProviderCatalog[\s\S]*: requiresModelProviderSetup[\s\S]*\? \[]/);
  assert.match(source, /onOpenModelProviders=\{\(\) => void window\.electronAPI\.ui\.openSettingsPane\("providers"\)\}/);
  assert.match(source, /aria-label="Configure model providers"/);
  assert.match(source, />Set up providers</);
  assert.match(source, /<Waypoints size=\{13\} className="shrink-0 text-muted-foreground" \/>/);
  assert.match(source, /Open provider settings to connect a model\./);
  assert.match(source, /className=\{noAvailableModels \? "min-w-0 flex flex-1 items-center gap-3" : "w-\[172px\] shrink-0 sm:w-\[208px\]"\}/);
  assert.doesNotMatch(source, /title=\{modelSelectionUnavailableReason\}/);
  assert.doesNotMatch(
    source,
    /disabled=\{isResponding \|\| noAvailableModels\}[\s\S]*<option value=\{CHAT_MODEL_USE_RUNTIME_DEFAULT\}>\{modelSelectionUnavailableReason\}<\/option>/,
  );
});
