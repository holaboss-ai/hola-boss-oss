import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SETTINGS_DIALOG_PATH = new URL("./SettingsDialog.tsx", import.meta.url);

test("settings dialog constrains the stacked layout so the content panel can scroll", async () => {
  const source = await readFile(SETTINGS_DIALOG_PATH, "utf8");

  assert.match(
    source,
    /grid-rows-\[auto_minmax\(0,1fr\)\]/,
    "expected the dialog surface to reserve a shrinkable row for the scrollable content panel",
  );
  assert.match(
    source,
    /h-\[min\(780px,calc\(100vh-32px\)\)\]/,
    "expected the dialog surface to use a fixed viewport-bounded height across tabs",
  );
  assert.doesNotMatch(
    source,
    /max-h-\[min\(780px,calc\(100vh-32px\)\)\]/,
    "expected the dialog surface to stop resizing with tab content",
  );
});

test("settings dialog exposes billing as a first-class navigation section", async () => {
  const source = await readFile(SETTINGS_DIALOG_PATH, "utf8");

  assert.match(source, /id: "billing"/);
  assert.match(source, /label: "Billing"/);
  assert.match(source, /titleForSection\(section: UiSettingsPaneSection\)[\s\S]*case "billing":[\s\S]*return "Billing"/);
  assert.match(source, /activeSection === "billing"/);
});

test("settings dialog sidebar uses compact single-line navigation and theme tokens", async () => {
  const source = await readFile(SETTINGS_DIALOG_PATH, "utf8");

  assert.doesNotMatch(source, /description: "Session and runtime connection"/);
  assert.doesNotMatch(source, /text-\[11px\] leading-5 text-muted-foreground\/62/);
  assert.doesNotMatch(source, /subtitleForSection/);
  assert.doesNotMatch(source, /bg-\[rgba/);
  assert.doesNotMatch(source, /text-\[[0-9]+px\]/);
  assert.match(source, /bg-background/);
  assert.match(source, /bg-sidebar/);
  assert.match(source, /text-sidebar-foreground/);
  assert.match(source, /bg-sidebar-accent/);
  assert.match(source, /border-sidebar-border/);
  assert.doesNotMatch(source, /<aside className="[^"]*bg-muted\/40/);
});

test("settings dialog no longer hosts proactive proposal controls", async () => {
  const source = await readFile(SETTINGS_DIALOG_PATH, "utf8");

  assert.doesNotMatch(source, /Proactive task proposals/);
  assert.doesNotMatch(source, /onProactiveTaskProposalsEnabledChange/);
  assert.doesNotMatch(source, /proactiveTaskProposalsEnabled/);
  assert.doesNotMatch(source, /Loader2/);
});
