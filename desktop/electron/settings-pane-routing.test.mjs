import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PRELOAD_PATH = new URL("./preload.ts", import.meta.url);
const AUTH_POPUP_PRELOAD_PATH = new URL("./authPopupPreload.ts", import.meta.url);
const MAIN_PATH = new URL("./main.ts", import.meta.url);
const APP_SHELL_PATH = new URL("../src/components/layout/AppShell.tsx", import.meta.url);

test("settings pane routing keeps the providers section available across Electron bridges", async () => {
  const [preloadSource, authPopupPreloadSource, mainSource, appShellSource] = await Promise.all([
    readFile(PRELOAD_PATH, "utf8"),
    readFile(AUTH_POPUP_PRELOAD_PATH, "utf8"),
    readFile(MAIN_PATH, "utf8"),
    readFile(APP_SHELL_PATH, "utf8")
  ]);

  assert.match(preloadSource, /type UiSettingsPaneSection = "account" \| "billing" \| "providers" \| "settings" \| "about";/);
  assert.match(authPopupPreloadSource, /type UiSettingsPaneSection = "account" \| "billing" \| "providers" \| "settings" \| "about";/);
  assert.match(mainSource, /type UiSettingsPaneSection =[\s\S]*"account"[\s\S]*"billing"[\s\S]*"providers"[\s\S]*"settings"[\s\S]*"about";/);
  assert.match(appShellSource, /return \([\s\S]*value === "account"[\s\S]*value === "billing"[\s\S]*value === "providers"[\s\S]*value === "settings"[\s\S]*value === "about"[\s\S]*\);/);
});
