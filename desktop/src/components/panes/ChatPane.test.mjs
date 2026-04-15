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
  assert.match(
    source,
    /<Waypoints[\s\S]*size=\{13\}[\s\S]*className="shrink-0 text-muted-foreground"[\s\S]*\/>/,
  );
  assert.match(source, /Open provider settings to connect a model\./);
  assert.match(
    source,
    /className=\{[\s\S]*compactComposerControls[\s\S]*\? "min-w-0 shrink-0"[\s\S]*: noAvailableModels[\s\S]*\? "min-w-0 flex flex-1 basis-full flex-wrap items-center gap-2"[\s\S]*: "min-w-0 flex-1 basis-\[220px\] max-w-\[240px\]"[\s\S]*\}/,
  );
  assert.match(source, /\{compactComposerControls \? "Providers" : "Set up providers"\}/);
  assert.match(
    source,
    /className=\{`min-w-0 text-\[10px\] leading-5 text-muted-foreground \$\{[\s\S]*compactComposerControls \? "hidden" : ""[\s\S]*`\}/,
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

test("chat composer footer wraps controls based on available pane width instead of viewport breakpoints", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const COMPOSER_FULL_MODEL_CONTROL_WIDTH_PX = 240;/,
  );
  assert.match(source, /const syncComposerFooterLayout = \(\) => \{/);
  assert.match(source, /const footerStyle = window\.getComputedStyle\(footer\);/);
  assert.match(
    source,
    /const horizontalPadding =[\s\S]*footerStyle\.paddingLeft[\s\S]*footerStyle\.paddingRight/,
  );
  assert.match(
    source,
    /const width = Math\.max\(\s*0,\s*Math\.round\(footer\.clientWidth - horizontalPadding\),\s*\);/,
  );
  assert.match(
    source,
    /const resizeObserver = new ResizeObserver\(\(\) => \{\s*syncComposerFooterLayout\(\);\s*\}\);/,
  );
  assert.match(
    source,
    /const compactComposerControls =\s*showModelSelector &&[\s\S]*composerFooterLayout\.wraps[\s\S]*composerFooterLayout\.width < fullFooterControlWidth/,
  );
  assert.match(
    source,
    /const compactModelControlWidth = compactComposerControls[\s\S]*COMPOSER_COMPACT_MODEL_CONTROL_MAX_WIDTH_PX[\s\S]*compactFooterControlWidth -[\s\S]*COMPOSER_COMPACT_THINKING_CONTROL_MIN_WIDTH_PX/,
  );
  assert.match(
    source,
    /const compactThinkingControlWidth = showThinkingValueSelector[\s\S]*COMPOSER_COMPACT_THINKING_CONTROL_MAX_WIDTH_PX[\s\S]*compactFooterControlWidth - compactModelControlWidth/,
  );
  assert.match(
    source,
    /className=\{`border-t border-border\/20 px-3 py-3 text-muted-foreground \$\{[\s\S]*compactComposerControls[\s\S]*\? "flex items-center gap-2 overflow-hidden"[\s\S]*: "flex flex-wrap items-center gap-2"[\s\S]*`\}/,
  );
  assert.match(
    source,
    /className=\{\s*compactComposerControls[\s\S]*\? "min-w-0 shrink-0"[\s\S]*: noAvailableModels[\s\S]*"min-w-0 flex flex-1 basis-full flex-wrap items-center gap-2"[\s\S]*\}/,
  );
  assert.match(
    source,
    /style=\{\s*compactComposerControls\s*\?\s*\{ width: `\$\{compactModelControlWidth\}px` \}\s*:\s*undefined\s*\}/,
  );
  assert.match(
    source,
    /className="ml-auto flex shrink-0 items-center gap-2"/,
  );
  assert.match(source, /compact=\{compactComposerControls\}/);
  assert.doesNotMatch(source, /sm:w-\[208px\]/);
});

