import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MAIN_PATH = new URL("./main.ts", import.meta.url);

test("browser tabs register a native context menu for BrowserView content", async () => {
  const source = await readFile(MAIN_PATH, "utf8");

  assert.match(source, /Menu,/);
  assert.match(source, /clipboard,/);
  assert.match(source, /type ContextMenuParams,/);
  assert.match(source, /type MenuItemConstructorOptions,/);
  assert.match(source, /function showBrowserViewContextMenu\(/);
  assert.match(source, /const popupX = browserBounds\.x \+ context\.x;/);
  assert.match(source, /const popupY = browserBounds\.y \+ context\.y;/);
  assert.match(
    source,
    /view\.webContents\.on\("context-menu", \(_event, params\) => \{\s*showBrowserViewContextMenu\(\{\s*workspaceId,\s*view,\s*context: params,/,
  );
  assert.match(source, /label: "Open Link in New Tab"/);
  assert.match(source, /label: "Open Link Externally"/);
  assert.match(source, /label: "Copy Link Address"/);
  assert.match(source, /clipboard\.writeText\(linkUrl\);/);
  assert.match(source, /function browserContextSuggestedFilename\(/);
  assert.match(source, /function queueBrowserDownloadPrompt\(/);
  assert.match(source, /label: "Open Image in New Tab"/);
  assert.match(source, /label: "Copy Image Address"/);
  assert.match(source, /label: "Save Image As\.\.\."/);
  assert.match(source, /queueBrowserDownloadPrompt\(workspaceId, imageUrl,/);
  assert.match(source, /void view\.webContents\.downloadURL\(imageUrl\);/);
  assert.match(source, /label: "Cut", role: "cut"/);
  assert.match(source, /label: "Copy", role: "copy"/);
  assert.match(source, /label: "Paste", role: "paste"/);
  assert.match(source, /label: "Back"/);
  assert.match(source, /label: "Forward"/);
  assert.match(source, /label: "Reload"/);
  assert.match(source, /Menu\.buildFromTemplate\(template\)\.popup\(\{/);
  assert.match(source, /frame: context\.frame \?\? undefined/);
  assert.match(source, /x: popupX,/);
  assert.match(source, /y: popupY,/);
});
