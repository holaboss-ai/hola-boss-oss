import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_SHELL_PATH = new URL("./AppShell.tsx", import.meta.url);

test("app shell routes file outputs into the file explorer while keeping chat active", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /const target = workspaceOutputNavigationTarget\(output, installedAppIds\);/
  );
  assert.match(
    source,
    /if \(\s*\(target\.surface === "document" \|\|\s*target\.surface === "file"\) &&\s*target\.resourceId\?\.trim\(\)\s*\) \{/
  );
  assert.match(
    source,
    /setSpaceVisibility\(\(previous\) => \(\{\s*\.\.\.previous,\s*agent: true,\s*files: true,\s*\}\)\);/
  );
  assert.match(source, /setAgentView\(\{ type: "chat" \}\);/);
  assert.match(
    source,
    /setFileExplorerFocusRequest\(\{\s*path: target\.resourceId,\s*requestKey: Date\.now\(\),\s*\}\);/
  );
});

test("app shell clears a consumed file explorer focus request", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /<FileExplorerPane[\s\S]*focusRequest=\{fileExplorerFocusRequest\}/);
  assert.match(
    source,
    /onFocusRequestConsumed=\{\(requestKey\) => \{\s*setFileExplorerFocusRequest\(\(current\) =>\s*current\?\.requestKey === requestKey \? null : current,\s*\);\s*\}\}/
  );
});

test("app shell removes the outputs quick action", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.doesNotMatch(source, /aria-label="Open outputs panel"/);
});

test("app shell polls runtime notifications and renders the toast stack", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /window\.electronAPI\.workspace\.listNotifications\(\s*null,\s*false,\s*\)/);
  assert.match(source, /<NotificationToastStack[\s\S]*notifications=\{toastNotifications\}/);
  assert.match(source, /notifications=\{combinedNotifications\}/);
  assert.match(source, /notificationUnreadCount=\{notificationUnreadCount\}/);
});

test("app shell wires clear-all notifications through a bulk dismiss handler", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const handleClearAllNotifications = useCallback\(async \(\) => \{/);
  assert.match(source, /runtimeNotificationIds\.map\(\(notificationId\) =>\s*window\.electronAPI\.workspace\.updateNotification\(notificationId,\s*\{\s*state: "dismissed",\s*\}\),/);
  assert.match(source, /appUpdateNotifications\.map\(\(notification\) =>\s*window\.electronAPI\.appUpdate\.dismiss\(notificationReleaseTag\(notification\)\),/);
  assert.match(source, /onClearAllNotifications=\{\(\) => \{\s*void handleClearAllNotifications\(\);\s*\}\}/);
});

test("app shell routes app updates through the shared notification system", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.doesNotMatch(source, /UpdateReminder/);
  assert.match(source, /const appUpdateNotification = useMemo\(\(\) => \{/);
  assert.match(source, /action_url: APP_UPDATE_NOTIFICATION_URL/);
  assert.match(source, /activation_state: "dismissed"/);
  assert.match(source, /await window\.electronAPI\.appUpdate\.dismiss\(/);
  assert.match(source, /await window\.electronAPI\.ui\.openExternalUrl\(targetUrl\);/);
  assert.doesNotMatch(source, /Boolean\(appUpdateStatus\?\.available\)/);
  assert.match(source, /<BrowserPane[\s\S]*suspendNativeView=\{shouldSuspendBrowserNativeView\}/);
});

test("app shell requests remote task proposal generation without a separate success banner", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /requestRemoteTaskProposalGeneration\(/);
  assert.match(source, /Suggestions are unavailable right now\./);
  assert.doesNotMatch(source, /Remote heartbeat accepted/);
  assert.doesNotMatch(source, /Pending cloud jobs/);
});

test("app shell polls proactive status for the selected workspace", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const \[proactiveStatus, setProactiveStatus\]/);
  assert.match(source, /workspace\.getProactiveStatus\(\s*selectedWorkspace\.id,/);
  assert.match(source, /proactiveStatus=\{proactiveStatus\}/);
  assert.match(source, /isLoadingProactiveStatus=\{isLoadingProactiveStatus\}/);
});

test("app shell renames the running panel button to sub-sessions", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /aria-label="Open sub-sessions panel"/);
  assert.doesNotMatch(source, /aria-label="Open running panel"/);
});

test("app shell can route new schedule creation into a prefilled workspace chat", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const \[chatComposerPrefillRequest, setChatComposerPrefillRequest\] =\s*useState<ChatComposerPrefillRequest \| null>\(null\);/);
  assert.match(source, /const handleCreateScheduleInChat = useCallback\(\(\) => \{/);
  assert.match(source, /const mainSessionId = \(selectedWorkspace\?\.main_session_id \|\| ""\)\.trim\(\);/);
  assert.match(source, /setActiveLeftRailItem\("space"\);/);
  assert.match(source, /setSpaceVisibility\(\(previous\) => \(\{\s*\.\.\.previous,\s*agent: true,\s*\}\)\);/);
  assert.match(source, /setAgentView\(\{ type: "chat" \}\);/);
  assert.match(source, /setChatSessionJumpRequest\(null\);/);
  assert.match(source, /setChatSessionOpenRequest\(\(previous\) =>\s*mainSessionId\s*\?\s*\{\s*sessionId: mainSessionId,\s*requestKey: \(previous\?\.requestKey \?\? 0\) \+ 1,\s*\}\s*:\s*null,\s*\);/);
  assert.match(source, /setChatComposerPrefillRequest\(\(previous\) => \(\{\s*text: "Create a cronjob for ",\s*requestKey: \(previous\?\.requestKey \?\? 0\) \+ 1,\s*\}\)\);/);
  assert.match(source, /composerPrefillRequest=\{chatComposerPrefillRequest\}/);
  assert.match(source, /onComposerPrefillConsumed=\{handleChatComposerPrefillConsumed\}/);
  assert.match(source, /onCreateSchedule=\{handleCreateScheduleInChat\}/);
});
