import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const OPERATIONS_DRAWER_PATH = new URL("./OperationsDrawer.tsx", import.meta.url);

test("operations drawer inbox surfaces lifecycle status and trigger feedback", async () => {
  const source = await readFile(OPERATIONS_DRAWER_PATH, "utf8");

  assert.match(source, /ProactiveLifecyclePanel/);
  assert.match(source, /proposalStatusMessage \?/);
  assert.match(source, /label="Sub-Sessions"/);
  assert.match(source, /isLoading=\{isLoadingProactiveStatus\}/);
  assert.doesNotMatch(source, /label="Running"/);
  assert.doesNotMatch(source, /InboxHeaderActions/);
});
