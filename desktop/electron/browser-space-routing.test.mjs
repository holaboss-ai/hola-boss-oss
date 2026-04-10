import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("desktop browser tracks separate user and agent browser spaces and routes tool traffic to the agent space", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /const BROWSER_SPACE_IDS = \["user", "agent"\] as const;/);
  assert.match(source, /let activeBrowserSpaceId: BrowserSpaceId = "user";/);
  assert.match(source, /spaces: \{\s*user: createBrowserTabSpaceState\(\),\s*agent: createBrowserTabSpaceState\(\),\s*\}/);
  assert.match(source, /emitWorkbenchOpenBrowser\(\{\s*workspaceId: targetWorkspaceId,\s*url: targetUrl,\s*space: "agent",\s*\}\);/);
  assert.match(source, /await ensureBrowserWorkspace\(targetWorkspaceId, "agent"\);/);
  assert.match(source, /browserWorkspaceSnapshot\(targetWorkspaceId, "agent"\)/);
});
