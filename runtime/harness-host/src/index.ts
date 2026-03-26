import { fileURLToPath } from "node:url";

import { requireHarnessHostPluginByCommand } from "./harness-registry.js";

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

export async function runHarnessHostCli(argv: string[]) {
  const [command, ...args] = argv;
  if (!command) {
    throw new Error("missing command");
  }

  const plugin = requireHarnessHostPluginByCommand(command);
  const encoded = readRequestBase64(args);
  const request = plugin.decodeRequestBase64(encoded);
  return await plugin.run(request);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runHarnessHostCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}
