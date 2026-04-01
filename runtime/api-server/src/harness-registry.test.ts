import assert from "node:assert/strict";
import test from "node:test";

import { listRuntimeHarnessAdapters, normalizeHarnessId, requireRuntimeHarnessAdapter, resolveRuntimeHarnessAdapter } from "./harness-registry.js";

test("normalizeHarnessId falls back to the default harness", () => {
  assert.equal(normalizeHarnessId(undefined), "pi");
  assert.equal(normalizeHarnessId(" PI "), "pi");
});

test("listRuntimeHarnessAdapters exposes registered harnesses", () => {
  assert.deepEqual(
    listRuntimeHarnessAdapters().map((adapter) => ({ id: adapter.id, hostCommand: adapter.hostCommand })),
    [{ id: "pi", hostCommand: "run-pi" }]
  );
});

test("resolveRuntimeHarnessAdapter resolves supported harnesses", () => {
  assert.equal(resolveRuntimeHarnessAdapter("pi")?.hostCommand, "run-pi");
  assert.equal(resolveRuntimeHarnessAdapter("unsupported"), null);
});

test("requireRuntimeHarnessAdapter rejects unsupported harnesses", () => {
  assert.throws(() => requireRuntimeHarnessAdapter("unsupported"), /unsupported harness: unsupported/);
});
