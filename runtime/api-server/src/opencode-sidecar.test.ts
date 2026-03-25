import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SpawnOptions } from "node:child_process";
import { afterEach, test } from "node:test";

import { restartOpencodeSidecar, runOpencodeSidecarCli } from "./opencode-sidecar.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempWorkspaceRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function makeRequest(workspaceRoot: string) {
  return {
    workspace_root: workspaceRoot,
    host: "127.0.0.1",
    port: 4096,
    readiness_url: "http://127.0.0.1:4096/mcp",
    workspace_id: "workspace-1",
    config_fingerprint: "fp-1",
    allow_reuse_existing: false,
    ready_timeout_s: 2
  } as const;
}

test("restartOpencodeSidecar reuses a healthy matching sidecar", async () => {
  const workspaceRoot = makeTempWorkspaceRoot("hb-opencode-sidecar-reuse-");
  const request = makeRequest(workspaceRoot);
  const stateDir = path.join(workspaceRoot, ".holaboss");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "opencode-sidecar-state.json"),
    JSON.stringify(
      {
        version: 1,
        sidecar: {
          pid: 321,
          url: request.readiness_url,
          workspace_id: request.workspace_id,
          config_fingerprint: request.config_fingerprint
        }
      },
      null,
      2
    ),
    "utf8"
  );
  let listed = false;
  let spawned = false;

  const result = await restartOpencodeSidecar(
    { ...request, allow_reuse_existing: true },
    {
      async isReady(url) {
        assert.equal(url, request.readiness_url);
        return true;
      },
      async listRunningPids(host, port) {
        assert.equal(host, "127.0.0.1");
        assert.equal(port, 4096);
        listed = true;
        return [];
      },
      spawnProcess() {
        spawned = true;
        throw new Error("should not spawn");
      }
    }
  );

  assert.equal(listed, false);
  assert.equal(spawned, false);
  assert.deepEqual(result, {
    outcome: "reused",
    pid: 321,
    url: request.readiness_url
  });
});

test("restartOpencodeSidecar restarts sidecar, writes state, and uses log file", async () => {
  const workspaceRoot = makeTempWorkspaceRoot("hb-opencode-sidecar-start-");
  const request = makeRequest(workspaceRoot);
  const termSignals: number[] = [];
  const killSignals: number[] = [];
  const pidSnapshots = [[111], [], []] as number[][];
  let readinessChecks = 0;
  let spawnCall: { command: string; args: string[]; options: SpawnOptions } | null = null;
  let unrefCalled = false;

  const result = await restartOpencodeSidecar(request, {
    async isReady(url) {
      assert.equal(url, request.readiness_url);
      readinessChecks += 1;
      return readinessChecks >= 2;
    },
      async listRunningPids(host, port) {
        assert.equal(host, "127.0.0.1");
        assert.equal(port, 4096);
        return pidSnapshots.shift() ?? [];
      },
    terminatePid(pid) {
      termSignals.push(pid);
    },
    killPid(pid) {
      killSignals.push(pid);
    },
    spawnProcess(command, args, options) {
      spawnCall = { command, args, options };
      return {
        pid: 789,
        unref() {
          unrefCalled = true;
        },
      };
    },
    async waitForExit() {
      return null;
    }
  });

  assert.deepEqual(result, {
    outcome: "started",
    pid: 789,
    url: request.readiness_url
  });
  assert.deepEqual(termSignals, [111]);
  assert.deepEqual(killSignals, []);
  assert.equal(unrefCalled, true);
  assert.ok(spawnCall);
  const capturedSpawnCall = spawnCall as { command: string; args: string[]; options: SpawnOptions };
  assert.equal(capturedSpawnCall.command, "opencode");
  assert.deepEqual(capturedSpawnCall.args, ["serve", "--hostname", "127.0.0.1", "--port", "4096"]);
  assert.equal(capturedSpawnCall.options.cwd, path.resolve(workspaceRoot));
  assert.equal(capturedSpawnCall.options.detached, true);
  assert.equal(Array.isArray(capturedSpawnCall.options.stdio), true);

  const state = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".holaboss", "opencode-sidecar-state.json"), "utf8"));
  assert.deepEqual(state, {
    version: 1,
    sidecar: {
      pid: 789,
      url: request.readiness_url,
      workspace_id: request.workspace_id,
      config_fingerprint: request.config_fingerprint
    }
  });
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".holaboss", "opencode-server.log")), true);
});

test("restartOpencodeSidecar clears stale state and fails when processes cannot be stopped", async () => {
  const workspaceRoot = makeTempWorkspaceRoot("hb-opencode-sidecar-stopfail-");
  const request = makeRequest(workspaceRoot);
  const stateDir = path.join(workspaceRoot, ".holaboss");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "opencode-sidecar-state.json"),
    JSON.stringify(
      {
        version: 1,
        sidecar: {
          pid: 222,
          url: request.readiness_url,
          workspace_id: request.workspace_id,
          config_fingerprint: request.config_fingerprint
        }
      },
      null,
      2
    ),
    "utf8"
  );
  const termSignals: number[] = [];
  const killSignals: number[] = [];

  await assert.rejects(
    restartOpencodeSidecar(request, {
      async isReady() {
        return false;
      },
      pidAlive() {
        return false;
      },
      async listRunningPids() {
        return [333];
      },
      terminatePid(pid) {
        termSignals.push(pid);
      },
      killPid(pid) {
        killSignals.push(pid);
      },
      async sleep() {}
    }),
    /failed to stop existing OpenCode sidecar before restart/
  );

  assert.deepEqual(termSignals, [333]);
  assert.deepEqual(killSignals, [333]);
  assert.equal(fs.existsSync(path.join(stateDir, "opencode-sidecar-state.json")), false);
});

test("restartOpencodeSidecar fails when the spawned sidecar exits during startup", async () => {
  const workspaceRoot = makeTempWorkspaceRoot("hb-opencode-sidecar-startfail-");
  const request = makeRequest(workspaceRoot);

  await assert.rejects(
    restartOpencodeSidecar(request, {
      async isReady() {
        return false;
      },
      async listRunningPids() {
        return [];
      },
      spawnProcess() {
        return {
          pid: 444,
          unref() {}
        };
      },
      async waitForExit() {
        return 7;
      }
    }),
    /OpenCode sidecar exited during startup with code 7/
  );
});

test("runOpencodeSidecarCli writes JSON response for a valid request", async () => {
  const request = makeRequest("/tmp/workspace-root");
  let stdout = "";
  let stderr = "";
  const exitCode = await runOpencodeSidecarCli(
    ["--request-base64", Buffer.from(JSON.stringify(request), "utf8").toString("base64")],
    {
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
      },
      async restartSidecar(parsed) {
        assert.deepEqual(parsed, request);
        return {
          outcome: "started",
          pid: 999,
          url: request.readiness_url
        };
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    outcome: "started",
    pid: 999,
    url: request.readiness_url
  });
});

test("runOpencodeSidecarCli returns exit code 2 when request is missing", async () => {
  let stdout = "";
  let stderr = "";
  const exitCode = await runOpencodeSidecarCli([], {
    io: {
      stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
      stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
    }
  });

  assert.equal(exitCode, 2);
  assert.equal(stdout, "");
  assert.equal(stderr, "request_base64 is required\n");
});
