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

test("desktop billing hook gates billing fetches on desktop auth state", async () => {
  const source = await readFile(HOOK_PATH, "utf8");

  assert.match(source, /useDesktopAuthSession/);
  assert.match(source, /const isAuthenticated = Boolean\(authSessionState\.data\?\.user\?\.id\?\.trim\(\)\);/);
  assert.match(
    source,
    /if \(!isAuthenticated\) \{\s*setOverview\(null\);\s*setUsage\(null\);\s*setLinks\(null\);\s*setError\(null\);\s*setIsLoading\(false\);\s*return;\s*\}/
  );
  assert.match(source, /if \(authSessionState\.isPending\) \{\s*setIsLoading\(true\);\s*return;\s*\}/);
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
  assert.match(source, /isAvailable: isAuthenticated/);
});
