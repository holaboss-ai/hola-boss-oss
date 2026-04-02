import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("desktop browser blocks popup windows and promotes tab/new-window dispositions into tabs", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(
    source,
    /const shouldOpenAsTab =\s*disposition === "foreground-tab" \|\|\s*disposition === "background-tab" \|\|\s*disposition === "new-window";/,
  );
  assert.doesNotMatch(source, /view\.webContents\.on\("did-create-window"/);
});

test("desktop browser service exposes explicit tab creation endpoint", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(
    source,
    /if \(method === "POST" && pathname === "\/api\/v1\/browser\/tabs"\)/,
  );
});
