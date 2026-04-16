import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_SHELL_PATH = new URL("./AppShell.tsx", import.meta.url);

test("app shell routes file outputs into the explorer and universal display while keeping chat active", async () => {
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
  assert.match(source, /setSpaceExplorerMode\("files"\);/);
  assert.match(source, /setSpaceExplorerCollapsed\(false\);/);
  assert.match(source, /setAgentView\(\{ type: "chat" \}\);/);
  assert.match(
    source,
    /setSpaceDisplayView\(\{\s*type: "internal",\s*surface: target\.surface,\s*resourceId: target\.resourceId,\s*\}\);/
  );
  assert.match(
    source,
    /setFileExplorerFocusRequest\(\{\s*path: target\.resourceId,\s*requestKey: Date\.now\(\),\s*\}\);/
  );
});

test("app shell routes app outputs into the applications explorer and app surface", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const handleOpenSpaceApp = useCallback\(/);
  assert.match(source, /setSpaceExplorerMode\("applications"\);/);
  assert.match(source, /setSpaceExplorerCollapsed\(false\);/);
  assert.match(
    source,
    /setSpaceDisplayView\(\{\s*type: "app",\s*appId,\s*path: options\?\.path,\s*resourceId: options\?\.resourceId,\s*view: options\?\.view,\s*\}\);/,
  );
  assert.match(
    source,
    /if \(target\.type === "app"\) \{\s*handleOpenSpaceApp\(target\.appId,\s*\{\s*path: target\.path,\s*resourceId: target\.resourceId,\s*view: target\.view,\s*resetAgentView: true,\s*\}\);/,
  );
  assert.doesNotMatch(source, /window\.electronAPI\.appSurface\.resolveUrl/);
});

test("app shell restores the last app surface when returning to the applications explorer lane", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /type RestorableSpaceAppDisplayView = Extract<SpaceDisplayView, \{ type: "app" \}>;/,
  );
  assert.match(
    source,
    /const lastRestorableSpaceAppDisplayViewByWorkspaceRef =\s*useRef<\s*Record<string, RestorableSpaceAppDisplayView>\s*>\(\{\}\);/,
  );
  assert.match(
    source,
    /if \(!selectedWorkspaceId \|\| spaceDisplayView\.type !== "app"\) \{\s*return;\s*\}\s*lastRestorableSpaceAppDisplayViewByWorkspaceRef\.current\[\s*selectedWorkspaceId\s*\]\s*=\s*spaceDisplayView;/,
  );
  assert.match(
    source,
    /const restoreLastSpaceAppDisplayView = useCallback\(\(\) => \{\s*if \(!selectedWorkspaceId\) \{\s*setSpaceDisplayView\(\{ type: "browser" \}\);\s*return;\s*\}\s*const lastAppDisplayView =\s*lastRestorableSpaceAppDisplayViewByWorkspaceRef\.current\[\s*selectedWorkspaceId\s*\];\s*if \(lastAppDisplayView\) \{\s*setSpaceDisplayView\(lastAppDisplayView\);\s*return;\s*\}\s*setSpaceDisplayView\(spaceDisplayView\);\s*\}, \[selectedWorkspaceId, spaceDisplayView\]\);/,
  );
  assert.match(
    source,
    /if \(mode === "browser"\) \{\s*setSpaceDisplayView\(\{\s*type: "browser",\s*\}\);\s*\} else if \(mode === "applications"\) \{\s*restoreLastSpaceAppDisplayView\(\);\s*\} else \{\s*restoreLastSpaceFileDisplayView\(\);\s*\}/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => \{\s*setSpaceExplorerMode\("applications"\);\s*restoreLastSpaceAppDisplayView\(\);\s*setSpaceExplorerCollapsed\(false\);\s*\}\}/,
  );
});

test("app shell opens the centered add apps dialog from the applications explorer", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /import \{ WorkspaceAppsDialog \} from "@\/components\/layout\/WorkspaceAppsDialog";/);
  assert.match(
    source,
    /const \[workspaceAppsDialogOpen, setWorkspaceAppsDialogOpen\] =\s*useState\(false\);/,
  );
  assert.match(
    source,
    /const handleAddApp = \(\) => \{\s*setWorkspaceAppsDialogOpen\(true\);\s*\};/,
  );
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(selectedWorkspaceId\) \{\s*return;\s*\}\s*setWorkspaceAppsDialogOpen\(false\);\s*\}, \[selectedWorkspaceId\]\);/,
  );
  assert.match(
    source,
    /<SpaceApplicationsExplorerPane[\s\S]*onAddApp=\{handleAddApp\}/,
  );
  assert.match(
    source,
    /<WorkspaceAppsDialog[\s\S]*open=\{workspaceAppsDialogOpen\}[\s\S]*onClose=\{\(\) => setWorkspaceAppsDialogOpen\(false\)\}/,
  );
  assert.match(
    source,
    /const shouldSuspendBrowserNativeView =\s*[\s\S]*workspaceAppsDialogOpen[\s\S]*createWorkspacePanelOpen[\s\S]*publishOpen;/,
  );
  assert.doesNotMatch(
    source,
    /const handleAddApp = \(\) => \{\s*handleOpenMarketplace\("apps"\);\s*\};/,
  );
});