test("chat composer switches model and thinking selectors into icon-led compact triggers", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function compactComposerModelLabel\(label: string\)/);
  assert.match(source, /function displayThinkingValueLabel\(value: string\)/);
  assert.match(source, /const compactLabel = compactComposerModelLabel\(displayLabel\);/);
  assert.match(
    source,
    /compact \? \(\s*<span className="flex min-w-0 items-center gap-2">[\s\S]*<Waypoints[\s\S]*<span className="truncate">\{compactLabel\}<\/span>/,
  );
  assert.match(
    source,
    /const selectedThinkingLabel = displayThinkingValueLabel\(selectedThinkingValue\);/,
  );
  assert.match(source, /const \[open, setOpen\] = useState\(false\);/);
  assert.match(
    source,
    /aria-label=\{\s*compact \? `Reasoning effort: \$\{selectedThinkingLabel\}` : undefined\s*\}/,
  );
  assert.match(
    source,
    /compact\s*\?\s*showCompactLabel\s*\?\s*"min-w-0 justify-between px-2\.5"\s*:\s*"min-w-0 justify-start gap-1\.5 px-2\.5"/,
  );
  assert.match(
    source,
    /compact \? \(\s*showCompactLabel \? \(\s*<>\s*<span className="flex min-w-0 items-center gap-1\.5">[\s\S]*<Lightbulb[\s\S]*<span className="truncate">\{selectedThinkingLabel\}<\/span>[\s\S]*<ChevronDown[\s\S]*<\/>\s*\) : \(\s*<span className="flex min-w-0 items-center gap-1\.5">[\s\S]*<Lightbulb[\s\S]*<ChevronDown/,
  );
  assert.match(
    source,
    /<PopoverContent[\s\S]*align="start"[\s\S]*side="top"[\s\S]*sideOffset=\{8\}[\s\S]*className="w-\[220px\] p-0"[\s\S]*Reasoning effort[\s\S]*thinkingValues\.map\(\(value\) => renderOption\(value\)\)/,
  );
});

test("chat trace summary only surfaces terminal run failures in the summary label", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const terminalErrorCount = steps\.filter\(\s*\(step\) => step\.kind === "phase" && step\.status === "error"/,
  );
  assert.match(source, /const groupHasTerminalError = terminalErrorCount > 0;/);
  assert.match(
    source,
    /const summarySuffix = groupHasTerminalError[\s\S]*`\s*\(\$\{terminalErrorCount\} failed\)`[\s\S]*:\s*"";/,
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
  assert.match(
    source,
    /className="flex w-full items-start gap-2 rounded-lg px-2\.5 py-1\.5 -ml-2\.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted\/60"/,
  );
  assert.match(source, /<span className="min-w-0 flex-1 leading-5">/);
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
});

test("chat pane renders an execution timeline that interleaves thinking segments with trace entries", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /executionItems\?: ChatExecutionTimelineItem\[];/);
  assert.match(source, /function appendExecutionTimelineThinkingDelta\(/);
  assert.match(source, /function upsertExecutionTimelineTraceItem\(/);
  assert.match(source, /function traceStepsFromExecutionItems\(items: ChatExecutionTimelineItem\[]\)/);
  assert.match(source, /assistantHistoryStateFromOutputEvents[\s\S]*executionItems = appendExecutionTimelineThinkingDelta\(/);
  assert.match(source, /assistantHistoryStateFromOutputEvents[\s\S]*executionItems = upsertExecutionTimelineTraceItem\(/);
  assert.match(source, /appendLiveThinkingDelta\(delta: string, order: number\)/);
  assert.match(source, /appendExecutionTimelineThinkingDelta\(prev, delta, order\)/);
  assert.match(
    source,
    /function ExecutionTimelineThinkingEntry[\s\S]*className="py-1"[\s\S]*className="-ml-2\.5 w-\[calc\(100%\+0\.625rem\)\] rounded-\[16px\] border border-border\/25 bg-muted\/30 px-3\.5 py-3"/,
  );
  assert.match(
    source,
    /function ExecutionTimelineThinkingEntry[\s\S]*className="chat-markdown chat-thinking-markdown max-w-full text-foreground\/82"/,
  );
  assert.match(source, /<AssistantTurn[\s\S]*executionItems=\{message\.executionItems \?\? \[\]\}/);
  assert.match(source, /<AssistantTurn[\s\S]*executionItems=\{liveExecutionItems\}/);
  assert.match(source, /<TraceStepGroup[\s\S]*items=\{executionItems\}/);
  assert.match(source, /<ExecutionTimelineThinkingEntry/);
  assert.match(source, /<TraceTimelineStepEntry/);
  assert.doesNotMatch(source, /<ThinkingPanel/);
  assert.doesNotMatch(source, /thinkingCollapsed/);
  assert.doesNotMatch(source, /onToggleThinking/);
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

test("chat pane does not suppress claude options for the holaboss proxy fallback path", async () => {
  const source = await readFile(sourcePath, "utf8");
  const presetBlock =
    source.match(/const CHAT_MODEL_PRESETS = \[[\s\S]*?\] as const;/)?.[0] ?? "";

  assert.doesNotMatch(presetBlock, /claude-/);
  assert.match(source, /normalized\.startsWith\("google\/"\)/);
  assert.match(source, /normalized\.startsWith\("gemini-"\)/);
  assert.match(
    source,
    /const runtimeDefaultModelAvailable =[\s\S]*\(holabossProxyModelsAvailable \|\|[\s\S]*!isHolabossProxyModel\(runtimeDefaultModel\)\);/,
  );
  assert.match(
    source,
    /holabossProxyModelsAvailable \|\| !isHolabossProxyModel\(model\)/,
  );
  assert.doesNotMatch(source, /function isClaudeChatModel\(model: string\)/);
  assert.doesNotMatch(source, /isUnsupportedHolabossProxyModel\(/);
  assert.doesNotMatch(source, /!isClaudeChatModel\(runtimeDefaultModel\)/);
  assert.doesNotMatch(source, /!isClaudeChatModel\(model\) &&/);
});

test("chat pane gates image attachments using model input modalities metadata", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function supportsImageInput\(inputModalities\?: readonly string\[\] \| null\): boolean/);
  assert.match(
    source,
    /const selectedInputModalities = selectedConfiguredModel[\s\S]*selectedFallbackModelMetadata\?\.inputModalities \?\? \[\];/,
  );
  assert.match(
    source,
    /const selectedModelSupportsImageInput = supportsImageInput\(\s*selectedInputModalities,\s*\);/,
  );
  assert.match(
    source,
    /attachmentLooksLikeImage\(file\.name,\s*file\.type\)/,
  );
  assert.match(
    source,
    /inferDraggedAttachmentKind\(file\.name,\s*file\.mimeType\) === "image"/,
  );
  assert.match(
    source,
    /const pendingImageInputUnsupportedMessage =[\s\S]*Remove the attached image or switch models\./,
  );
  assert.match(
    source,
    /if \(pendingImageInputUnsupportedMessage\) \{\s*return;\s*\}/,
  );
  assert.match(
    source,
    /submitDisabled=\{Boolean\(\s*pendingImageInputUnsupportedMessage,\s*\)\}/,
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

test("chat pane can create a workspace session when none exists yet", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /async function createWorkspaceSession\(\s*workspaceId: string,\s*parentSessionId\?: string \| null,\s*\): Promise<string \| null>/,
  );
  assert.match(source, /window\.electronAPI\.workspace\.createAgentSession\(\{/);
  assert.match(source, /parent_session_id: parentSessionId\?\.trim\(\) \|\| null,/);
  assert.match(source, /const resolvedSessionId = nextSessionId \|\| null;/);
  assert.doesNotMatch(
    source,
    /const resolvedSessionId =\s*nextSessionId \|\| \(await createWorkspaceSession\(selectedWorkspaceId\)\);/,
  );
  assert.match(
    source,
    /if \(!targetSessionId && selectedWorkspace\) \{\s*targetSessionId = await createWorkspaceSession\(\s*selectedWorkspace\.id,\s*draftParentSessionIdRef\.current,\s*\);/,
  );
});

test("chat pane exposes an in-pane session dropdown for switching agent sessions", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /onOpenInbox\?: \(\) => void;/);
  assert.match(source, /inboxUnreadCount\?: number;/);
  assert.match(
    source,
    /onRequestCreateSession\?: \(request: ChatPaneSessionOpenRequest\) => void;/,
  );
  assert.match(source, /onSessionOpenRequestConsumed\?: \(requestKey: number\) => void;/);
  assert.match(source, /const \[availableSessions, setAvailableSessions\] = useState<ChatSessionOption\[]>\(\s*\[\],\s*\);/);
  assert.match(source, /const \[localSessionOpenRequest, setLocalSessionOpenRequest\] =\s*useState<ChatPaneSessionOpenRequest \| null>\(null\);/);
  assert.match(
    source,
    /const localSessionOpenRequestRef =\s*useRef<ChatPaneSessionOpenRequest \| null>\(null\);/,
  );
  assert.match(source, /const effectiveSessionOpenRequest =\s*sessionOpenRequest \?\? localSessionOpenRequest;/);
  assert.match(
    source,
    /localSessionOpenRequestRef\.current = localSessionOpenRequest;/,
  );
  assert.match(source, /function setLocalSessionOpenRequestState\(/);
  assert.match(source, /function sessionStatusIndicator\(statusLabel: string\)/);
  assert.match(source, /window\.electronAPI\.workspace\.listAgentSessions\(selectedWorkspaceId\)/);
  assert.match(source, /window\.electronAPI\.workspace\.listRuntimeStates\(selectedWorkspaceId\)/);
  assert.match(source, /<div className="shrink-0 border-b border-border\/45 px-4 py-2\.5 sm:px-5">[\s\S]*<SessionSelector/);
  assert.match(source, /<SessionSelector[\s\S]*sessions=\{availableSessions\}[\s\S]*onSelectSession=\{openSessionFromPicker\}[\s\S]*onOpenInbox=\{onOpenInbox\}[\s\S]*inboxUnreadCount=\{inboxUnreadCount\}[\s\S]*onCreateSession=\{requestDraftSessionFromPicker\}/);
  assert.match(source, /aria-label="Select agent session"/);
  assert.match(source, /aria-label="Show inbox"/);
  assert.match(source, /aria-label="Create new session"/);
  assert.match(source, /placeholder="Search sessions\.\.\."/);
  assert.match(source, /open\s*\?\s*"rotate-180 group-hover:-translate-y-1 group-hover:scale-150"\s*:\s*"rotate-0 group-hover:translate-y-1 group-hover:scale-150"/);
  assert.match(source, /filteredSessions\.map\(\(session\) => \{/);
  assert.match(source, /inboxUnreadCount > 0 \? \(/);
  assert.match(source, /onOpenInbox\(\);/);
  assert.match(source, /onSessionOpenRequestConsumed\?\.\(requestKey\);/);
  assert.match(source, /setLocalSessionOpenRequestState\(\{\s*sessionId: normalizedSessionId,\s*requestKey: Date\.now\(\),\s*\}\);/);
  assert.match(
    source,
    /const draftRequest: ChatPaneSessionOpenRequest = \{\s*sessionId: "",\s*mode: "draft",\s*parentSessionId: null,\s*requestKey: Date\.now\(\),\s*\};\s*setLocalSessionOpenRequestState\(draftRequest\);\s*onRequestCreateSession\?\.\(draftRequest\);/,
  );
});

test("chat pane syncs the shared file display from live file-oriented tool calls", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /onSyncFileDisplayFromAgentOperation\?: \(path: string\) => void;/,
  );
  assert.match(
    source,
    /function fileDisplaySyncTargetFromToolPayload\(\s*payload: Record<string, unknown>,\s*\): string \| null \{/,
  );
  assert.match(
    source,
    /const lastSyncedAgentOperationFileKeyRef = useRef\(""\);/,
  );
  assert.match(
    source,
    /toolName === "write_report" \|\| toolName === "image_generate"/,
  );
  assert.match(
    source,
    /syncableWorkspacePathFromRecord\(payload\.result,\s*\[\s*"file_path",\s*"path",\s*\]\)/,
  );
  assert.match(
    source,
    /toolName === "read" \|\| toolName === "edit"/,
  );
  assert.match(
    source,
    /if \(eventType === "tool_call"\) \{\s*const fileDisplayTarget =\s*fileDisplaySyncTargetFromToolPayload\(eventPayload\);[\s\S]*onSyncFileDisplayFromAgentOperation\?\.\(fileDisplayTarget\);/,
  );
});

test("chat pane keeps local picker session requests from overriding a newer shell session request", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const isExternalSessionOpenRequest = sessionOpenRequest !== null;/);
  assert.match(source, /const lastHandledExternalSessionOpenRequestKeyRef = useRef\(0\);/);
  assert.match(source, /const lastHandledLocalSessionOpenRequestKeyRef = useRef\(0\);/);
  assert.match(
    source,
    /const lastHandledSessionOpenRequestKeyRef = isExternalSessionOpenRequest\s*\?\s*lastHandledExternalSessionOpenRequestKeyRef\s*:\s*lastHandledLocalSessionOpenRequestKeyRef;/,
  );
  assert.match(
    source,
    /if \(!cancelled\) \{\s*if \(!historyLoaded\) \{\s*cancelHistoryViewportRestore\(\);\s*\}\s*setIsLoadingHistory\(false\);\s*consumeSessionOpenRequest\(requestKey\);\s*\}/,
  );
});

test("chat pane routes immediate sends through the newer pending session request instead of the previously active session", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const consumedSessionOpenRequestKeysRef = useRef<Set<number>>\(new Set\(\)\);/,
  );
  assert.match(source, /function consumeSessionOpenRequest\(requestKey: number\)/);
  assert.match(source, /function pendingSessionTargetForSend\(\): PendingSessionTarget \| null/);
  assert.match(
    source,
    /const currentSessionOpenRequest =\s*sessionOpenRequest \?\? localSessionOpenRequestRef\.current;/,
  );
  assert.match(
    source,
    /const pendingSessionTarget = pendingSessionTargetForSend\(\);[\s\S]*let targetSessionId =[\s\S]*pendingSessionTarget\?\.mode === "session"[\s\S]*activeSessionIdRef\.current;/,
  );
  assert.match(
    source,
    /if \(pendingSessionTarget\) \{\s*consumeSessionOpenRequest\(pendingSessionTarget\.requestKey\);\s*clearSessionView\(\);[\s\S]*setActiveSession\(pendingSessionTarget\.sessionId\);[\s\S]*draftParentSessionIdRef\.current = pendingSessionTarget\.parentSessionId;\s*setActiveSession\(null\);/,
  );
  assert.match(
    source,
    /if \(!targetSessionId && selectedWorkspace\) \{\s*targetSessionId = await createWorkspaceSession\(\s*selectedWorkspace\.id,\s*pendingSessionTarget\?\.mode === "draft"\s*\?\s*pendingSessionTarget\.parentSessionId\s*:\s*draftParentSessionIdRef\.current,\s*\);/,
  );
  assert.match(
    source,
    /if \(isSessionOpenRequestConsumed\(requestKey\)\) \{\s*consumeSessionOpenRequest\(requestKey\);\s*return;\s*\}\s*if \(requestKey === lastHandledSessionOpenRequestKeyRef\.current\) \{\s*return;\s*\}/,
  );
  assert.match(
    source,
    /if \(cancelled \|\| isSessionOpenRequestConsumed\(requestKey\)\) \{\s*historyLoaded = true;\s*return;\s*\}/,
  );
  assert.match(
    source,
    /if \(isSessionOpenRequestConsumed\(requestKey\)\) \{\s*consumeSessionOpenRequest\(requestKey\);\s*return;\s*\}/,
  );
});

test("chat pane clears session-open requests only after the history restore flow settles", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /let historyLoaded = false;\s*beginHistoryViewportRestore\(\);\s*setIsLoadingHistory\(true\);/);
  assert.match(
    source,
    /finally \{\s*if \(!cancelled && !historyLoaded\) \{\s*cancelHistoryViewportRestore\(\);\s*\}\s*if \(!cancelled\) \{\s*setIsLoadingHistory\(false\);\s*\}\s*if \(isExternalSessionOpenRequest\) \{\s*onSessionOpenRequestConsumed\?\.\(requestKey\);\s*\} else \{\s*setLocalSessionOpenRequest\(\(current\) =>\s*current\?\.requestKey === requestKey \? null : current,\s*\);\s*\}\s*\}/,
  );
});

test("chat pane hides restored history until the viewport snaps to the latest message", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /useLayoutEffect/);
  assert.match(source, /const \[isHistoryViewportPending, setIsHistoryViewportPending\] =\s*useState\(false\);/);
  assert.match(source, /const \[historyViewportRestoreGeneration, setHistoryViewportRestoreGeneration\] =\s*useState\(0\);/);
  assert.match(source, /const historyViewportGenerationRef = useRef\(0\);/);
  assert.match(source, /function beginHistoryViewportRestore\(\)/);
  assert.match(source, /function requestHistoryViewportRestore\(\)/);
  assert.match(source, /function cancelHistoryViewportRestore\(\)/);
  assert.match(source, /function HistoryRestoreSkeleton\(\)/);
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{[\s\S]*container\.scrollTo\(\{\s*top: container\.scrollHeight,\s*behavior: "auto",\s*\}\);[\s\S]*setIsHistoryViewportPending\(false\);[\s\S]*\}, \[historyViewportRestoreGeneration, isHistoryViewportPending\]\);/,
  );
  assert.match(
    source,
    /behavior:\s*isResponding \|\| isHistoryViewportPending \? "auto" : "smooth"/,
  );
  assert.match(
    source,
    /const showHistoryRestoreScreen =\s*isLoadingHistory \|\| isHistoryViewportPending;/,
  );
  assert.match(source, /role="status"/);
  assert.match(source, /aria-label="Loading conversation"/);
  assert.match(source, /animate-pulse/);
  assert.match(source, /showHistoryRestoreScreen \? <HistoryRestoreSkeleton \/> : null/);
  assert.match(source, /showHistoryRestoreScreen \? "invisible" : ""/);
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

test("user turns expose a hover footer with copy and timestamp metadata", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /createdAt\?: string;/);
  assert.match(source, /function chatMessageTimeLabel\(value: string \| null \| undefined\): string/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /document\.execCommand\("copy"\)/);
  assert.match(source, /const timeLabel = chatMessageTimeLabel\(createdAt\);/);
  assert.match(source, /className="group\/user-turn flex min-w-0 justify-end"/);
  assert.match(
    source,
    /group-hover\/user-turn:opacity-100[\s\S]*group-hover\/user-turn:pointer-events-auto[\s\S]*group-focus-within\/user-turn:opacity-100/,
  );
  assert.match(source, /aria-label=\{\s*copyFeedbackVisible[\s\S]*"Copy user message"/);
  assert.match(source, /<Copy size=\{13\} strokeWidth=\{1\.9\} \/>/);
  assert.match(source, /<Check size=\{13\} strokeWidth=\{1\.9\} \/>/);
  assert.match(source, /createdAt: message\.created_at \|\| undefined,/);
  assert.match(source, /createdAt: new Date\(\)\.toISOString\(\),/);
  assert.match(source, /createdAt=\{message\.createdAt\}/);
});

test("chat thread uses the full pane width for normal messages", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /className=\{`chat-scrollbar-hidden h-full min-h-0 overflow-x-hidden overflow-y-auto \$\{hasMessages \? "" : "flex items-center justify-center"\}`\}/);
  assert.match(source, /messagesContentRef\}[\s\S]*className=\{`flex min-w-0 w-full flex-col gap-7 px-6 pb-3 pt-5 \$\{\s*showHistoryRestoreScreen \? "invisible" : ""\s*\}`\}/);
  assert.match(source, /<form onSubmit=\{onSubmit\} className="w-full">/);
  assert.match(source, /<div className="flex min-w-0 justify-start">[\s\S]*<article className="min-w-0 flex-1">/);
  assert.match(source, /className="group\/user-turn flex min-w-0 justify-end"[\s\S]*max-w-\[420px\][\s\S]*sm:max-w-\[560px\][\s\S]*lg:max-w-\[680px\]/);
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

test("view all artifacts modal sorts artifacts newest first", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /function sortOutputsLatestFirst\(outputs: WorkspaceOutputRecordPayload\[\]\)/,
  );
  assert.match(
    source,
    /const filteredOutputs = sortOutputsLatestFirst\(\s*filter === "all"\s*\?\s*outputs\s*:\s*outputs\.filter\(/,
  );
  assert.match(
    source,
    /if \(leftTime !== rightTime\) \{\s*return rightTime - leftTime;\s*\}/,
  );
});

test("artifact rows include timestamp metadata in both inline and modal lists", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const timeLabel = chatMessageTimeLabel\(output\.created_at\);/);
  assert.match(
    source,
    /if \(timeLabel\) \{\s*parts\.push\(timeLabel\);\s*\}/,
  );
  assert.match(
    source,
    /<div className="text-\[11px\] text-muted-foreground">\s*\{outputSecondaryLabel\(output\)\}\s*<\/div>/,
  );
  assert.match(
    source,
    /<div className="truncate text-\[12px\] text-muted-foreground">\s*\{outputSecondaryLabel\(output\)\}\s*<\/div>/,
  );
});

