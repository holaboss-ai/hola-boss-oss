import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { RuntimeStateStore } from "@holaboss/runtime-state-store";

import {
  AppLifecycleExecutorError,
  type AppLifecycleExecutorLike,
  RuntimeAppLifecycleExecutor
} from "./app-lifecycle-worker.js";
import { startOpencodeApplications } from "./opencode-bootstrap-shared.js";

export interface OpencodeBootstrapCliRequest {
  workspace_id: string;
  workspace_dir?: string;
  holaboss_user_id?: string;
  resolved_applications: unknown[];
}

export function defaultWorkspaceRoot(): string | undefined {
  const sandboxRoot = (process.env.HB_SANDBOX_ROOT ?? "").trim();
  if (!sandboxRoot) {
    return undefined;
  }
  return `${sandboxRoot.replace(/\/+$/, "")}/workspace`;
}

export function decodeCliRequest(encoded: string): OpencodeBootstrapCliRequest {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error("request_base64 is required");
  }
  const raw = Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request payload must be an object");
  }
  return parsed as OpencodeBootstrapCliRequest;
}

export async function runOpencodeAppBootstrapCli(
  argv: string[],
  options: {
    io?: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
    store?: RuntimeStateStore;
    appLifecycleExecutor?: AppLifecycleExecutorLike;
  } = {}
): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const requestBase64 = argv[0] === "--request-base64" ? argv[1] ?? "" : argv[0] ?? "";
  if (!requestBase64) {
    io.stderr.write("request_base64 is required\n");
    return 2;
  }

  const ownsStore = !options.store;
  const store =
    options.store ??
    new RuntimeStateStore({
      workspaceRoot: defaultWorkspaceRoot() ?? path.join(os.tmpdir(), "workspace-root")
    });
  const appLifecycleExecutor = options.appLifecycleExecutor ?? new RuntimeAppLifecycleExecutor();

  try {
    const request = decodeCliRequest(requestBase64);
    const result = await startOpencodeApplications({
      store,
      appLifecycleExecutor,
      workspaceId: request.workspace_id,
      body: {
        workspace_dir: request.workspace_dir,
        holaboss_user_id: request.holaboss_user_id,
        resolved_applications: request.resolved_applications
      }
    });
    io.stdout.write(JSON.stringify(result));
    return 0;
  } catch (error) {
    const message = error instanceof AppLifecycleExecutorError || error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n`);
    return 1;
  } finally {
    if (ownsStore) {
      store.close();
    }
  }
}

async function main(): Promise<void> {
  process.exitCode = await runOpencodeAppBootstrapCli(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
