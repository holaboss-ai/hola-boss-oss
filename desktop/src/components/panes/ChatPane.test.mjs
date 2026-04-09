import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "ChatPane.tsx");

test("chat model picker hides holaboss models while signed out and only marks them pending after sign-in", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /filter\(\s*\(providerGroup\) =>\s*isSignedIn \|\| !isHolabossProviderId\(providerGroup\.providerId\),?\s*\)/,
  );
  assert.match(
    source,
    /pending:\s*isSignedIn &&\s*isHolabossProviderId\(providerGroup\.providerId\)\s*&&\s*!holabossProxyModelsAvailable/,
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

test("chat model picker still renders pending signed-in holaboss options without collapsing back to provider setup", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const displayLabel =[\s\S]*selectedModelLabel \|\| "Select model"/);
  assert.match(
    source,
    /const noAvailableModels =\s*!runtimeDefaultModelAvailable &&\s*modelOptions\.length === 0 &&\s*modelOptionGroups\.length === 0;/,
  );
  assert.match(source, /disabled=\{optionDisabled\}/);
  assert.match(source, /option\.statusLabel/);
});

test("chat pane shows provider setup CTA when no chat models are available", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(source, /Sign in or set a runtime user id first\./);
  assert.match(source, /No models available\. Configure a provider to start chatting\./);
  assert.match(
    source,
    /const requiresModelProviderSetup =\s*!hasConfiguredProviderCatalog && !holabossProxyModelsAvailable;/,
  );
  assert.match(
    source,
    /const availableChatModelOptions = hasConfiguredProviderCatalog[\s\S]*: requiresModelProviderSetup[\s\S]*\?\s*\[]/,
  );
  assert.match(
    source,
    /onOpenModelProviders=\{\(\) =>[\s\S]*window\.electronAPI\.ui\.openSettingsPane\("providers"\)[\s\S]*\}/,
  );
  assert.match(source, /aria-label="Configure model providers"/);
  assert.match(source, />Set up providers</);
  assert.match(
    source,
    /<Waypoints[\s\S]*size=\{13\}[\s\S]*className="shrink-0 text-muted-foreground"[\s\S]*\/>/,
  );
  assert.match(source, /Open provider settings to connect a model\./);
  assert.match(
    source,
    /className=\{[\s\S]*noAvailableModels[\s\S]*\? "min-w-0 flex flex-1 items-center gap-3"[\s\S]*: "w-\[172px\] shrink-0 sm:w-\[208px\]"[\s\S]*\}/,
  );
  assert.doesNotMatch(source, /title=\{modelSelectionUnavailableReason\}/);
  assert.doesNotMatch(
    source,
    /disabled=\{isResponding \|\| noAvailableModels\}[\s\S]*<option value=\{CHAT_MODEL_USE_RUNTIME_DEFAULT\}>\{modelSelectionUnavailableReason\}<\/option>/,
  );
  assert.doesNotMatch(source, /if \(!resolvedUserId\) \{/);
});

test("chat pane falls back to provider setup instead of holaboss pending state when signed out", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const hasPendingConfiguredProviderCatalog =\s*visibleConfiguredProviderModelGroups\.some\(/,
  );
  assert.match(
    source,
    /const modelSelectionUnavailableReason =[\s\S]*hasPendingConfiguredProviderCatalog[\s\S]*"Holaboss models are finishing setup\. Refresh runtime binding or use another provider\."[\s\S]*"No models available\. Configure a provider to start chatting\."/,
  );
  assert.match(
    source,
    /const requiresModelProviderSetup =\s*!hasConfiguredProviderCatalog && !holabossProxyModelsAvailable;/,
  );
});

