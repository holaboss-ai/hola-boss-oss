import { resolveProductRuntimeConfig } from "./runtime-config.js";

export function resolveSubagentExecutionModel(params?: {
  selectedModel?: string | null;
}): string {
  const runtimeConfig = resolveProductRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false,
    includeDefaultBaseUrl: false,
  });
  const configuredSubagentModel = runtimeConfig.subagentModel?.trim() || "";
  if (configuredSubagentModel) {
    return configuredSubagentModel;
  }
  const selectedModel = params?.selectedModel?.trim() || "";
  if (selectedModel) {
    return selectedModel;
  }
  return runtimeConfig.defaultModel.trim();
}
