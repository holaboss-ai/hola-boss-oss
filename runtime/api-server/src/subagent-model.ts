import { resolveProductRuntimeConfig } from "./runtime-config.js";

export function resolveSubagentExecutionModel(): string {
  const runtimeConfig = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false,
    includeDefaultBaseUrl: false,
  });
  return runtimeConfig.subagentModel?.trim() || runtimeConfig.defaultModel.trim();
}
