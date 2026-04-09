import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("desktop browser normalizes workspace sessions to a Chrome-like user agent and accept-language", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /function browserChromeLikeIdentity\(\): BrowserSessionIdentity \{/);
  assert.match(source, /process\.versions\.chrome/);
  assert.match(source, /session\.setUserAgent\(\s*browserIdentity\.userAgent,\s*browserIdentity\.acceptLanguages,/);
  assert.match(source, /session\.webRequest\.onBeforeSendHeaders\(/);
  assert.match(source, /"Accept-Language",\s*browserIdentity\.acceptLanguages,/);
  assert.match(source, /view\.webContents\.setUserAgent\(workspace\.browserIdentity\.userAgent\)/);
});
