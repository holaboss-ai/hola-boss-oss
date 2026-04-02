import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TOP_TABS_BAR_PATH = new URL("./TopTabsBar.tsx", import.meta.url);
const APP_SHELL_PATH = new URL("./AppShell.tsx", import.meta.url);

test("top tabs bar renders a credits pill before the account trigger", async () => {
  const source = await readFile(TOP_TABS_BAR_PATH, "utf8");

  assert.match(source, /CreditsPill/);
  assert.match(source, /useDesktopBilling/);
  assert.doesNotMatch(source, /hasHostedBillingAccount \?/);
});

test("clicking the credits pill opens billing settings", async () => {
  const source = await readFile(TOP_TABS_BAR_PATH, "utf8");

  assert.match(source, /onClick=\{\(\) => onOpenBilling\?\.\(\)\}/);
});

test("app shell provides desktop billing context to top tabs bar consumers", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(source, /DesktopBillingProvider/);
  assert.match(source, /<DesktopBillingProvider>/);
});