test("tool trace steps are collapsed by default and first toggle expands them", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /return collapsedTraceByStepId\[step\.id\] \?\? true;/);
  assert.match(source, /\[stepId\]: !\(prev\[stepId\] \?\? true\)/);
  assert.doesNotMatch(source, /\[step\.id\]: false/);
});

test("live trace auto-expands during the run and collapses when output starts", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /function TraceStepGroup\(\{[\s\S]*items,[\s\S]*live = false,[\s\S]*liveOutputStarted = false,/,
  );
  assert.match(source, /const steps = traceStepsFromExecutionItems\(items\);/);
  assert.match(
    source,
    /const \[groupExpanded, setGroupExpanded\] = useState\(\s*live && !liveOutputStarted,\s*\);/,
  );
  assert.match(
    source,
    /if \(live && !previousLiveRef\.current\) \{\s*setGroupExpanded\(!liveOutputStarted\);\s*\}/,
  );
  assert.match(
    source,
    /if \(live && liveOutputStarted && !previousLiveOutputStartedRef\.current\) \{\s*setGroupExpanded\(false\);\s*\}/,
  );
  assert.match(
    source,
    /<TraceStepGroup[\s\S]*items=\{executionItems\}[\s\S]*live=\{live\}[\s\S]*liveOutputStarted=\{live && Boolean\(text\)\}/,
  );
});