test("chat trace summary treats recovered tool errors separately from terminal run failures", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const terminalErrorCount = steps\.filter\(\s*\(step\) => step\.kind === "phase" && step\.status === "error"/,
  );
  assert.match(
    source,
    /const recoveredErrorCount = steps\.filter\(\s*\(step\) => step\.kind === "tool" && step\.status === "error"/,
  );
  assert.match(source, /const groupHasTerminalError = terminalErrorCount > 0;/);
  assert.match(
    source,
    /const summarySuffix = groupHasTerminalError[\s\S]*`\s*\(\$\{recoveredErrorCount\} recovered\)`/,
  );
  assert.match(
    source,
    /groupHasTerminalError[\s\S]*groupIsLive \|\| runningCount > 0[\s\S]*<Check size=\{13\} className="text-emerald-500" \/>/,
  );
});

test("chat trace summary keeps a live run in progress when no active step label is available", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /<TraceStepGroup[\s\S]*live=\{live\}/);
  assert.match(source, /const groupIsLive = live && !groupHasTerminalError;/);
  assert.match(
    source,
    /activeStep[\s\S]*groupIsLive\s*\?\s*`Working through \$\{stepLabel\}\.\.\.`/,
  );
});

test("chat trace collapsed summary surfaces the current active step", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const activeStep =[\s\S]*\.find\(\s*\(step\) => step\.status === "running" \|\| step\.status === "waiting",/,
  );
  assert.match(
    source,
    /const latestStep = steps\.length > 0 \? steps\[steps\.length - 1\] : null;/,
  );
  assert.match(
    source,
    /const summaryStep = activeStep \?\? \(groupIsLive \? latestStep : null\);/,
  );
  assert.match(
    source,
    /summaryStep[\s\S]*summaryStep === activeStep \|\| summaryStep\.status === "waiting"[\s\S]*`\$\{traceStatusLabel\(summaryStep\.status\)\}: \$\{summaryStep\.title\}`[\s\S]*groupIsLive[\s\S]*summaryStep\.title/,
  );
});

test("chat pane keeps compaction restore inside bootstrap status instead of a standalone phase card", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /eventType === "run_claimed" \|\|\s*eventType === "compaction_restored" \|\|\s*eventType === "run_started"[\s\S]*setLiveAgentStatus\("Checking workspace context"\);/,
  );
  assert.doesNotMatch(source, /Preparing workspace context\.\.\./);
  assert.doesNotMatch(source, /title:\s*"Restored compacted context"/);
  assert.doesNotMatch(source, /id:\s*"phase:compaction-restored"/);
});

test("chat pane renders live placeholder status as faint text with animated trailing dots", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /aria-live="polite"/);
  assert.match(source, /const normalizedStatus = status\.replace\(\/\\\.\+\$\/, ""\)\.trim\(\);/);
  assert.match(
    source,
    /className="inline-flex items-baseline gap-0\.5 text-\[12px\] leading-6 text-muted-foreground\/72"/,
  );
  assert.match(source, /function LiveStatusEllipsis\(\)/);
  assert.match(source, /@keyframes status-dot-wave/);
  assert.match(source, /30% \{ transform: translateY\(-3px\); \}/);
  assert.match(source, /animation: "status-dot-wave 1200ms ease-in-out infinite"/);
  assert.match(source, /animationDelay: `\$\{index \* 120\}ms`/);
  assert.doesNotMatch(source, /Preparing first question\.\.\./);
  assert.doesNotMatch(source, /Queued\.\.\./);
  assert.doesNotMatch(source, /Working\.\.\./);
  assert.doesNotMatch(source, /Checking workspace context\.\.\./);
  assert.doesNotMatch(source, /Thinking\.\.\./);
});

test("chat trace tool errors surface stderr text instead of a generic error label", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function extractToolErrorText\(payload: Record<string, unknown>\)/);
  assert.match(source, /const resultText = extractToolResultText\(payload\.result\);/);
  assert.match(source, /const toolErrorText = extractToolErrorText\(payload\);/);
  assert.match(source, /if \(isError && toolErrorText\) \{\s*details\.push\(toolErrorText\);/);
});

