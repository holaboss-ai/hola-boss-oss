import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "SpaceBrowserExplorerPane.tsx");
const browserSessionUiPath = path.join(__dirname, "browserSessionUi.ts");

test("space browser explorer renders the arc-inspired bottom scope switcher", async () => {
  const source = await readFile(sourcePath, "utf8");

  // The top segmented Tabs control should be gone.
  assert.doesNotMatch(source, /<TabsList/);
  assert.doesNotMatch(source, /<TabsTrigger/);

  // Bottom switcher container.
  assert.match(
    source,
    /flex shrink-0 gap-1 border-t border-border p-1/,
  );

  // Both scope buttons must exist with counts from browserState.tabCounts.
  assert.match(source, /browserState\.tabCounts\.user/);
  assert.match(source, /browserState\.tabCounts\.agent/);

  // Pending agent dot surfaces only when not already on agent scope.
  assert.match(
    source,
    /hasPendingAgentJump && browserSpace !== "agent"/,
  );
});

test("space browser explorer keeps the agent session selector compact and only on agent scope", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(source, /Agent Session Browser/);

  // Agent session chip container is conditional on browserSpace === "agent".
  assert.match(
    source,
    /browserSpace === "agent" \? \(\s*<div className="shrink-0 border-b border-border px-2 py-1\.5">/,
  );

  // Compact SelectTrigger inside the chip.
  assert.match(
    source,
    /<SelectTrigger className="h-7 min-w-0 flex-1 basis-0 rounded-md border-border bg-card px-2 text-left text-xs shadow-none">/,
  );

  assert.match(
    source,
    /<SelectContent align="start" className="p-1">/,
  );
  assert.match(
    source,
    /className="rounded-md px-3 py-2 text-xs"/,
  );
});

test("browser session status badges use short single-word labels", async () => {
  const source = await readFile(browserSessionUiPath, "utf8");

  assert.match(source, /label: "Active"/);
  assert.match(source, /label: "Waiting"/);
  assert.match(source, /label: "Paused"/);
  assert.match(source, /label: "Error"/);
  assert.match(source, /label: "Sleeping"/);
  assert.match(source, /label: "Locked"/);
  assert.doesNotMatch(source, /label: "Agent paused"/);
  assert.doesNotMatch(source, /label: "Agent operating"/);
});

test("space browser explorer uses semantic tokens for session status tones", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /border-success\/30 bg-success\/10 text-success/);
  assert.match(source, /border-warning\/30 bg-warning\/10 text-warning/);
  assert.match(source, /border-info\/30 bg-info\/10 text-info/);
  assert.match(
    source,
    /border-destructive\/30 bg-destructive\/10 text-destructive/,
  );
});

test("space browser explorer does not render a per-tab agent status dot", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(
    source,
    /tab\.id === activeTab\.id[\s\S]*sessionBrowserStatus[\s\S]*inline-block size-2 shrink-0 rounded-full/,
  );
});

test("space browser explorer hides the bookmarks section when empty", async () => {
  const source = await readFile(sourcePath, "utf8");

  // Empty-state placeholder text should be gone — empty bookmarks render nothing.
  assert.doesNotMatch(source, /Saved bookmarks will appear here/);
  // Bookmarks block is conditional on hasBookmarks.
  assert.match(source, /\{hasBookmarks \? \(/);
});
