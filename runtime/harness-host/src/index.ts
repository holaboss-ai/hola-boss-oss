import { fileURLToPath } from "node:url";

import { requireHarnessHostPluginByCommand } from "./harness-registry.js";

type HarnessHostCliDeps = {
  resolvePluginByCommand?: typeof requireHarnessHostPluginByCommand;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  exit?: (code: number) => void;
};

export function readRequestBase64(args: string[]) {
  const flagIndex = args.findIndex((arg) => arg === "--request-base64");
  if (flagIndex === -1) {
    throw new Error("missing required argument --request-base64");
  }
  const encoded = args[flagIndex + 1];
  if (!encoded) {
    throw new Error("missing value for --request-base64");
  }
  return encoded;
}

export async function flushWritableStream(stream: Pick<NodeJS.WritableStream, "write">): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write("", (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function runHarnessHostCli(argv: string[], deps: Pick<HarnessHostCliDeps, "resolvePluginByCommand"> = {}) {
  const [command, ...args] = argv;
  if (!command) {
    throw new Error("missing command");
  }

  const resolvePluginByCommand = deps.resolvePluginByCommand ?? requireHarnessHostPluginByCommand;
  const plugin = resolvePluginByCommand(command);
  const encoded = readRequestBase64(args);
  const request = plugin.decodeRequestBase64(encoded);
  return await plugin.run(request);
}

export async function runHarnessHostMain(argv: string[], deps: HarnessHostCliDeps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  try {
    const exitCode = await runHarnessHostCli(argv, deps);
    await Promise.allSettled([flushWritableStream(stdout), flushWritableStream(stderr)]);
    exit(exitCode);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    await Promise.allSettled([flushWritableStream(stdout), flushWritableStream(stderr)]);
    exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runHarnessHostMain(process.argv.slice(2));
}