test("app shell passes the current app version into the settings dialog", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /<SettingsDialog[\s\S]*appVersion=\{effectiveAppUpdateStatus\?\.currentVersion \|\| ""\}/,
  );
});

test("app shell clears a consumed file explorer focus request", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /<FileExplorerPane[\s\S]*focusRequest=\{fileExplorerFocusRequest\}/);
  assert.match(source, /<FileExplorerPane[\s\S]*previewInPane=\{false\}/);
  assert.match(
    source,
    /onFileOpen=\{\(path\) => \{\s*setSpaceDisplayView\(\{\s*type: "internal",\s*surface: "file",\s*resourceId: path,\s*\}\);/
  );
  assert.match(
    source,
    /onFocusRequestConsumed=\{\(requestKey\) => \{\s*setFileExplorerFocusRequest\(\(current\) =>\s*current\?\.requestKey === requestKey \? null : current,\s*\);\s*\}\}/
  );
});

test("app shell syncs file-oriented agent operations into the explorer and display", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /const handleSyncAgentOperationFileDisplay = useCallback\(\s*\(path: string\) => \{/,
  );
  assert.match(source, /const targetPath = path\.trim\(\);/);
  assert.match(source, /setSpaceExplorerMode\("files"\);/);
  assert.match(source, /setSpaceExplorerCollapsed\(false\);/);
  assert.match(
    source,
    /setSpaceDisplayView\(\{\s*type: "internal",\s*surface: "file",\s*resourceId: targetPath,\s*\}\);/,
  );
  assert.match(
    source,
    /setFileExplorerFocusRequest\(\{\s*path: targetPath,\s*requestKey: Date\.now\(\),\s*\}\);/,
  );
  assert.match(
    source,
    /<OnboardingPane[\s\S]*onSyncFileDisplayFromAgentOperation=\{\s*handleSyncAgentOperationFileDisplay\s*\}/,
  );
  assert.match(
    source,
    /<ChatPane[\s\S]*onSyncFileDisplayFromAgentOperation=\{\s*handleSyncAgentOperationFileDisplay\s*\}/,
  );
});

test("app shell restores the last internal display and otherwise keeps the current display when returning to files mode", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /type RestorableSpaceFileDisplayView = Extract<\s*SpaceDisplayView,\s*\{ type: "internal" \}\s*>;/,
  );
  assert.match(
    source,
    /const lastRestorableSpaceFileDisplayViewByWorkspaceRef =\s*useRef<\s*Record<string, RestorableSpaceFileDisplayView>\s*>\(\{\}\);/,
  );
  assert.match(
    source,
    /const syncFileExplorerFocusWithDisplayView = useCallback\(\s*\(displayView: SpaceDisplayView \| null\) => \{/,
  );
  assert.match(
    source,
    /if \(displayView\?\.type !== "internal"\) \{\s*return;\s*\}/,
  );
  assert.match(
    source,
    /\(displayView\.surface === "document" \|\| displayView\.surface === "file"\)\s*&&\s*displayView\.resourceId\?\.trim\(\)/,
  );
  assert.match(
    source,
    /setFileExplorerFocusRequest\(\{\s*path: displayView\.resourceId,\s*requestKey: Date\.now\(\),\s*\}\);/,
  );
  assert.match(
    source,
    /\},\s*\[\]\s*\);/,
  );
  assert.match(
    source,
    /if \(!selectedWorkspaceId \|\| spaceDisplayView\.type !== "internal"\) \{\s*return;\s*\}\s*lastRestorableSpaceFileDisplayViewByWorkspaceRef\.current\[\s*selectedWorkspaceId\s*\]\s*=\s*spaceDisplayView;/,
  );
  assert.match(
    source,
    /const restoreLastSpaceFileDisplayView = useCallback\(\(\) => \{\s*if \(!selectedWorkspaceId\) \{\s*setSpaceDisplayView\(\{ type: "browser" \}\);\s*return;\s*\}\s*const lastDisplayView =\s*lastRestorableSpaceFileDisplayViewByWorkspaceRef\.current\[\s*selectedWorkspaceId\s*\];\s*const nextDisplayView = lastDisplayView \?\? spaceDisplayView;\s*setSpaceDisplayView\(nextDisplayView\);\s*syncFileExplorerFocusWithDisplayView\(nextDisplayView\);\s*\}, \[selectedWorkspaceId, spaceDisplayView, syncFileExplorerFocusWithDisplayView\]\);/,
  );
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(!selectedWorkspaceId\) \{\s*setSpaceExplorerMode\("browser"\);\s*setSpaceDisplayView\(\{ type: "browser" \}\);\s*return;\s*\}\s*const nextDisplayView =\s*lastRestorableSpaceFileDisplayViewByWorkspaceRef\.current\[\s*selectedWorkspaceId\s*\];\s*if \(!nextDisplayView\) \{\s*setSpaceExplorerMode\("browser"\);\s*setSpaceDisplayView\(\{ type: "browser" \}\);\s*return;\s*\}\s*setSpaceDisplayView\(nextDisplayView\);\s*syncFileExplorerFocusWithDisplayView\(nextDisplayView\);\s*\}, \[selectedWorkspaceId, syncFileExplorerFocusWithDisplayView\]\);/,
  );
  assert.match(
    source,
    /onValueChange=\{\(value\) => \{\s*const mode = value as SpaceExplorerMode;\s*setSpaceExplorerMode\(mode\);\s*if \(mode === "browser"\) \{\s*setSpaceDisplayView\(\{\s*type: "browser",\s*\}\);\s*\} else if \(mode === "applications"\) \{\s*restoreLastSpaceAppDisplayView\(\);\s*\} else \{\s*restoreLastSpaceFileDisplayView\(\);\s*\}\s*\}\}/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => \{\s*setSpaceExplorerMode\("files"\);\s*restoreLastSpaceFileDisplayView\(\);\s*setSpaceExplorerCollapsed\(false\);\s*\}\}/,
  );
});

