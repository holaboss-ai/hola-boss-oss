import { pathToFileURL } from "node:url";

export {
  projectAgentRuntimeConfig,
  projectOpencodeRuntimeConfig,
  runOpencodeRuntimeConfigCli,
  type AgentRuntimeConfigCliRequest,
  type AgentRuntimeConfigCliResponse,
  type AgentRuntimeConfigGeneralMemberPayload,
  type OpencodeRuntimeConfigCliRequest,
  type OpencodeRuntimeConfigCliResponse,
  type OpencodeRuntimeConfigGeneralMemberPayload,
} from "./agent-runtime-config.js";
import { runOpencodeRuntimeConfigCli } from "./agent-runtime-config.js";

async function main(): Promise<void> {
  process.exitCode = await runOpencodeRuntimeConfigCli(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
