import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const HOOK_PATH = new URL("./useDesktopBilling.tsx", import.meta.url);

test("desktop billing hook reads overview, usage, and links from electron API", async () => {
  const source = await readFile(HOOK_PATH, "utf8");

  assert.match(source, /window\.electronAPI\.billing\.getOverview/);
  assert.match(source, /window\.electronAPI\.billing\.getUsage/);
  assert.match(source, /window\.electronAPI\.billing\.getLinks/);
});

test("desktop billing hook derives low-balance and out-of-credits state", async () => {
  const source = await readFile(HOOK_PATH, "utf8");

  assert.match(source, /const isLowBalance = Boolean\(/);
  assert.match(source, /const isOutOfCredits = /);
  assert.match(source, /creditsBalance <= 0/);
});

test("desktop billing hook exposes a provider and refresh method", async () => {
  const source = await readFile(HOOK_PATH, "utf8");

  assert.match(source, /export function DesktopBillingProvider/);
  assert.match(source, /export function useDesktopBilling/);
  assert.match(source, /const refresh = useCallback/);
});
