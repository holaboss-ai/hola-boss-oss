import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "ChatPane.tsx");

test("chat pane can consume a one-shot composer prefill request", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /interface ChatPaneComposerPrefillRequest \{\s*text: string;\s*requestKey: number;\s*mode\?: "replace" \| "append";\s*\}/);
  assert.match(source, /composerPrefillRequest\?: ChatPaneComposerPrefillRequest \| null;/);
  assert.match(source, /onComposerPrefillConsumed\?: \(requestKey: number\) => void;/);
  assert.match(source, /const lastHandledComposerPrefillRequestKeyRef = useRef\(0\);/);
  assert.match(source, /const requestKey = composerPrefillRequest\?\.requestKey \?\? 0;/);
  assert.match(source, /requestKey === lastHandledComposerPrefillRequestKeyRef\.current/);
  assert.match(source, /const prefillMode = composerPrefillRequest\?\.mode \?\? "replace";/);
  assert.match(source, /if \(prefillMode === "append"\) \{/);
  assert.match(
    source,
    /setInput\(\(current\) =>\s*appendComposerPrefillText\(current, composerPrefillRequest\?\.text \?\? ""\),\s*\);/,
  );
  assert.match(source, /const parsedPrefill = parseSerializedQuotedSkillPrompt\(/);
  assert.match(source, /setInput\(parsedPrefill\.body\);/);
  assert.match(source, /setQuotedSkillIds\(parsedPrefill\.skillIds\);/);
  assert.match(source, /setPendingAttachments\(\[\]\);/);
  assert.match(source, /onComposerPrefillConsumed\?\.\(requestKey\);/);
});

test("chat pane appends reference prefills without clearing draft state", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function appendComposerPrefillText\(currentInput: string, text: string\) \{/);
  assert.match(source, /const normalizedText = text\.trim\(\);/);
  assert.match(source, /if \(!normalizedText\) \{\s*return currentInput;\s*\}/);
  assert.match(source, /if \(!currentInput\.trim\(\)\) \{\s*return normalizedText;\s*\}/);
  assert.match(source, /return \/\[\\s\(\]\$\/\.test\(currentInput\)/);
  assert.match(
    source,
    /if \(prefillMode === "append"\) \{\s*setInput\(\(current\) =>\s*appendComposerPrefillText\(current, composerPrefillRequest\?\.text \?\? ""\),\s*\);\s*\} else \{\s*const parsedPrefill = parseSerializedQuotedSkillPrompt\(/,
  );
});

test("chat pane can consume a one-shot explorer attachment request", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /interface ChatPaneExplorerAttachmentRequest \{\s*files: ExplorerAttachmentDragPayload\[];\s*requestKey: number;\s*\}/,
  );
  assert.match(
    source,
    /explorerAttachmentRequest\?: ChatPaneExplorerAttachmentRequest \| null;/,
  );
  assert.match(
    source,
    /onExplorerAttachmentRequestConsumed\?: \(requestKey: number\) => void;/,
  );
  assert.match(
    source,
    /const lastHandledExplorerAttachmentRequestKeyRef = useRef\(0\);/,
  );
  assert.match(
    source,
    /function appendPendingExplorerAttachments\(\s*files: ExplorerAttachmentDragPayload\[],\s*\) \{/,
  );
  assert.match(source, /resolveExplorerAttachmentKind\(file\) === "image"/);
  assert.match(
    source,
    /kind: resolveExplorerAttachmentKind\(file\)/,
  );
  assert.match(
    source,
    /stageSessionAttachmentPaths\(\{\s*workspace_id: selectedWorkspace\.id,\s*files: explorerFiles\.map\(\(entry\) => \(\{\s*absolute_path: entry\.absolutePath,\s*name: entry\.name,\s*mime_type: entry\.mime_type \?\? null,\s*kind: entry\.kind,\s*\}\)\),\s*\}\)/,
  );
  assert.match(
    source,
    /const requestKey = explorerAttachmentRequest\?\.requestKey \?\? 0;/,
  );
  assert.match(
    source,
    /requestKey === lastHandledExplorerAttachmentRequestKeyRef\.current/,
  );
  assert.match(
    source,
    /appendPendingExplorerAttachments\(explorerAttachmentRequest\?\.files \?\? \[\]\);/,
  );
  assert.match(
    source,
    /onExplorerAttachmentRequestConsumed\?\.\(requestKey\);/,
  );
});

test("chat pane can consume browser comment drafts without polluting the composer text", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /interface ChatPaneBrowserCommentRequest \{\s*tabId: string;\s*pageTitle: string;\s*url: string;\s*comments: BrowserChatCommentDraftItem\[];\s*requestKey: number;\s*mode\?: "replace" \| "append";\s*\}/,
  );
  assert.match(
    source,
    /browserCommentRequest\?: ChatPaneBrowserCommentRequest \| null;/,
  );
  assert.match(
    source,
    /onBrowserCommentRequestConsumed\?: \(requestKey: number\) => void;/,
  );
  assert.match(
    source,
    /const lastHandledBrowserCommentRequestKeyRef = useRef\(0\);/,
  );
  assert.match(
    source,
    /const \[pendingBrowserCommentDraft, setPendingBrowserCommentDraft\] =\s*useState<PendingBrowserCommentDraft \| null>\(null\);/,
  );
  assert.match(
    source,
    /const requestKey = browserCommentRequest\?\.requestKey \?\? 0;/,
  );
  assert.match(
    source,
    /requestKey === lastHandledBrowserCommentRequestKeyRef\.current/,
  );
  assert.match(
    source,
    /setPendingBrowserCommentDraft\(\{\s*tabId: browserCommentRequest\?\.tabId \?\? "",\s*pageTitle: browserCommentRequest\?\.pageTitle \?\? "",\s*url: browserCommentRequest\?\.url \?\? "",\s*comments: browserCommentRequest\?\.comments \?\? \[\],\s*\}\);/,
  );
  assert.match(
    source,
    /const browserCommentMode = browserCommentRequest\?\.mode \?\? "replace";/,
  );
  assert.match(
    source,
    /const textareaPlaceholder = isOnboardingVariant[\s\S]*\?\s*"Ask for follow-up changes"[\s\S]*:\s*"Ask anything";/,
  );
  assert.match(
    source,
    /browserComments=\{pendingBrowserCommentDraft\}/,
  );
  assert.match(
    source,
    /onClearBrowserComments=\{clearPendingBrowserComments\}/,
  );
  assert.match(
    source,
    /onBrowserCommentRequestConsumed\?\.\(requestKey\);/,
  );
});
