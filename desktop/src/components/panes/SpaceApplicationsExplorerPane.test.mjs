import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SPACE_APPLICATIONS_EXPLORER_PANE_PATH = new URL(
  "./SpaceApplicationsExplorerPane.tsx",
  import.meta.url,
);

test("space applications explorer renders the add app action in the header", async () => {
  const source = await readFile(SPACE_APPLICATIONS_EXPLORER_PANE_PATH, "utf8");

  assert.match(source, /onAddApp: \(\) => void;/);
  assert.match(
    source,
    /<div className="flex items-center justify-between gap-3 border-b border-border\/45 px-3 py-2\.5">/,
  );
  assert.match(source, /onClick=\{onAddApp\}/);
  assert.match(source, /Add apps/);
});
