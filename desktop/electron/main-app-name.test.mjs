import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("desktop main process sets the app name to Holaboss", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /app\.setName\(\s*APP_DISPLAY_NAME\s*\)/);
  assert.match(source, /const APP_DISPLAY_NAME = "Holaboss";/);
});