test("app shell removes the outputs quick action", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.doesNotMatch(source, /aria-label="Open outputs panel"/);
});

test("app shell treats missing or stopped runtime states as startup blockers", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /function runtimeStartupBlockedMessage\(\s*runtimeStatus: RuntimeStatusPayload \| null,\s*fallbackMessage = "",\s*\)/,
  );
  assert.match(source, /if \(runtimeStatus\.status === "missing"\) \{/);
  assert.match(source, /if \(runtimeStatus\.status === "stopped"\) \{/);
  assert.match(
    source,
    /const runtimeStartupBlockedDetail = runtimeStartupBlockedMessage\(\s*runtimeStatus,\s*workspaceBlockingReason \|\| workspaceErrorMessage,\s*\);/,
  );
  assert.match(
    source,
    /const bootstrapErrorMessage =\s*!hasHydratedWorkspaceList\s*\?\s*runtimeStartupBlockedMessage\(runtimeStatus, workspaceErrorMessage\)\s*:\s*"";/,
  );
  assert.match(
    source,
    /const hydratedRuntimeErrorMessage =\s*hasHydratedWorkspaceList &&\s*runtimeStartupBlockedDetail &&\s*\(!hasWorkspaces \|\| !workspaceAppsReady\)\s*\?\s*runtimeStartupBlockedDetail\s*:\s*"";/,
  );
  assert.match(
    source,
    /\) : hydratedRuntimeErrorMessage \? \(\s*<WorkspaceStartupErrorPane message=\{hydratedRuntimeErrorMessage\} \/>\s*\) : !hasWorkspaces \? \(/,
  );
});

