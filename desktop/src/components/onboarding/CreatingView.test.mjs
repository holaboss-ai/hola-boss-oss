import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const creatingViewPath = path.join(__dirname, "CreatingView.tsx");
const firstWorkspacePanePath = path.join(__dirname, "FirstWorkspacePane.tsx");

test("panel-mode creating view uses the same shell framing as the other workspace-create steps", async () => {
  const source = await readFile(creatingViewPath, "utf8");

  assert.match(source, /panelVariant\?: boolean;/);
  assert.match(source, /className=\{`theme-shell mx-auto flex w-full flex-col items-center rounded-xl border border-border\/45 shadow-lg/);
  assert.match(source, /panelVariant\s*\?\s*"h-full max-w-\[1020px\] justify-center/);
});

test("first workspace pane passes panel variant through to the creating view", async () => {
  const source = await readFile(firstWorkspacePanePath, "utf8");

  assert.match(source, /<CreatingView[\s\S]*panelVariant=\{isPanelVariant\}/);
});

test("first workspace onboarding splits configure and browser profile into staged flow", async () => {
  const source = await readFile(firstWorkspacePanePath, "utf8");

  assert.match(source, /type OnboardingStep =[\s\S]*\| "browser_profile"/);
  assert.match(source, /onContinue=\{\(\) => setStep\("browser_profile"\)\}/);
  assert.match(source, /<BrowserProfileStep[\s\S]*onBack=\{\(\) => setStep\("configure"\)\}/);
  assert.match(source, /listImportBrowserProfiles\(browserImportSource\)/);
});

test("creating view adapts progress text for copy/import browser bootstrap modes", async () => {
  const source = await readFile(creatingViewPath, "utf8");

  assert.match(source, /browserBootstrapMode\?: "fresh" \| "copy_workspace" \| "import_browser";/);
  assert.match(source, /workspaceCreatePhase\?:/);
  assert.match(source, /"Copying browser profile"/);
  assert.match(source, /"Importing browser data"/);
});