test("chat pane can jump to a requested sub-session run", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /sessionJumpSessionId = null/);
  assert.match(source, /sessionJumpRequestKey = 0/);
  assert.match(source, /const lastHandledSessionJumpRequestKeyRef = useRef\(0\);/);
  assert.match(source, /const lastHandledExternalSessionOpenRequestKeyRef = useRef\(0\);/);
  assert.match(source, /const lastHandledLocalSessionOpenRequestKeyRef = useRef\(0\);/);
  assert.match(source, /const draftParentSessionIdRef = useRef<string \| null>\(null\);/);
  assert.match(
    source,
    /const hasSessionJumpRequest =[\s\S]*sessionJumpRequestKey > 0[\s\S]*sessionJumpRequestKey !== lastHandledSessionJumpRequestKeyRef\.current/,
  );
  assert.match(
    source,
    /const lastHandledSessionOpenRequestKeyRef = isExternalSessionOpenRequest\s*\?\s*lastHandledExternalSessionOpenRequestKeyRef\s*:\s*lastHandledLocalSessionOpenRequestKeyRef;/,
  );
  assert.match(
    source,
    /const requestMode = effectiveSessionOpenRequest\?\.mode \?\? "session";[\s\S]*const requestedParentSessionId =[\s\S]*effectiveSessionOpenRequest\?\.parentSessionId\?\.trim\(\) \|\| null;/,
  );
  assert.match(
    source,
    /if \(requestMode === "draft"\) \{\s*draftParentSessionIdRef\.current = requestedParentSessionId;\s*clearSessionView\(\);\s*setActiveSession\(null\);\s*requestHistoryViewportRestore\(\);\s*historyLoaded = true;\s*return;\s*\}/,
  );
  assert.match(
    source,
    /const nextSessionId =\s*\(hasSessionJumpRequest && requestedSessionId\s*\?\s*requestedSessionId\s*:\s*null\)\s*\|\|\s*preferredSessionId\(\s*selectedWorkspaceRef\.current,\s*runtimeStates\.items,\s*sessionsResponse\.items,\s*\);[\s\S]*const resolvedSessionId = nextSessionId \|\| null;/,
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
    /case "blocked":\s*return "text-amber-700";/,
  );
  assert.match(source, /function TodoStatusIcon\(\{ status \}: \{ status: ChatTodoStatus \}\)/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /<TodoStatusIcon status=\{task\.status\} \/>/);
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
  assert.match(source, /function currentTodoPosition\(phases: ChatTodoPhase\[\]\)/);
  assert.match(source, /function latestCompletedTodoEntry\(phases: ChatTodoPhase\[\]\)/);
  assert.match(source, /function phaseHasRemainingTodoTasks\(phase: ChatTodoPhase\)/);
  assert.match(source, /function visibleTodoPhases\(phases: ChatTodoPhase\[\]\)/);
  assert.match(source, /const summaryLabel = activeEntry/);
  assert.match(source, /: latestCompletedEntry\?\.task\.content \|\|/);
  assert.match(source, /const visiblePhases = visibleTodoPhases\(todoPlan\.phases\);/);
  assert.match(source, /const totalTaskCount = todoTaskCount\(visiblePhases\);/);
  assert.match(source, /const currentTaskPosition = currentTodoPosition\(visiblePhases\);/);
  assert.match(
    source,
    /const activePhases = phases\.filter\(\(phase\) => phaseHasRemainingTodoTasks\(phase\)\);[\s\S]*if \(activePhases\.length > 0\) \{\s*return activePhases;\s*\}/,
  );
  assert.match(
    source,
    /return latestCompletedPhaseIndex < 0\s*\? phases\s*: phases\.slice\(latestCompletedPhaseIndex, latestCompletedPhaseIndex \+ 1\);/,
  );
  assert.match(
    source,
    /return phase\.tasks\.some\(\s*\(task\) =>\s*task\.status === "pending" \|\|\s*task\.status === "in_progress" \|\|\s*task\.status === "blocked",/,
  );
  assert.match(source, /const progressLabel =\s*totalTaskCount > 0 \? `\$\{currentTaskPosition\}\/\$\{totalTaskCount\}` : "0\/0";/);
  assert.match(source, /\{visiblePhases\.map\(\(phase\) => \{/);
  assert.match(
    source,
    /<div className="space-y-3">[\s\S]*\{currentTodoPlan \? \(\s*<CurrentTodoPanel[\s\S]*todoPlan=\{currentTodoPlan\}[\s\S]*expanded=\{todoPanelExpanded\}[\s\S]*onToggle=\{\(\) =>[\s\S]*setTodoPanelExpanded\(\(value\) => !value\)[\s\S]*\}\s*\/>\s*\) : null\}[\s\S]*<Composer/,
  );
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(
    source,
    /className=\{`shrink-0 text-muted-foreground transition \$\{expanded \? "rotate-0" : "-rotate-90"\}`\}/,
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

test("chat pane stops auto-follow while the user is actively selecting chat text", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function hasActiveChatSelection\(container: HTMLDivElement \| null\)/);
  assert.match(source, /const selection = window\.getSelection\(\);/);
  assert.match(
    source,
    /!container \|\|\s*!shouldAutoScrollRef\.current \|\|\s*hasActiveChatSelection\(container\)/,
  );
});

test("chat pane stops auto-follow as soon as the user scrolls upward during streaming", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const lastChatScrollTopRef = useRef\(0\);/);
  assert.match(source, /lastChatScrollTopRef\.current = target\.scrollTop;/);
  assert.match(
    source,
    /onWheelCapture=\{\(event\) => \{\s*if \(event\.deltaY < 0\) \{\s*shouldAutoScrollRef\.current = false;\s*\}\s*\}\}/,
  );
  assert.match(
    source,
    /const scrolledUp =\s*currentTarget\.scrollTop < lastChatScrollTopRef\.current;/,
  );
  assert.match(
    source,
    /shouldAutoScrollRef\.current = scrolledUp \? false : nearBottom;/,
  );
});

test("chat pane custom scrollbar thumb can be dragged", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const chatScrollbarDragStateRef = useRef<ChatScrollbarDragState \| null>\(/,
  );
  assert.match(
    source,
    /function updateChatScrollFromScrollbarPointer\([\s\S]*container\.scrollTop = nextScrollTop;[\s\S]*syncChatScrollMetrics\(container\);/,
  );
  assert.match(
    source,
    /event\.currentTarget\.setPointerCapture\(event\.pointerId\);/,
  );
  assert.match(source, /data-chat-scrollbar-thumb="true"/);
  assert.match(source, /onPointerDown=\{handleChatScrollbarPointerDown\}/);
  assert.match(source, /onPointerMove=\{handleChatScrollbarPointerMove\}/);
  assert.match(
    source,
    /onLostPointerCapture=\{\(\) => \{\s*clearChatScrollbarDragState\(\);\s*\}\}/,
  );
});
