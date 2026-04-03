import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_SHELL_PATH = new URL("./AppShell.tsx", import.meta.url);

test("app shell routes file outputs into the file explorer while keeping chat active", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /if \(\s*\(entry\.renderer\.surface === "document" \|\|\s*entry\.renderer\.surface === "file"\) &&\s*entry\.renderer\.resourceId\?\.trim\(\)\s*\) \{/
  );
  assert.match(
    source,
    /setSpaceVisibility\(\(previous\) => \(\{\s*\.\.\.previous,\s*agent: true,\s*files: true,\s*\}\)\);/
  );
  assert.match(source, /setAgentView\(\{ type: "chat" \}\);/);
  assert.match(
    source,
    /setFileExplorerFocusRequest\(\{\s*path: entry\.renderer\.resourceId,\s*requestKey: Date\.now\(\),\s*\}\);/
  );
});

test("app shell clears a consumed file explorer focus request", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /<FileExplorerPane[\s\S]*focusRequest=\{fileExplorerFocusRequest\}/);
  assert.match(
    source,
    /onFocusRequestConsumed=\{\(requestKey\) => \{\s*setFileExplorerFocusRequest\(\(current\) =>\s*current\?\.requestKey === requestKey \? null : current,\s*\);\s*\}\}/
  );
});
