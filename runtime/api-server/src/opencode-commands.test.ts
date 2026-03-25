import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { runOpencodeCommandsCli } from "./opencode-commands.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempWorkspace(prefix: string): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(workspaceRoot);
  return workspaceRoot;
}

test("runOpencodeCommandsCli stages discoverable commands", async () => {
  const workspaceRoot = makeTempWorkspace("hb-opencode-commands-");
  const commandsDir = path.join(workspaceRoot, "commands");
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.writeFileSync(path.join(commandsDir, "hello.md"), "---\ndescription: Hello\n---\nEcho hello.\n", "utf8");

  let stdout = "";
  let stderr = "";
  const exitCode = await runOpencodeCommandsCli(
    ["--request-base64", Buffer.from(JSON.stringify({ workspace_dir: workspaceRoot }), "utf8").toString("base64")],
    {
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { changed: true });
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".opencode", "commands", "hello.md")), true);
});

test("runOpencodeCommandsCli reports unchanged when commands target is already staged", async () => {
  const workspaceRoot = makeTempWorkspace("hb-opencode-commands-unchanged-");
  const commandsDir = path.join(workspaceRoot, "commands");
  const stagedTarget = path.join(workspaceRoot, ".opencode", "commands");
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.writeFileSync(path.join(commandsDir, "hello.md"), "---\ndescription: Hello\n---\nEcho hello.\n", "utf8");
  fs.mkdirSync(path.dirname(stagedTarget), { recursive: true });
  fs.symlinkSync(commandsDir, stagedTarget, "dir");

  let stdout = "";
  let stderr = "";
  const exitCode = await runOpencodeCommandsCli(
    ["--request-base64", Buffer.from(JSON.stringify({ workspace_dir: workspaceRoot }), "utf8").toString("base64")],
    {
      io: {
        stdout: { write(chunk: string) { stdout += chunk; return true; } } as unknown as NodeJS.WritableStream,
        stderr: { write(chunk: string) { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { changed: false });
});