test("chat pane groups configured models under provider headings", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const availableChatModelOptionGroups: ChatModelOptionGroup\[] =[\s\S]*hasConfiguredProviderCatalog/,
  );
  assert.match(
    source,
    /selectedLabel: needsProviderPrefix[\s\S]*\? `\$\{providerGroup\.providerLabel\} · \$\{modelLabel\}`[\s\S]*: modelLabel/,
  );
  assert.match(
    source,
    /searchText: `\$\{providerGroup\.providerLabel\} \$\{modelLabel\} \$\{model\.token\}`/,
  );
  assert.match(source, /const filteredOptionGroups = useMemo\(/);
  assert.match(
    source,
    /modelOptionGroups\.length > 0[\s\S]*\? modelOptionGroups[\s\S]*: \[\{ label: "", options: modelOptions }\]/,
  );
  assert.match(source, /group\.label \? \(/);
  assert.match(source, /text-\[10px\] font-semibold uppercase tracking-\[0\.16em\] text-muted-foreground\/70/);
  assert.doesNotMatch(source, /filteredOptions\.map/);
});

test("chat pane suppresses claude options for the holaboss proxy fallback path", async () => {
  const source = await readFile(sourcePath, "utf8");
  const presetBlock =
    source.match(/const CHAT_MODEL_PRESETS = \[[\s\S]*?\] as const;/)?.[0] ?? "";

  assert.doesNotMatch(presetBlock, /claude-/);
  assert.match(source, /normalized\.startsWith\("google\/"\)/);
  assert.match(source, /normalized\.startsWith\("gemini-"\)/);
  assert.match(source, /function isClaudeChatModel\(model: string\)/);
  assert.match(
    source,
    /isUnsupportedHolabossProxyModel\(\s*providerGroup\.providerId,\s*model\.modelId \|\| normalizedToken,\s*\)/,
  );
  assert.match(source, /!isClaudeChatModel\(runtimeDefaultModel\)/);
  assert.match(
    source,
    /!isClaudeChatModel\(model\) &&[\s\S]*holabossProxyModelsAvailable \|\| !isHolabossProxyModel\(model\)/,
  );
});

test("chat pane filters managed catalog entries that are not chat-capable", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function runtimeModelHasChatCapability\(model: RuntimeProviderModelPayload\)/);
  assert.match(source, /const capabilities = runtimeModelCapabilities\(model\);/);
  assert.match(source, /return capabilities.length === 0 \|\| capabilities.includes\("chat"\);/);
  assert.match(source, /if \(!runtimeModelHasChatCapability\(model\)\) \{\s*return false;\s*\}/);
});

test("chat pane prefixes run failures with provider and model context", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function runFailedContextLabel\(payload: Record<string, unknown>\): string/);
  assert.match(source, /function runFailedDetail\(payload: Record<string, unknown>\): string/);
  assert.match(source, /return detail\.startsWith\(contextLabel\) \? detail : `\$\{contextLabel\}: \$\{detail\}`;/);
  assert.match(source, /const errorText = runFailedDetail\(payload\);/);
  assert.match(source, /const detail = runFailedDetail\(eventPayload\);/);
});

test("chat pane binds in-flight stream attach to the current runtime input on session reload", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const currentRuntimeInputId = \(\s*currentRuntimeState\?\.current_input_id \|\| ""\s*\)\.trim\(\);/,
  );
  assert.match(
    source,
    /openSessionOutputStream\(\s*\{[\s\S]*inputId: currentRuntimeInputId \|\| undefined,[\s\S]*includeHistory: Boolean\(currentRuntimeInputId\),[\s\S]*stopOnTerminal: true,/,
  );
});

