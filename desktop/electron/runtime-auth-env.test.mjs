import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("embedded runtime launch forwards auth base URL alongside the auth cookie", async () => {
  const source = await readFile(mainSourcePath, "utf8");
  const startFunction =
    source.match(
      /async function startEmbeddedRuntime\(\) \{[\s\S]*?\n}\n\nfunction persistFileBookmarks/,
    )?.[0] ?? "";

  assert.match(
    startFunction,
    /env:\s*\{[\s\S]*HOLABOSS_AUTH_BASE_URL:\s*AUTH_BASE_URL,[\s\S]*HOLABOSS_AUTH_COOKIE:\s*authCookieHeader\(\)\s*\?\?\s*"",/,
  );
});
