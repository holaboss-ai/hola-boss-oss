import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  clearWorkspaceMainSessionId,
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
    version: 2,
    harness_sessions: {
      opencode: {
        main_session_id: "session-123"
      }
    }
  });
  assert.equal(readWorkspaceMainSessionId({ workspaceDir, harness: "opencode" }), "session-123");
});

test("readWorkspaceMainSessionId keeps legacy harness payloads readable", () => {
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

test("persistWorkspaceMainSessionId stores multiple harness session ids side by side", () => {
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
    version: 2,
    harness_sessions: {
      opencode: {
        main_session_id: "session-456"
      },
      other: {
        main_session_id: "session-123"
      }
    }
  });
  assert.equal(readWorkspaceMainSessionId({ workspaceDir, harness: "other" }), "session-123");
  assert.equal(readWorkspaceMainSessionId({ workspaceDir, harness: "opencode" }), "session-456");
});

test("clearWorkspaceMainSessionId removes only the targeted harness entry", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-ts-runner-state-clear-"));

  persistWorkspaceMainSessionId({
    workspaceDir,
    harness: "other",
    sessionId: "session-123"
  });
  persistWorkspaceMainSessionId({
    workspaceDir,
    harness: "opencode",
    sessionId: "session-456"
  });

  clearWorkspaceMainSessionId({
    workspaceDir,
    harness: "opencode"
  });

  assert.deepEqual(readWorkspaceSessionState(workspaceDir), {
    version: 2,
    harness_sessions: {
      other: {
        main_session_id: "session-123"
      }
    }
  });
  assert.equal(readWorkspaceMainSessionId({ workspaceDir, harness: "opencode" }), null);
  assert.equal(readWorkspaceMainSessionId({ workspaceDir, harness: "other" }), "session-123");
});
