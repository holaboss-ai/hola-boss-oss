import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface OpencodeCommandsCliRequest {
  workspace_dir: string;
}

export interface OpencodeCommandsCliResponse {
  changed: boolean;
}

function decodeCliRequest(encoded: string): OpencodeCommandsCliRequest {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error("request_base64 is required");
  }
  const raw = Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request payload must be an object");
  }
  return parsed as OpencodeCommandsCliRequest;
}

function removePath(target: string): void {
  const stats = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stats) {
    return;
  }
  if (stats.isSymbolicLink() || stats.isFile()) {
    fs.rmSync(target, { force: true });
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

export function stageWorkspaceCommands(request: OpencodeCommandsCliRequest): OpencodeCommandsCliResponse {
  const workspaceRoot = path.resolve(request.workspace_dir);
  const workspaceRealRoot = fs.realpathSync(workspaceRoot);
  const commandsSource = path.join(workspaceRoot, "commands");
  const stagedTarget = path.join(workspaceRoot, ".opencode", "commands");

  const sourceStats = fs.lstatSync(commandsSource, { throwIfNoEntry: false });
  if (sourceStats?.isSymbolicLink()) {
    try {
      fs.realpathSync(commandsSource);
    } catch {
      fs.rmSync(commandsSource, { force: true });
    }
  }

  let commandsSourceResolved = commandsSource;
  try {
    commandsSourceResolved = fs.realpathSync(commandsSource);
  } catch {
    commandsSourceResolved = commandsSource;
  }

  const relativeSource = path.relative(workspaceRealRoot, commandsSourceResolved);
  if (relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
    return { changed: false };
  }

  const commandsDirStats = fs.statSync(commandsSource, { throwIfNoEntry: false });
  if (!commandsDirStats?.isDirectory()) {
    const existing = fs.lstatSync(stagedTarget, { throwIfNoEntry: false });
    if (existing) {
      removePath(stagedTarget);
      return { changed: true };
    }
    return { changed: false };
  }

  const currentTarget = fs.lstatSync(stagedTarget, { throwIfNoEntry: false });
  if (currentTarget?.isSymbolicLink()) {
    try {
      if (fs.realpathSync(stagedTarget) === fs.realpathSync(commandsSource)) {
        return { changed: false };
      }
    } catch {
      // Fall through and restage.
    }
  }

  if (currentTarget) {
    removePath(stagedTarget);
  }
  fs.mkdirSync(path.dirname(stagedTarget), { recursive: true });
  try {
    fs.symlinkSync(commandsSource, stagedTarget, "dir");
  } catch {
    fs.cpSync(commandsSource, stagedTarget, { recursive: true, errorOnExist: true });
  }
  return { changed: true };
}

export async function runOpencodeCommandsCli(
  argv: string[],
  options: {
    io?: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
    stageCommands?: (request: OpencodeCommandsCliRequest) => OpencodeCommandsCliResponse;
  } = {}
): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const requestBase64 = argv[0] === "--request-base64" ? argv[1] ?? "" : argv[0] ?? "";
  if (!requestBase64) {
    io.stderr.write("request_base64 is required\n");
    return 2;
  }
  try {
    const request = decodeCliRequest(requestBase64);
    const result = (options.stageCommands ?? stageWorkspaceCommands)(request);
    io.stdout.write(JSON.stringify(result));
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runOpencodeCommandsCli(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
