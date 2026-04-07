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

test("runtime auth panel keeps provider cards readable in dark themes", async () => {
  const source = await readFile(AUTH_PANEL_PATH, "utf8");

  assert.match(source, /function providerBrandIconMarkup/);
  assert.match(source, /import openaiLogoMarkup from "@\/assets\/providers\/openai\.svg\?raw"/);
  assert.match(source, /dangerouslySetInnerHTML=\{\{ __html: iconMarkup \}\}/);
  assert.match(source, /className="block h-4 w-4 text-foreground\/92 \[\&_svg\]:h-full \[\&_svg\]:w-full"/);
  assert.match(source, /border-border\/55 bg-background\/80 text-foreground/);
  assert.match(source, /text-sm leading-6 text-foreground\/82/);
  assert.match(source, /text-sm leading-6 text-muted-foreground\/95/);
  assert.doesNotMatch(source, /WebkitMaskImage/);
  assert.doesNotMatch(source, /text-text-main/);
});

test("holaboss proxy defaults only advertise managed gpt models", async () => {
  const source = await readFile(AUTH_PANEL_PATH, "utf8");
  const holabossTemplate =
    source.match(/holaboss:\s*\{[\s\S]*?apiKeyPlaceholder: "hbrt\.v1\.your-proxy-token"[\s\S]*?\n\s*}/)?.[0] ?? "";

  assert.match(
    holabossTemplate,
    /defaultModels: \["gpt-5\.2", "gpt-5-mini", "gpt-4\.1-mini"\]/,
  );
  assert.doesNotMatch(holabossTemplate, /claude-/);
});

test("direct Anthropic and Gemini defaults advertise current provider model ids", async () => {
  const source = await readFile(AUTH_PANEL_PATH, "utf8");
  const providerTemplatesBlock =
    source.match(/const KNOWN_PROVIDER_TEMPLATES:[\s\S]*?function isKnownProviderId/)?.[0] ?? "";
  const anthropicTemplate =
    providerTemplatesBlock.match(/anthropic_direct:\s*\{[\s\S]*?apiKeyPlaceholder: "sk-ant-your-anthropic-key"[\s\S]*?\n\s*}/)?.[0] ?? "";
  const geminiTemplate =
    providerTemplatesBlock.match(/gemini_direct:\s*\{[\s\S]*?apiKeyPlaceholder: "AIza\.\.\.your-gemini-api-key"[\s\S]*?\n\s*}/)?.[0] ?? "";

  assert.match(
    anthropicTemplate,
    /defaultModels: \["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"\]/,
  );
  assert.match(anthropicTemplate, /defaultBaseUrl: "https:\/\/api\.anthropic\.com"/);
  assert.doesNotMatch(anthropicTemplate, /defaultBaseUrl: "https:\/\/api\.anthropic\.com\/v1"/);
  assert.doesNotMatch(anthropicTemplate, /claude-sonnet-4-5/);

  assert.match(
    geminiTemplate,
    /defaultModels: \["gemini-2\.5-pro", "gemini-2\.5-flash", "gemini-2\.5-flash-lite"\]/,
  );
  assert.doesNotMatch(geminiTemplate, /gemini-3\.1-pro-preview/);
  assert.doesNotMatch(geminiTemplate, /gemini-3\.1-flash-lite-preview/);
});
