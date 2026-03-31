import test from "node:test";
import assert from "node:assert/strict";
import { workspaceAppCatalogEntry } from "../../lib/workspaceApps.ts";
import { buildAppSurfacePresentation } from "./appSurfacePresentation.ts";

test("workspace app catalog exposes Gmail-specific product copy", () => {
  const entry = workspaceAppCatalogEntry("gmail");

  assert.ok(entry);
  assert.equal(entry?.label, "Gmail");
  assert.match(entry?.summary ?? "", /email drafts and sending/i);
  assert.equal(entry?.accentClassName, "bg-rose-300/80");
});

test("app surface presentation prefers a contained split-stage layout", () => {
  const presentation = buildAppSurfacePresentation({
    appId: "gmail",
    label: "Gmail",
    summary: "Email drafts and sending. Use the agent to search threads, draft replies, and keep context in one place.",
    resourceId: "draft-42",
    view: "thread",
  });

  assert.equal(presentation.layout, "split-stage");
  assert.equal(presentation.stageMode, "contained");
  assert.equal(presentation.focusLabel, "Thread draft-42");
  assert.deepEqual(presentation.highlights, [
    "Contained workspace stage",
    "Focused thread context",
    "Agent-assisted follow-up",
  ]);
});
