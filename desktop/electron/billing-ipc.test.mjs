import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MAIN_PATH = new URL("./main.ts", import.meta.url);
const PRELOAD_PATH = new URL("./preload.ts", import.meta.url);
const ELECTRON_TYPES_PATH = new URL("../src/types/electron.d.ts", import.meta.url);

test("desktop billing IPC handlers are registered in electron main", async () => {
  const source = await readFile(MAIN_PATH, "utf8");

  assert.match(source, /async function billingFetch</);
  assert.match(source, /handleTrustedIpc\("billing:getOverview"/);
  assert.match(source, /handleTrustedIpc\("billing:getUsage"/);
  assert.match(source, /handleTrustedIpc\("billing:getLinks"/);
  assert.match(source, /buildDesktopBillingLinks/);
  assert.match(source, /\/rpc\/quota\/myQuota/);
  assert.match(source, /\/rpc\/quota\/myTransactions/);
  assert.match(source, /\/rpc\/billing\/myBillingInfo/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /"Content-Type":\s*"application\/json"/);
  assert.doesNotMatch(source, /\/api\/desktop\/billing\/overview/);
  assert.doesNotMatch(source, /\/api\/desktop\/billing\/usage/);
});

test("desktop billing IPC is exposed in preload", async () => {
  const source = await readFile(PRELOAD_PATH, "utf8");

  assert.match(source, /billing:\s*\{/);
  assert.match(source, /getOverview:\s*\(\)/);
  assert.match(source, /getUsage:\s*\(/);
  assert.match(source, /getLinks:\s*\(\)/);
});

test("desktop billing payload types are declared for the renderer", async () => {
  const source = await readFile(ELECTRON_TYPES_PATH, "utf8");

  assert.match(source, /interface DesktopBillingOverviewPayload/);
  assert.match(source, /interface DesktopBillingUsageItemPayload/);
  assert.match(source, /interface DesktopBillingLinksPayload/);
  assert.match(source, /billing:\s*\{/);
});
