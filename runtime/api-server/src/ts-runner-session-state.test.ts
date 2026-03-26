import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  persistWorkspaceMainSessionId,
  readWorkspaceMainSessionId,
  readWorkspaceSessionState,
  workspaceSessionStatePath
} from "./ts-runner-session-state.js";

const ORIGINAL_SANDBOX_ROOT = process.env.HB_SANDBOX_ROOT;

afterEach(() => {
  if (ORIGINAL_SANDBOX_ROOT === undefined) {
    delete process.env.HB_SANDBOX_ROOT;
  } else {
    process.env.HB_SANDBOX_ROOT = ORIGINAL_SANDBOX_ROOT;
  }
});

test("persistWorkspaceMainSessionId writes the expected session state payload", () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-state-"));
  process.env.HB_SANDBOX_ROOT = sandboxRoot;
  const workspaceDir = path.join(sandboxRoot, "workspace", "workspace-1");

  persistWorkspaceMainSessionId({
    workspaceDir,
    harness: "opencode",
    sessionId: "session-123"
  });

  assert.deepEqual(readWorkspaceSessionState(workspaceDir), {
    version: 1,
    harness: "opencode",
    main_session_id: "session-123"
  });
  assert.equal(readWorkspaceMainSessionId({ workspaceDir, harness: "opencode" }), "session-123");
});

test("readWorkspaceMainSessionId ignores harness mismatches", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-state-mismatch-"));
  const statePath = workspaceSessionStatePath(workspaceDir);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      version: 1,
      harness: "other",
      main_session_id: "session-123"
    }),
    "utf8"
  );

  assert.equal(readWorkspaceMainSessionId({ workspaceDir, harness: "opencode" }), null);
});

test("persistWorkspaceMainSessionId refuses to overwrite a different harness", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-state-refuse-"));
  const statePath = workspaceSessionStatePath(workspaceDir);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      version: 1,
      harness: "other",
      main_session_id: "session-123"
    }),
    "utf8"
  );

  persistWorkspaceMainSessionId({
    workspaceDir,
    harness: "opencode",
    sessionId: "session-456"
  });

  assert.deepEqual(readWorkspaceSessionState(workspaceDir), {
    version: 1,
    harness: "other",
    main_session_id: "session-123"
  });
});
