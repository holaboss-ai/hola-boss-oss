import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "SpaceBrowserExplorerPane.tsx");
const browserSessionUiPath = path.join(__dirname, "browserSessionUi.ts");

test("space browser explorer styles the agent session selector like the app's standard dropdowns", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(source, /Agent Session Browser/);
  assert.match(
    source,
    /<div className="mt-2\.5 flex items-center gap-1\.5">/,
  );
  assert.match(
    source,
    /<SelectTrigger className="h-9 min-w-0 flex-1 basis-0 rounded-\[11px\] border-border\/45 bg-card px-3 text-left text-xs font-medium shadow-none">/,
  );
  assert.match(
    source,
    /<SelectContent align="start" className="p-1">/,
  );
  assert.match(
    source,
    /className="rounded-\[11px\] px-3 py-2 text-xs"/,
  );
  assert.match(
    source,
    /className="grid w-full min-w-0 grid-cols-\[minmax\(0,1fr\)_auto\] items-center gap-3"/,
  );
  assert.match(
    source,
    /className="min-w-0 truncate font-medium text-foreground"/,
  );
  assert.match(
    source,
    /const isSelectedSession =\s*\(browserState\.sessionId \?\? ""\) === session\.session_id;/,
  );
  assert.match(
    source,
    /!isSelectedSession \?\s*\(\s*<span className="shrink-0 text-\[10px\] font-semibold uppercase tracking-\[0\.12em\] text-muted-foreground\/85">/,
  );
  assert.match(
    source,
    /className=\{`shrink-0 gap-1 rounded-full px-1\.5 py-0\.5 text-\[10px\]/,
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
  assert.match(source, /label: "Ready"/);
  assert.doesNotMatch(source, /label: "Agent paused"/);
  assert.doesNotMatch(source, /label: "Agent operating"/);
});

test("space browser explorer uses readable light-theme colors for session status badges", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /text-emerald-700 dark:border-emerald-400\/40 dark:bg-emerald-500\/10 dark:text-emerald-200/,
  );
  assert.match(
    source,
    /text-amber-700 dark:border-amber-400\/30 dark:bg-amber-500\/10 dark:text-amber-100/,
  );
  assert.match(
    source,
    /text-sky-700 dark:border-sky-400\/30 dark:bg-sky-500\/10 dark:text-sky-100/,
  );
  assert.match(
    source,
    /text-rose-700 dark:border-rose-400\/35 dark:bg-rose-500\/10 dark:text-rose-100/,
  );
});

test("space browser explorer does not render a per-tab agent status dot", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(
    source,
    /tab\.id === activeTab\.id[\s\S]*sessionBrowserStatus[\s\S]*inline-block size-2 shrink-0 rounded-full/,
  );
});