test("chat pane exposes a return path from sub-sessions back to the main session", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const showMainSessionReturn =[\s\S]*activeSessionId !== mainSessionId;/);
  assert.match(
    source,
    /You are viewing a separate run session\.[\s\S]*Return to the main[\s\S]*workspace chat to continue there\./,
  );
  assert.match(source, /Back to main session/);
  assert.match(
    source,
    /showMainSessionReturn \? \(\s*<div className="shrink-0 px-4 pt-3 sm:px-5">\s*<div className="bg-muted\/72 flex flex-col items-start gap-3/,
  );
  assert.match(
    source,
    /await loadSessionConversation\(\s*mainSessionId,\s*selectedWorkspaceId,\s*runtimeStates\.items,\s*\);/,
  );
  assert.match(
    source,
    /const targetSessionId =[\s\S]*activeSessionIdRef\.current \|\| preferredSessionId\(selectedWorkspace, \[\]\);/,
  );
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
  assert.match(source, /onOpenLinkInBrowser\?: \(url: string\) => void;/);
  assert.match(source, /onLinkClick=\{onOpenLinkInBrowser\}/);
  assert.match(
    source,
    /<SimpleMarkdown[\s\S]*className="chat-markdown chat-user-markdown max-w-full"[\s\S]*onLinkClick=\{onLinkClick\}[\s\S]*\{text\}[\s\S]*<\/SimpleMarkdown>/,
  );
  assert.match(source, /<SimpleMarkdown[\s\S]*className="chat-markdown chat-assistant-markdown mt-2 max-w-full text-foreground"[\s\S]*onLinkClick=\{onLinkClick\}[\s\S]*\{text\}[\s\S]*<\/SimpleMarkdown>/);
  assert.match(source, /theme-chat-user-bubble inline-flex min-w-0 max-w-full/);
});

test("chat thread uses the full pane width for normal messages", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /className=\{`chat-scrollbar-hidden h-full min-h-0 overflow-x-hidden overflow-y-auto \$\{hasMessages \? "" : "flex items-center justify-center"\}`\}/);
  assert.match(source, /messagesContentRef\}[\s\S]*className="flex min-w-0 w-full flex-col gap-7 px-6 pb-3 pt-5"/);
  assert.match(source, /<form onSubmit=\{onSubmit\} className="w-full">/);
  assert.match(source, /<div className="flex min-w-0 justify-start">[\s\S]*<article className="min-w-0 flex-1">/);
  assert.match(source, /<div className="flex min-w-0 justify-end">[\s\S]*max-w-\[420px\][\s\S]*sm:max-w-\[560px\][\s\S]*lg:max-w-\[680px\]/);
  assert.doesNotMatch(source, /messagesContentRef\}[\s\S]*max-w-\[800px\]/);
  assert.doesNotMatch(source, /<article className="max-w-\[760px\]">/);
});

test("chat pane renders run-scoped memory proposal cards with accept dismiss and edit actions", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /window\.electronAPI\.workspace\.listMemoryUpdateProposals\(\{/);
  assert.match(source, /memoryProposalsByInputId/);
  assert.match(source, /nextMessage\.memoryProposals = turnMemoryProposals/);
  assert.match(source, /AssistantTurnMemoryProposals/);
  assert.match(source, /window\.electronAPI\.workspace\.acceptMemoryUpdateProposal\(\{/);
  assert.match(
    source,
    /window\.electronAPI\.workspace\.dismissMemoryUpdateProposal\(\s*proposal\.proposal_id,\s*\)/,
  );
  assert.match(source, /Edit memory proposal/);
});

test("tool trace steps are collapsed by default and first toggle expands them", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /return collapsedTraceByStepId\[step\.id\] \?\? true;/);
  assert.match(source, /\[stepId\]: !\(prev\[stepId\] \?\? true\)/);
  assert.doesNotMatch(source, /\[step\.id\]: false/);
});

test("chat pane can jump to a requested sub-session run", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /sessionJumpSessionId = null/);
  assert.match(source, /sessionJumpRequestKey = 0/);
  assert.match(source, /const lastHandledSessionJumpRequestKeyRef = useRef\(0\);/);
  assert.match(
    source,
    /const hasSessionJumpRequest =[\s\S]*sessionJumpRequestKey > 0[\s\S]*sessionJumpRequestKey !== lastHandledSessionJumpRequestKeyRef\.current/,
  );
  assert.match(
    source,
    /const requestedOpenSessionId =[\s\S]*sessionOpenRequest\?\.sessionId \|\| ""[\s\S]*\.trim\(\);[\s\S]*const nextSessionId =[\s\S]*hasSessionJumpRequest && requestedSessionId[\s\S]*\? requestedSessionId[\s\S]*: requestedOpenSessionId\)[\s\S]*preferredSessionId\(selectedWorkspaceRef\.current, runtimeStates\.items\);/,
  );
});

