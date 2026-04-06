import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MAIN_PATH = new URL("./main.ts", import.meta.url);

test("control plane json helper does not read an error response body twice", async () => {
  const source = await readFile(MAIN_PATH, "utf8");

  assert.match(source, /let errorDetail = "";/);
  assert.match(source, /errorDetail = await readControlPlaneError\(response\);/);
  assert.match(source, /throw new Error\(errorDetail \|\| \(await readControlPlaneError\(response\)\)\);/);
});

test("manual task proposal trigger uses proactive heartbeat ingest", async () => {
  const source = await readFile(MAIN_PATH, "utf8");

  assert.match(source, /async function requestRemoteTaskProposalGeneration\(/);
  assert.match(source, /path: "\/api\/v1\/proactive\/ingest"/);
  assert.match(source, /sourceRef: "desktop:manual-heartbeat"/);
  assert.match(source, /workspace_id=\$\{workspaceId\} source=\$\{params\.sourceRef\}/);
  assert.doesNotMatch(source, /\/api\/v1\/proactive\/bridge\/demo\/task-proposal/);
});

test("proactive status lifecycle is driven by agent progress rather than proposal count", async () => {
  const source = await readFile(MAIN_PATH, "utf8");

  assert.match(source, /lifecycle_state: "idle"/);
  assert.match(source, /let lifecycleState = "idle";/);
  assert.match(source, /lifecycleState = "sent";/);
  assert.match(source, /lifecycleState = "claimed";/);
  assert.match(source, /lifecycleState = "analyzing";/);
  assert.doesNotMatch(source, /if \(proposalCount > 0\) \{[\s\S]*?ready/);
  assert.doesNotMatch(source, /delivery_state:/);
});
