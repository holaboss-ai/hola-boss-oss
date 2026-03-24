import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RuntimeRemoteBridgeWorker,
  bridgeEnabled,
  bridgeMaxItems,
  bridgePollIntervalMs,
  proactiveBridgeHeaders,
  tsBridgeWorkerEnabled
} from "./bridge-worker.js";

test("ts bridge worker is enabled by default when remote bridge is enabled and only disables on explicit opt-out", () => {
  const previousBridge = process.env.PROACTIVE_ENABLE_REMOTE_BRIDGE;
  const previousTs = process.env.HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER;

  process.env.PROACTIVE_ENABLE_REMOTE_BRIDGE = "1";
  delete process.env.HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER;
  assert.equal(bridgeEnabled(), true);
  assert.equal(tsBridgeWorkerEnabled(), true);

  process.env.HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER = "off";
  assert.equal(tsBridgeWorkerEnabled(), false);

  if (previousBridge === undefined) {
    delete process.env.PROACTIVE_ENABLE_REMOTE_BRIDGE;
  } else {
    process.env.PROACTIVE_ENABLE_REMOTE_BRIDGE = previousBridge;
  }
  if (previousTs === undefined) {
    delete process.env.HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER;
  } else {
    process.env.HOLABOSS_RUNTIME_USE_TS_BRIDGE_WORKER = previousTs;
  }
});

test("bridge helpers read headers and env settings", () => {
  const previousConfigPath = process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  const previousAuth = process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
  const previousUser = process.env.HOLABOSS_USER_ID;
  const previousPoll = process.env.PROACTIVE_BRIDGE_POLL_INTERVAL_SECONDS;
  const previousMax = process.env.PROACTIVE_BRIDGE_MAX_ITEMS;

  delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  process.env.HOLABOSS_SANDBOX_AUTH_TOKEN = "token-1";
  process.env.HOLABOSS_USER_ID = "user-1";
  process.env.PROACTIVE_BRIDGE_POLL_INTERVAL_SECONDS = "0.1";
  process.env.PROACTIVE_BRIDGE_MAX_ITEMS = "200";

  assert.deepEqual(proactiveBridgeHeaders(), {
    "X-API-Key": "token-1",
    "X-Holaboss-User-Id": "user-1"
  });
  assert.equal(bridgePollIntervalMs(), 500);
  assert.equal(bridgeMaxItems(), 100);

  if (previousConfigPath === undefined) {
    delete process.env.HOLABOSS_RUNTIME_CONFIG_PATH;
  } else {
    process.env.HOLABOSS_RUNTIME_CONFIG_PATH = previousConfigPath;
  }
  if (previousAuth === undefined) {
    delete process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
  } else {
    process.env.HOLABOSS_SANDBOX_AUTH_TOKEN = previousAuth;
  }
  if (previousUser === undefined) {
    delete process.env.HOLABOSS_USER_ID;
  } else {
    process.env.HOLABOSS_USER_ID = previousUser;
  }
  if (previousPoll === undefined) {
    delete process.env.PROACTIVE_BRIDGE_POLL_INTERVAL_SECONDS;
  } else {
    process.env.PROACTIVE_BRIDGE_POLL_INTERVAL_SECONDS = previousPoll;
  }
  if (previousMax === undefined) {
    delete process.env.PROACTIVE_BRIDGE_MAX_ITEMS;
  } else {
    process.env.PROACTIVE_BRIDGE_MAX_ITEMS = previousMax;
  }
});

test("runtime remote bridge worker polls jobs and reports results", async () => {
  const previousBaseUrl = process.env.PROACTIVE_BRIDGE_BASE_URL;
  const previousAuth = process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
  process.env.PROACTIVE_BRIDGE_BASE_URL = "http://127.0.0.1:3069";
  process.env.HOLABOSS_SANDBOX_AUTH_TOKEN = "token-1";

  const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];
  const worker = new RuntimeRemoteBridgeWorker({
    fetchImpl: (async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      fetchCalls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined
      });
      if (url.endsWith("/jobs?limit=10")) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                job_id: "job-1",
                job_type: "task_proposal.create",
                workspace_id: "workspace-1",
                payload: { workspace_id: "workspace-1" }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("", { status: 204 });
    }) as typeof fetch,
    executeJob: async (job) => ({
      job_id: job.job_id,
      status: "succeeded",
      workspace_id: job.workspace_id,
      job_type: job.job_type,
      output: { ok: true }
    })
  });

  const processed = await worker.pollOnce();

  assert.equal(processed, 1);
  assert.equal(fetchCalls[0].method, "GET");
  assert.equal(fetchCalls[1].method, "POST");
  assert.match(fetchCalls[1].body ?? "", /"job_id":"job-1"/);

  if (previousBaseUrl === undefined) {
    delete process.env.PROACTIVE_BRIDGE_BASE_URL;
  } else {
    process.env.PROACTIVE_BRIDGE_BASE_URL = previousBaseUrl;
  }
  if (previousAuth === undefined) {
    delete process.env.HOLABOSS_SANDBOX_AUTH_TOKEN;
  } else {
    process.env.HOLABOSS_SANDBOX_AUTH_TOKEN = previousAuth;
  }
});
