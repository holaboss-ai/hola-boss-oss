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
});
