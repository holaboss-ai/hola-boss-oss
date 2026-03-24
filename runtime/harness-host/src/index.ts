import { decodeRequestBase64, type OpencodeHarnessHostRequest } from "./contracts.js";
import { runOpencode } from "./opencode.js";

function readRequestBase64(args: string[]) {
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

async function main(argv: string[]) {
  const [command, ...args] = argv;
  if (!command) {
    throw new Error("missing command");
  }

  if (command === "run-opencode") {
    const encoded = readRequestBase64(args);
    const request = decodeRequestBase64<OpencodeHarnessHostRequest>(encoded);
    return await runOpencode(request);
  }

  throw new Error(`unsupported command: ${command}`);
}

void main(process.argv.slice(2))
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
