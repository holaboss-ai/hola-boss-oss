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

  assert.match(source, /window\.electronAPI\.workspace\.listNotifications\(\s*null\s*\)/);
  assert.match(source, /<NotificationToastStack[\s\S]*leadingToast=\{/);
  assert.match(source, /<NotificationToastStack[\s\S]*notifications=\{toastNotifications\}/);
  assert.match(source, /<NotificationToastStack[\s\S]*onCloseToast=\{\(notificationId\) => \{\s*void handleDismissNotification\(notificationId\);\s*\}\}/);
  assert.match(source, /<NotificationToastStack[\s\S]*className=\{anchoredToastStackClassName\}/);
  assert.match(source, /const runtimeNotificationById = useMemo\(/);
});

test("app shell keeps desktop updates separate from runtime notification state", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /function appUpdateChangelogUrl\(/);
  assert.match(source, /const handleDismissUpdate = useCallback\(/);
  assert.match(source, /void window\.electronAPI\.appUpdate\.dismiss\(/);
  assert.match(source, /void window\.electronAPI\.ui\.openExternalUrl\(changelogUrl\);/);
  assert.doesNotMatch(source, /combinedNotifications/);
  assert.doesNotMatch(source, /syntheticNotificationStates/);
  assert.match(source, /<BrowserPane[\s\S]*suspendNativeView=\{shouldSuspendBrowserNativeView\}/);
});

test("app shell opens cronjob session-run notifications in the sub-session chat", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /function notificationTargetSessionId\(/);
  assert.match(source, /const targetSessionId = notificationTargetSessionId\(notification\);/);
  assert.match(source, /setSelectedWorkspaceId\(targetWorkspaceId\);/);
  assert.match(source, /setChatSessionJumpRequest\(\{\s*sessionId: targetSessionId,\s*requestKey: Date\.now\(\),\s*\}\);/);
  assert.match(source, /setChatFocusRequestKey\(\(current\) => current \+ 1\);/);
});

test("app shell exposes a dev-only app update preview hook", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const DEV_APP_UPDATE_PREVIEW_STORAGE_KEY = "holaboss-dev-app-update-preview-v1";/);
  assert.match(source, /type DevAppUpdatePreviewMode = "off" \| "downloading" \| "ready";/);
  assert.match(source, /window\.__holabossDevUpdatePreview = \{/);
  assert.match(source, /downloading: \(\) => updateMode\("downloading"\)/);
  assert.match(source, /ready: \(\) => updateMode\("ready"\)/);
  assert.match(source, /clear: \(\) => updateMode\("off"\)/);
  assert.match(source, /buildDevAppUpdatePreviewStatus\(/);
});

test("app shell uses the integrated title bar path for macOS and Windows", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /const hasIntegratedTitleBar =\s*desktopPlatform === "darwin" \|\| desktopPlatform === "win32";/,
  );
  assert.match(
    source,
    /const titleBarContainerClassName =\s*desktopPlatform === "win32"\s*\?\s*"relative min-w-0 -mx-2 -mt-2 sm:-mx-3 sm:-mt-2.5"/,
  );
  assert.match(
    source,
    /<TopTabsBar[\s\S]*integratedTitleBar=\{hasIntegratedTitleBar\}[\s\S]*desktopPlatform=\{desktopPlatform\}/,
  );
});

test("app shell keeps update toasts inside the safe file pane region instead of suspending the browser", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /const effectiveAppUpdateStatus = useMemo\(/,
  );
  assert.match(
    source,
    /const shouldUseSafeToastAnchor =[\s\S]*!spaceMode \|\| visibleSpacePaneIds\.includes\("files"\)/,
  );
  assert.match(source, /const LEFT_NAVIGATION_RAIL_WIDTH_PX = 60;/);
  assert.match(source, /const APP_SHELL_SPACE_COLUMN_GAP_PX = 8;/);
  assert.match(source, /const FIXED_SAFE_TOAST_REGION_WIDTH_PX =[\s\S]*MIN_FILES_PANE_WIDTH;/);
  assert.match(source, /const anchoredToastStackClassName = shouldUseSafeToastAnchor[\s\S]*absolute bottom-4 left-0/);
  assert.match(source, /const anchoredToastStackStyle = shouldUseSafeToastAnchor[\s\S]*width: FIXED_SAFE_TOAST_REGION_WIDTH_PX/);
  assert.match(
    source,
    /const shouldSuspendBrowserNativeView =\s*isUtilityPaneResizing \|\|[\s\S]*workspaceSwitcherOpen \|\|[\s\S]*settingsDialogOpen \|\|[\s\S]*createWorkspacePanelOpen \|\|[\s\S]*publishOpen;/,
  );
  assert.match(source, /<BrowserPane[\s\S]*suspendNativeView=\{shouldSuspendBrowserNativeView\}/);
});

test("app shell uses a wider minimum for the file explorer than for the browser pane", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const MIN_FILES_PANE_WIDTH = 320;/);
  assert.match(source, /const MIN_BROWSER_PANE_WIDTH = 200;/);
  assert.match(source, /const DEFAULT_FILES_PANE_WIDTH = MIN_FILES_PANE_WIDTH;/);
  assert.match(source, /function utilityPaneMinWidth\(paneId: UtilityPaneId\): number \{/);
});

test("app shell passes the app version label into the left rail", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const appVersionLabel =[\s\S]*effectiveAppUpdateStatus\?\.currentVersion\?\.trim\(\) \|\| "";/);
  assert.match(source, /<LeftNavigationRail[\s\S]*appVersionLabel=\{appVersionLabel\}/);
  assert.doesNotMatch(source, /absolute bottom-3 left-4/);
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