test("app shell polls runtime notifications and renders the toast stack", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /window\.electronAPI\.workspace\.listNotifications\(\s*null\s*\)/);
  assert.match(source, /<NotificationToastStack[\s\S]*leadingToast=\{/);
  assert.match(source, /const effectiveToastNotifications = useMemo\(/);
  assert.match(source, /<NotificationToastStack[\s\S]*notifications=\{effectiveToastNotifications\}/);
  assert.match(source, /<NotificationToastStack[\s\S]*onCloseToast=\{\(notificationId\) => \{\s*void handleCloseDisplayedNotification\(notificationId\);\s*\}\}/);
  assert.doesNotMatch(source, /className=\{anchoredToastStackClassName\}/);
  assert.doesNotMatch(source, /style=\{anchoredToastStackStyle\}/);
  assert.match(source, /const runtimeNotificationById = useMemo\(/);
  assert.doesNotMatch(source, /notificationToastTimeoutsRef/);
  assert.doesNotMatch(source, /notificationToastDurationMs/);
  assert.doesNotMatch(source, /window\.setTimeout\(\(\) => \{\s*dismissNotificationToast\(item\.id\);/);
});

test("app shell keeps desktop updates separate from runtime notification state", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /function appUpdateChangelogUrl\(/);
  assert.match(source, /const handleDismissUpdate = useCallback\(/);
  assert.match(source, /void window\.electronAPI\.appUpdate\.dismiss\(/);
  assert.match(source, /void window\.electronAPI\.ui\.openExternalUrl\(changelogUrl\);/);
  assert.doesNotMatch(source, /combinedNotifications/);
  assert.doesNotMatch(source, /syntheticNotificationStates/);
  assert.match(source, /<SpaceBrowserDisplayPane[\s\S]*suspendNativeView=\{shouldSuspendBrowserNativeView\}/);
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

test("app shell exposes a dev-only notification toast preview hook", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const DEV_NOTIFICATION_TOAST_PREVIEW_ID_PREFIX =\s*"dev-notification-toast-preview:";/);
  assert.match(source, /function buildDevNotificationToastPreviewNotifications\(/);
  assert.match(source, /window\.__holabossDevNotificationToastPreview = \{/);
  assert.match(source, /stack: \(\) => showDevNotificationToastPreview\(\)/);
  assert.match(source, /clear: \(\) => clearDevNotificationToastPreview\(\)/);
  assert.match(source, /if \(isDevNotificationToastPreviewId\(notificationId\)\) \{/);
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

test("app shell no longer reserves a separate safe pane region for update toasts", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /const effectiveAppUpdateStatus = useMemo\(/,
  );
  assert.match(
    source,
    /const shouldShowAppUpdateReminder = Boolean\(\s*effectiveAppUpdateStatus &&\s*effectiveAppUpdateStatus\.downloaded,\s*\);/,
  );
  assert.doesNotMatch(source, /shouldUseSafeToastAnchor/);
  assert.doesNotMatch(source, /LEFT_NAVIGATION_RAIL_WIDTH_PX/);
  assert.doesNotMatch(source, /APP_SHELL_SPACE_COLUMN_GAP_PX/);
  assert.doesNotMatch(source, /FIXED_SAFE_TOAST_REGION_WIDTH_PX/);
  assert.doesNotMatch(source, /anchoredToastStackClassName/);
  assert.doesNotMatch(source, /anchoredToastStackStyle/);
  assert.match(
    source,
    /const shouldSuspendBrowserNativeView =\s*isUtilityPaneResizing \|\|[\s\S]*workspaceSwitcherOpen \|\|[\s\S]*settingsDialogOpen \|\|[\s\S]*createWorkspacePanelOpen \|\|[\s\S]*publishOpen;/,
  );
  assert.match(source, /<SpaceBrowserDisplayPane[\s\S]*suspendNativeView=\{shouldSuspendBrowserNativeView\}/);
});

test("app shell keeps a fixed explorer width and resizes the display against chat in space mode", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const MIN_FILES_PANE_WIDTH = 260;/);
  assert.match(source, /const MIN_BROWSER_PANE_WIDTH = 120;/);
  assert.match(source, /const MIN_AGENT_CONTENT_WIDTH = 380;/);
  assert.match(source, /const DEFAULT_FILES_PANE_WIDTH = MIN_FILES_PANE_WIDTH;/);
  assert.match(source, /const SPACE_EXPLORER_WIDTH = DEFAULT_FILES_PANE_WIDTH;/);
  assert.match(source, /const SPACE_AGENT_PANE_WIDTH = 420;/);
  assert.match(source, /const SPACE_DISPLAY_MIN_WIDTH = 420;/);
  assert.match(source, /const SPACE_EXPLORER_COLLAPSED_WIDTH = 68;/);
  assert.match(
    source,
    /const \[spaceAgentPaneWidth, setSpaceAgentPaneWidth\] = useState\(\s*SPACE_AGENT_PANE_WIDTH,\s*\);/,
  );
  assert.match(
    source,
    /const clampSpaceAgentPaneWidth = useCallback\(\s*\(width: number\) => \{/,
  );
  assert.match(
    source,
    /const explorerWidth = spaceExplorerCollapsed\s*\?\s*SPACE_EXPLORER_COLLAPSED_WIDTH\s*:\s*filesPaneWidth;/,
  );
  assert.match(
    source,
    /hostWidth -\s*explorerWidth -\s*SPACE_DISPLAY_MIN_WIDTH -\s*UTILITY_PANE_RESIZER_WIDTH/,
  );
  assert.match(source, /new ResizeObserver\(\(\) => \{\s*syncDisplayWidth\(\);\s*\}\)/);
});

test("app shell always opens the file explorer at minimum width", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /const \[filesPaneWidth, setFilesPaneWidth\] = useState\(\s*DEFAULT_FILES_PANE_WIDTH,\s*\);/,
  );
  assert.match(
    source,
    /width: `\$\{showSpaceExplorer \? SPACE_EXPLORER_WIDTH : SPACE_EXPLORER_COLLAPSED_WIDTH\}px`,/,
  );
  assert.doesNotMatch(source, /function loadFilesPaneWidth\(\): number \{/);
  assert.doesNotMatch(source, /holaboss-files-pane-width-v1/);
});

test("app shell uses the top toolbar for shell navigation and removes the left rail", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /type ShellView = "space";/);
  assert.match(source, /const \[activeShellView, setActiveShellView\] = useState<ShellView>\("space"\);/);
  assert.match(source, /<SettingsDialog[\s\S]*onOpenAutomationRunSession=\{\(workspaceId, sessionId\) => \{/);
  assert.match(source, /<SettingsDialog[\s\S]*onCreateAutomationSchedule=\{\(workspaceId\) => \{/);
  assert.match(source, /<SettingsDialog[\s\S]*onEditAutomationSchedule=\{\(workspaceId, job\) => \{/);
  assert.match(source, /setSettingsDialogOpen\(false\);[\s\S]*handleOpenAutomationRunSession\(sessionId, workspaceId\);/);
  assert.match(source, /setSettingsDialogOpen\(false\);[\s\S]*handleCreateScheduleInChat\(workspaceId\);/);
  assert.match(source, /setSettingsDialogOpen\(false\);[\s\S]*handleEditScheduleInChat\(job, workspaceId\);/);
  assert.doesNotMatch(source, /handleOpenMarketplace/);
  assert.doesNotMatch(source, /MarketplacePane/);
  assert.doesNotMatch(source, /activeShellView === "marketplace"/);
  assert.doesNotMatch(source, /handleOpenSpace = useCallback/);
  assert.doesNotMatch(source, /onOpenSpace=\{handleOpenSpace\}/);
  assert.doesNotMatch(source, /isSpaceActive=\{spaceMode\}/);
  assert.doesNotMatch(source, /handleOpenAutomations/);
  assert.doesNotMatch(source, /activeShellView === "automations"/);
  assert.doesNotMatch(source, /LeftNavigationRail/);
});

test("app shell no longer renders the dedicated app mode after removing the left rail", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.doesNotMatch(source, /activeShellView === "app"/);
  assert.doesNotMatch(source, /handleOpenInstalledApp/);
  assert.doesNotMatch(source, /Choose an app/);
  assert.doesNotMatch(source, /left rail/);
});

test("app shell requests remote task proposal generation without a separate success banner", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /requestRemoteTaskProposalGeneration\(/);
  assert.match(source, /Suggestions are unavailable right now\./);
  assert.doesNotMatch(source, /Remote heartbeat accepted/);
  assert.doesNotMatch(source, /Pending cloud jobs/);
});

test("app shell raises a local toast when fresh task proposals arrive and opens the inbox from it", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const TASK_PROPOSAL_TOAST_ID_PREFIX = "task-proposal-toast:";/);
  assert.match(source, /function buildTaskProposalToastNotification\(/);
  assert.match(
    source,
    /const \[taskProposalToastNotifications,\s*setTaskProposalToastNotifications\] =\s*useState<\s*RuntimeNotificationRecordPayload\[\]\s*>\(\[\]\);/,
  );
  assert.match(
    source,
    /const knownTaskProposalIdsByWorkspaceRef = useRef<Record<string, string\[]>>\(\s*\{\s*\},?\s*\);/,
  );
  assert.match(source, /const applyTaskProposals = useCallback\(/);
  assert.match(source, /const pendingNewProposals = proposals\.filter\(\(proposal\) => \{/);
  assert.match(
    source,
    /return isNew && proposal\.state\.trim\(\)\.toLowerCase\(\) === "pending";/,
  );
  assert.match(
    source,
    /setTaskProposalToastNotifications\(\(current\) =>\s*\[toast, \.\.\.current\]\.slice\(0, 4\),?\s*\)\s*;/,
  );
  assert.match(source, /if \(isTaskProposalToastId\(notificationId\)\) \{/);
  assert.match(source, /openTaskProposalInbox\(notification\.workspace_id\);/);
});

test("app shell tracks unread task proposals and badges the inbox control", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const TASK_PROPOSAL_SEEN_STORAGE_KEY = "holaboss-task-proposal-seen-v1";/);
  assert.match(source, /const \[seenTaskProposalIdsByWorkspace, setSeenTaskProposalIdsByWorkspace\] =\s*useState<Record<string, string\[]>>\(loadSeenTaskProposalIdsByWorkspace\);/);
  assert.match(source, /const unreadTaskProposalCount = useMemo\(\(\) => \{/);
  assert.match(source, /const markTaskProposalsSeen = useCallback\(/);
  assert.match(
    source,
    /if \(\s*agentView\.type !== "inbox" \|\|\s*!selectedWorkspaceId \|\|\s*taskProposals.length === 0\s*\) \{\s*return;\s*\}\s*markTaskProposalsSeen\(selectedWorkspaceId, taskProposals\);/,
  );
  assert.match(source, /if \(tab === "inbox" && selectedWorkspaceId\) \{\s*markTaskProposalsSeen\(selectedWorkspaceId, taskProposals\);\s*\}/);
  assert.match(source, /const handleOpenInboxPane = useCallback\(\(\) => \{/);
  assert.match(source, /setAgentView\(\{ type: "inbox" \}\);/);
  assert.match(source, /inboxUnreadCount=\{unreadTaskProposalCount\}/);
  assert.match(source, /onOpenInbox=\{handleOpenInboxPane\}/);
  assert.doesNotMatch(source, /unreadProposalCount=\{unreadTaskProposalCount\}/);
  assert.doesNotMatch(source, /aria-label="Open inbox"/);
});

test("app shell renders a collapsible explorer and universal display in space mode", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /function loadSpaceVisibility\(\): SpaceVisibilityState \{/);
  assert.match(source, /localStorage\.getItem\(SPACE_VISIBILITY_STORAGE_KEY\)/);
  assert.match(
    source,
    /if \(parsed && typeof parsed === "object" && !Array\.isArray\(parsed\)\) \{\s*return \{\s*agent: true,\s*files: true,\s*browser: true,\s*\};/,
  );
  assert.doesNotMatch(source, /const toggleUtilityPaneVisibility = useCallback\(\(paneId: UtilityPaneId\) => \{/);
  assert.doesNotMatch(source, /className="mr-1\.5 flex w-9 shrink-0 flex-col items-center gap-1\.5 py-1"/);
  assert.doesNotMatch(source, /aria-label="Toggle files pane"/);
  assert.doesNotMatch(source, /aria-label="Toggle browser pane"/);
  assert.match(source, /type SpaceExplorerMode = "files" \| "browser" \| "applications";/);
  assert.match(source, /const \[spaceExplorerMode, setSpaceExplorerMode\] =\s*useState<SpaceExplorerMode>\("files"\);/);
  assert.match(source, /const \[spaceExplorerCollapsed, setSpaceExplorerCollapsed\] = useState\(false\);/);
  assert.match(source, /const \[spaceDisplayView, setSpaceDisplayView\] = useState<SpaceDisplayView>\(\{\s*type: "browser",\s*\}\);/);
  assert.match(
    source,
    /<section className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card\/80 shadow-md backdrop-blur-sm">/,
  );
  assert.match(source, /<FileExplorerPane[\s\S]*focusRequest=\{fileExplorerFocusRequest\}/);
  assert.match(source, /<FileExplorerPane[\s\S]*onOpenLinkInBrowser=\{handleOpenLinkInNewAppBrowserTab\}/);
  assert.match(source, /<FileExplorerPane[\s\S]*previewInPane=\{false\}/);
  assert.match(source, /<InternalSurfacePane[\s\S]*onOpenLinkInBrowser=\{handleOpenLinkInNewAppBrowserTab\}/);
  assert.match(source, /<SpaceApplicationsExplorerPane[\s\S]*installedApps=\{installedApps\}/);
  assert.match(source, /<SpaceApplicationsExplorerPane[\s\S]*onAddApp=\{handleAddApp\}/);
  assert.match(source, /<SpaceBrowserExplorerPane[\s\S]*browserSpace=\{spaceBrowserSpace\}/);
  assert.match(source, /<SpaceBrowserDisplayPane[\s\S]*layoutSyncKey=\{spaceDisplayLayoutSyncKey\}/);
  assert.match(source, /<SpaceBrowserDisplayPane[\s\S]*embedded/);
  assert.match(
    source,
    /aria-label="Open file explorer"[\s\S]*aria-label="Open browser explorer"[\s\S]*aria-label="Open applications explorer"/,
  );
  assert.match(source, /aria-label="Open applications explorer"/);
  assert.match(source, /aria-label="Collapse explorer"/);
  assert.match(source, /aria-label="Expand explorer"/);
  assert.match(source, /aria-label="Resize display pane"/);
  assert.doesNotMatch(source, /aria-label="Resize explorer pane"/);
  assert.doesNotMatch(source, /inline-flex h-8 items-center gap-2 rounded-full border px-3/);
  assert.doesNotMatch(source, /spaceDrawerToggleLabel/);
  assert.doesNotMatch(source, /utilityPaneRenderWidth/);
});

test("app shell routes agent-originated browser opens into the agent browser space", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const targetBrowserSpace =\s*payload\.space === "agent" \? "agent" : "user";/);
  assert.match(source, /\.setActiveWorkspace\(\s*payload\.workspaceId \?\? selectedWorkspaceId \?\? null,\s*targetBrowserSpace,\s*\)/);
  assert.match(source, /\.setActiveWorkspace\(targetWorkspaceId, "user"\)/);
  assert.match(source, /const handleOpenLinkInNewAppBrowserTab = useCallback\(/);
  assert.match(source, /\.then\(\(\) => window\.electronAPI\.browser\.newTab\(normalizedUrl\)\)/);
});

test("app shell reports active non-browser operator surfaces back to Electron", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /type ReportedOperatorSurfaceContext = \{/);
  assert.match(source, /function buildReportedOperatorSurfaceContext\(params: \{/);
  assert.match(source, /surface_id: `editor:\$\{params\.owner\}:\$\{resourceId\}`/);
  assert.match(source, /surface_type: "editor"/);
  assert.match(source, /surface_type: "app_surface"/);
  assert.match(source, /const reportedOperatorSurfaceWorkspaceIdRef = useRef<string \| null>\(null\);/);
  assert.match(source, /const reportedOperatorSurfaceContext = useMemo\(/);
  assert.match(source, /window\.electronAPI\.workspace\.setOperatorSurfaceContext\(\s*previousWorkspaceId,\s*null,\s*\)/);
  assert.match(source, /window\.electronAPI\.workspace\.setOperatorSurfaceContext\(\s*nextWorkspaceId,\s*reportedOperatorSurfaceContext,\s*\)/);
});

test("app shell polls proactive status for the selected workspace", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const \[proactiveStatus, setProactiveStatus\]/);
  assert.match(source, /workspace\.getProactiveStatus\(\s*selectedWorkspace\.id,/);
  assert.match(source, /runtimeConfig\?\.authTokenPresent/);
  assert.match(source, /runtimeConfig\?\.modelProxyBaseUrl/);
  assert.match(source, /runtimeStatus\?\.status/);
  assert.match(source, /<OperationsInboxPane[\s\S]*proactiveStatus=\{proactiveStatus\}/);
  assert.match(source, /<OperationsInboxPane[\s\S]*isLoadingProactiveStatus=\{isLoadingProactiveStatus\}/);
});

test("app shell reloads proactive preference after workspace hydration completes", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /if \(!hasHydratedWorkspaceList\) \{\s*return;\s*\}/);
  assert.match(source, /workspace\.getProactiveTaskProposalPreference\(\)/);
  assert.match(source, /\}, \[hasHydratedWorkspaceList, selectedWorkspaceId\]\);/);
});

test("app shell keeps polling task proposals even when proactive auth preferences are unavailable", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /workspace\.listTaskProposals\(\s*selectedWorkspace\.id,/);
  assert.doesNotMatch(source, /if \(!hasLoadedProactiveTaskProposalsPreference\) \{\s*setIsLoadingTaskProposals\(false\);\s*return;\s*\}/);
  assert.doesNotMatch(source, /if \(!proactiveTaskProposalsEnabled\) \{\s*setIsLoadingTaskProposals\(false\);\s*return;\s*\}/);
  assert.match(source, /\}, \[selectedWorkspace, selectedWorkspaceId\]\);/);
});

test("app shell no longer renders a separate right panel in space mode", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const showOperationsDrawer = false;/);
  assert.match(source, /const mainGridClassName = appShellMainGridClassName\(\{/);
  assert.doesNotMatch(source, /lg:grid-cols-\[60px_minmax\(0,1fr\)_336px\]/);
  assert.doesNotMatch(source, /<OperationsDrawer(?:\s|>)/);
  assert.doesNotMatch(source, /aria-label="Open inbox panel"/);
  assert.doesNotMatch(source, /aria-label="Open sessions panel"/);
  assert.doesNotMatch(source, /aria-label="Show right panel"/);
  assert.doesNotMatch(source, /aria-label="Hide right panel"/);
});

test("app shell can route new schedule creation into a prefilled workspace chat", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /type ChatComposerPrefillRequest = \{\s*text: string;\s*requestKey: number;\s*mode\?: "replace" \| "append";\s*\};/);
  assert.match(source, /const \[chatComposerPrefillRequest, setChatComposerPrefillRequest\] =\s*useState<ChatComposerPrefillRequest \| null>\(null\);/);
  assert.match(source, /const chatSessionOpenRequestKeyRef = useRef\(0\);/);
  assert.match(source, /const chatComposerPrefillRequestKeyRef = useRef\(0\);/);
  assert.match(source, /const nextChatSessionOpenRequestKey = useCallback\(\(\) => \{\s*chatSessionOpenRequestKeyRef\.current \+= 1;\s*return chatSessionOpenRequestKeyRef\.current;\s*\}, \[\]\);/);
  assert.match(source, /const nextChatComposerPrefillRequestKey = useCallback\(\(\) => \{\s*chatComposerPrefillRequestKeyRef\.current \+= 1;\s*return chatComposerPrefillRequestKeyRef\.current;\s*\}, \[\]\);/);
  assert.match(source, /const handleCreateScheduleInChat = useCallback\(\(\s*workspaceId\?: string \| null\) => \{/);
  assert.match(source, /const normalizedWorkspaceId =\s*workspaceId\?\.trim\(\) \|\| selectedWorkspaceId\?\.trim\(\) \|\| "";/);
  assert.match(source, /if \(normalizedWorkspaceId !== \(selectedWorkspaceId\?\.trim\(\) \|\| ""\)\) \{\s*setSelectedWorkspaceId\(normalizedWorkspaceId\);\s*\}/);
  assert.match(source, /setActiveShellView\("space"\);/);
  assert.match(source, /setSpaceVisibility\(\(previous\) => \(\{\s*\.\.\.previous,\s*agent: true,\s*\}\)\);/);
  assert.match(source, /setAgentView\(\{ type: "chat" \}\);/);
  assert.match(source, /setChatSessionJumpRequest\(null\);/);
  assert.match(source, /setChatSessionOpenRequest\(\{\s*sessionId: "",\s*mode: "draft",\s*parentSessionId: null,\s*requestKey: nextChatSessionOpenRequestKey\(\),\s*\}\);/);
  assert.match(source, /setChatComposerPrefillRequest\(\{\s*text: "Create a cronjob for ",\s*requestKey: nextChatComposerPrefillRequestKey\(\),\s*mode: "replace",\s*\}\);/);
  assert.match(source, /composerPrefillRequest=\{chatComposerPrefillRequest\}/);
  assert.match(source, /onComposerPrefillConsumed=\{handleChatComposerPrefillConsumed\}/);
  assert.match(source, /onCreateAutomationSchedule=\{\(workspaceId\) => \{/);
  assert.match(source, /handleCreateScheduleInChat\(workspaceId\);/);
});

test("app shell can route schedule edits into a prefilled workspace chat", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const handleEditScheduleInChat = useCallback\(\(\s*job: CronjobRecordPayload,\s*workspaceId\?: string \| null,\s*\) => \{/);
  assert.match(source, /const jobName =\s*job\.name\?\.trim\(\) \|\| job\.description\?\.trim\(\) \|\| "Untitled schedule";/);
  assert.match(source, /const instruction = job\.instruction\?\.trim\(\) \|\| job\.description\?\.trim\(\) \|\| "";/);
  assert.match(source, /Edit cronjob "\$\{jobName\}" \(id: \$\{job\.id\}\)\. Current cron: \$\{job\.cron\}\./);
  assert.match(source, /Current instruction: \$\{instruction\}\\n\\nUpdate it to:/);
  assert.match(source, /mode: "replace"/);
  assert.match(source, /onEditAutomationSchedule=\{\(workspaceId, job\) => \{/);
  assert.match(source, /handleEditScheduleInChat\(job, workspaceId\);/);
});

test("app shell can route explorer references into chat attachments or text prefills", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /type ChatExplorerAttachmentRequest = \{\s*files: ExplorerAttachmentDragPayload\[];\s*requestKey: number;\s*\};/,
  );
  assert.match(
    source,
    /const \[chatExplorerAttachmentRequest, setChatExplorerAttachmentRequest\] =\s*useState<ChatExplorerAttachmentRequest \| null>\(null\);/,
  );
  assert.match(
    source,
    /const handleReferenceWorkspacePathInChat = useCallback\(\s*\(entry: LocalFileEntry, referenceText: string\) => \{/,
  );
  assert.match(source, /const normalizedReferenceText = referenceText\.trim\(\);/);
  assert.match(source, /const normalizedAbsolutePath = entry\.absolutePath\.trim\(\);/);
  assert.match(source, /const normalizedName = entry\.name\.trim\(\);/);
  assert.match(
    source,
    /if \(\s*\(entry\.isDirectory && !normalizedReferenceText\) \|\|\s*\(!entry\.isDirectory && \(!normalizedAbsolutePath \|\| !normalizedName\)\)\s*\) \{\s*return;\s*\}/,
  );
  assert.match(source, /setActiveShellView\("space"\);/);
  assert.match(source, /setSpaceVisibility\(\(previous\) => \(\{\s*\.\.\.previous,\s*agent: true,\s*\}\)\);/);
  assert.match(source, /setAgentView\(\{ type: "chat" \}\);/);
  assert.match(
    source,
    /if \(entry\.isDirectory\) \{\s*setChatComposerPrefillRequest\(\{\s*text: normalizedReferenceText,\s*requestKey: nextChatComposerPrefillRequestKey\(\),\s*mode: "append",\s*\}\);\s*\} else \{\s*setChatExplorerAttachmentRequest\(\{\s*files: \[\s*\{\s*absolutePath: normalizedAbsolutePath,\s*name: normalizedName,\s*size: Number\.isFinite\(entry\.size\) \? Math\.max\(0, entry\.size\) : 0,\s*\},\s*\],\s*requestKey: nextChatExplorerAttachmentRequestKey\(\),\s*\}\);\s*\}/,
  );
  assert.match(source, /setChatFocusRequestKey\(\(current\) => current \+ 1\);/);
  assert.match(
    source,
    /explorerAttachmentRequest=\{chatExplorerAttachmentRequest\}/,
  );
  assert.match(
    source,
    /onExplorerAttachmentRequestConsumed=\{\s*handleChatExplorerAttachmentRequestConsumed\s*\}/,
  );
  assert.match(source, /<FileExplorerPane[\s\S]*onReferenceInChat=\{handleReferenceWorkspacePathInChat\}/);
});

test("app shell passes new session requests into the chat pane selector", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /type ChatSessionOpenRequest = \{\s*sessionId: string;\s*requestKey: number;\s*mode\?: "session" \| "draft";\s*parentSessionId\?: string \| null;\s*\};/);
  assert.match(
    source,
    /const handleCreateSession = useCallback\(\s*\(request\?: \{\s*sessionId: string;\s*mode\?: "session" \| "draft";\s*parentSessionId\?: string \| null;\s*requestKey: number;\s*\}\) => \{/,
  );
  assert.match(source, /const handleChatSessionOpenRequestConsumed = useCallback\(\s*\(requestKey: number\) => \{/);
  assert.match(source, /setChatSessionOpenRequest\(\(current\) =>\s*current\?\.requestKey === requestKey \? null : current,\s*\);/);
  assert.match(
    source,
    /setChatSessionOpenRequest\(\s*request \?\? \{\s*sessionId: "",\s*mode: "draft",\s*parentSessionId: null,\s*requestKey: nextChatSessionOpenRequestKey\(\),\s*\},\s*\);/,
  );
  assert.match(source, /setChatFocusRequestKey\(\(current\) => current \+ 1\);/);
  assert.doesNotMatch(source, /const \[isCreatingSession, setIsCreatingSession\] = useState\(false\);/);
  assert.doesNotMatch(source, /window\.electronAPI\.workspace\.createAgentSession\(\{/);
  assert.match(source, /const handleReturnToChatPane = useCallback\(\(\) => \{/);
  assert.match(source, /aria-label="Return to chat"/);
  assert.match(source, /<OperationsInboxPane[\s\S]*proposals=\{taskProposals\}/);
  assert.match(
    source,
    /onRequestCreateSession=\{\(request\) => void handleCreateSession\(request\)\}/,
  );
  assert.match(source, /onSessionOpenRequestConsumed=\{handleChatSessionOpenRequestConsumed\}/);
});

test("app shell keeps session-open request keys monotonic after requests are consumed", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /const chatSessionOpenRequestKeyRef = useRef\(0\);/);
  assert.match(source, /const nextChatSessionOpenRequestKey = useCallback\(\(\) => \{\s*chatSessionOpenRequestKeyRef\.current \+= 1;\s*return chatSessionOpenRequestKeyRef\.current;\s*\}, \[\]\);/);
  assert.match(source, /setChatSessionOpenRequest\(\{\s*sessionId: normalizedSessionId,\s*mode: "session",\s*requestKey: nextChatSessionOpenRequestKey\(\),\s*\}\);/);
  assert.doesNotMatch(source, /setChatSessionOpenRequest\(\(previous\) => \(\{\s*sessionId: normalizedSessionId,\s*mode: "session",\s*requestKey: \(previous\?\.requestKey \?\? 0\) \+ 1,\s*\}\)\);/);
});