test("chat pane restores the current todo plan from session output events and keeps it live from tool calls", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const \[currentTodoPlan, setCurrentTodoPlan\] = useState<ChatTodoPlan \| null>\(\s*null,\s*\);/,
  );
  assert.match(
    source,
    /function todoPlanFromOutputEvents\(outputEvents: SessionOutputEventPayload\[\]\)/,
  );
  assert.match(
    source,
    /setCurrentTodoPlan\(todoPlanFromOutputEvents\(outputEventHistory\.items\)\);/,
  );
  assert.match(
    source,
    /const nextTodoPlan = todoPlanFromToolPayload\(eventPayload\);[\s\S]*if \(nextTodoPlan !== undefined\) \{\s*setCurrentTodoPlan\(nextTodoPlan\);\s*\}/,
  );
  assert.match(source, /case "blocked":\s*return "Blocked";/);
  assert.match(
    source,
    /case "blocked":\s*return "border-amber-400\/35 bg-amber-400\/12 text-amber-700";/,
  );
  assert.match(source, /clearSessionView\(\) \{[\s\S]*setCurrentTodoPlan\(null\);/);
});

test("chat composer exposes a pause action for in-flight runs and calls the runtime pause API", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const \[isPausePending, setIsPausePending\] = useState\(false\);/);
  assert.match(source, /async function pauseCurrentRun\(\)/);
  assert.match(
    source,
    /window\.electronAPI\.workspace\.pauseSessionRun\(\{\s*workspace_id: selectedWorkspaceId,\s*session_id: sessionId,\s*\}\)/,
  );
  assert.match(
    source,
    /<Composer[\s\S]*pausePending=\{isPausePending\}[\s\S]*pauseDisabled=\{\s*pendingInputIdRef\.current === STREAM_ATTACH_PENDING\s*\}[\s\S]*onPause=\{pauseCurrentRun\}/,
  );
  assert.match(
    source,
    /isResponding \? \(\s*<Button[\s\S]*onClick=\{onPause\}[\s\S]*>\s*\{pausePending \? \(\s*<Loader2[\s\S]*\) : \(\s*<Square[\s\S]*\)\}\s*Pause\s*<\/Button>\s*\) : \(\s*<Button[\s\S]*<ArrowUp/,
  );
  assert.match(source, /disabled=\{pausePending \|\| pauseDisabled\}/);
});

test("chat pane renders a collapsed current todo panel above the composer", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function CurrentTodoPanel\(/);
  assert.match(source, /<span>Current working todo<\/span>/);
  assert.match(
    source,
    /<div className="space-y-3">[\s\S]*\{currentTodoPlan \? \(\s*<CurrentTodoPanel[\s\S]*todoPlan=\{currentTodoPlan\}[\s\S]*expanded=\{todoPanelExpanded\}[\s\S]*onToggle=\{\(\) =>[\s\S]*setTodoPanelExpanded\(\(value\) => !value\)[\s\S]*\}\s*\/>\s*\) : null\}[\s\S]*<Composer/,
  );
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(
    source,
    /className=\{`mt-0\.5 shrink-0 text-muted-foreground transition \$\{expanded \? "rotate-0" : "-rotate-90"\}`\}/,
  );
  assert.match(source, /All tracked todo items are complete\./);
  assert.match(
    source,
    /task\.status === "pending" \|\|\s*task\.status === "in_progress" \|\|\s*task\.status === "blocked"/,
  );
  assert.match(
    source,
    /completedStatus === "paused" \|\| completedStatus === "waiting_user"/,
  );
});
