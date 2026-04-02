import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "ChatPane.tsx");

test("chat pane shows provider setup CTA when no chat models are available", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(source, /Sign in or set a runtime user id first\./);
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
  assert.doesNotMatch(source, /if \(!resolvedUserId\) \{/);
});

test("chat pane exposes a return path from sub-sessions back to the main session", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const showMainSessionReturn =[\s\S]*activeSessionId !== mainSessionId;/);
  assert.match(source, /You are viewing a separate run session\. Return to the main workspace chat to continue there\./);
  assert.match(source, /Back to main session/);
  assert.match(source, /await loadSessionConversation\(mainSessionId, selectedWorkspaceId, runtimeStates\.items\);/);
  assert.match(source, /const targetSessionId = activeSessionIdRef\.current \|\| preferredSessionId\(selectedWorkspace, \[\]\);/);
});

test("chat pane shows hosted billing warnings and blocks managed sends when credits are exhausted", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /useDesktopBilling/);
  assert.match(source, /selectedManagedProviderGroup\?\.kind === "holaboss_proxy"/);
  assert.match(source, /hasHostedBillingAccount/);
  assert.match(source, /Credits are running low\. Add more on web to avoid interruptions\./);
  assert.match(source, /You're out of credits for managed usage\./);
  assert.match(source, /Add credits/);
  assert.match(source, /Manage on web/);
  assert.match(source, /if \(isOutOfCredits\) \{/);
  assert.match(source, /void refreshBillingState\(\)\.catch\(\(\) => undefined\);/);
  assert.doesNotMatch(source, /await window\.electronAPI\.billing\.getOverview\(\)/);
});

test("chat composer does not submit on enter while IME composition is active", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const composerIsComposingRef = useRef\(false\);/);
  assert.match(
    source,
    /if \(\s*composerIsComposingRef\.current \|\|[\s\S]*nativeEvent\.isComposing === true \|\|[\s\S]*nativeEvent\.keyCode === 229[\s\S]*\) \{\s*return;\s*\}/,
  );
  assert.match(source, /const onComposerCompositionStart = \([\s\S]*composerIsComposingRef\.current = true;/);
  assert.match(source, /const onComposerCompositionEnd = \([\s\S]*composerIsComposingRef\.current = false;/);
  assert.match(source, /<Composer[\s\S]*onCompositionStart=\{onComposerCompositionStart\}[\s\S]*onCompositionEnd=\{onComposerCompositionEnd\}/);
  assert.match(source, /<textarea[\s\S]*onCompositionStart=\{onCompositionStart\}[\s\S]*onCompositionEnd=\{onCompositionEnd\}/);
});

test("chat turns render markdown and keep long content wrapped inside the bubble", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /import \{ SimpleMarkdown \} from "@\/components\/marketplace\/SimpleMarkdown";/);
  assert.match(source, /<SimpleMarkdown className="chat-markdown chat-user-markdown max-w-full">[\s\S]*\{text\}[\s\S]*<\/SimpleMarkdown>/);
  assert.match(source, /<SimpleMarkdown className="chat-markdown chat-assistant-markdown mt-4 max-w-full text-foreground">[\s\S]*\{text\}[\s\S]*<\/SimpleMarkdown>/);
  assert.match(source, /theme-chat-user-bubble inline-flex min-w-0 max-w-full/);
});
