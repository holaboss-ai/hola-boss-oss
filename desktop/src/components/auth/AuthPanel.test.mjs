import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const AUTH_PANEL_PATH = new URL("./AuthPanel.tsx", import.meta.url);
const BILLING_SUMMARY_CARD_PATH = new URL("../billing/BillingSummaryCard.tsx", import.meta.url);

test("account auth panel focuses on session state instead of billing content", async () => {
  const source = await readFile(AUTH_PANEL_PATH, "utf8");

  assert.doesNotMatch(source, /BillingSummaryCard/);
  assert.doesNotMatch(source, /useDesktopBilling/);
  assert.doesNotMatch(source, /statusDescription/);
  assert.doesNotMatch(source, /Configure model providers and defaults for this desktop runtime\./);
  assert.doesNotMatch(source, /Configure known providers instead of editing raw runtime JSON\./);
  assert.doesNotMatch(source, /text-\[[0-9]+px\]/);
  assert.doesNotMatch(source, /rgba\(/);
});

test("billing summary card exposes web-only billing actions", async () => {
  const source = await readFile(BILLING_SUMMARY_CARD_PATH, "utf8");

  assert.match(source, /Add credits/);
  assert.match(source, /Manage on web/);
  assert.match(source, /openExternalUrl/);
  assert.doesNotMatch(source, /Available hosted credits/);
  assert.doesNotMatch(source, /Recent usage/);
  assert.doesNotMatch(source, /text-\[[0-9]+px\]/);
  assert.doesNotMatch(source, /bg-black\//);
});

test("runtime auth panel keeps model provider settings compact", async () => {
  const source = await readFile(AUTH_PANEL_PATH, "utf8");

  assert.match(source, /Connected providers/);
  assert.match(source, /Available providers/);
  assert.match(source, /Manage which providers this desktop runtime can use\./);
  assert.match(source, /Changes save automatically/);
  assert.match(source, /Models/);
  assert.doesNotMatch(source, /Runtime overview/);
  assert.doesNotMatch(source, /Connected now/);
  assert.doesNotMatch(source, /Ready to connect/);
  assert.doesNotMatch(source, /Connection details/);
  assert.doesNotMatch(source, /Recommended models configured/);
});
