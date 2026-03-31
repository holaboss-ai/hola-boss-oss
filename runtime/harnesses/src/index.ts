export { opencodeHarnessDefinition } from "./opencode.js";
export { piHarnessDefinition } from "./pi.js";
export * from "./desktop-browser-tools.js";
export * from "./runtime-agent-tools.js";
export * from "./types.js";

import { opencodeHarnessDefinition } from "./opencode.js";
import { piHarnessDefinition } from "./pi.js";

export const DEFAULT_HARNESS_ID = "opencode";

export const HARNESS_DEFINITIONS = [opencodeHarnessDefinition, piHarnessDefinition] as const;
