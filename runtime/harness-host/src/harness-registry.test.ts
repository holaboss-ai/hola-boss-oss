import assert from "node:assert/strict";
import test from "node:test";

import { listHarnessHostPlugins, requireHarnessHostPluginByCommand, resolveHarnessHostPluginByCommand } from "./harness-registry.js";

test("listHarnessHostPlugins exposes registered harness host plugins", () => {
  assert.deepEqual(
    listHarnessHostPlugins().map((plugin) => ({ id: plugin.id, command: plugin.command })),
    [
      { id: "opencode", command: "run-opencode" },
      { id: "pi", command: "run-pi" },
    ]
  );
});

test("resolveHarnessHostPluginByCommand matches commands case-insensitively", () => {
  assert.equal(resolveHarnessHostPluginByCommand(" RUN-PI ")?.id, "pi");
  assert.equal(resolveHarnessHostPluginByCommand("run-opencode")?.id, "opencode");
  assert.equal(resolveHarnessHostPluginByCommand("run-unknown"), null);
});

test("requireHarnessHostPluginByCommand rejects unsupported commands", () => {
  assert.throws(() => requireHarnessHostPluginByCommand("run-unknown"), /unsupported command: run-unknown/);
});
