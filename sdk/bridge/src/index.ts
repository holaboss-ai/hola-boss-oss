export { createIntegrationClient } from "./integration-proxy"
export { createAppOutput, updateAppOutput } from "./workspace-outputs"
export { buildAppResourcePresentation } from "./presentation"

export type {
  ProxyRequest,
  ProxyResponse,
  IntegrationClient,
  AppOutputPresentationInput,
  WorkspaceOutputPayload,
  CreateAppOutputRequest,
  UpdateAppOutputRequest,
} from "./types"
