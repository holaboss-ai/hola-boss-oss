export {
  bootstrapResolvedApplications,
  startOpencodeApplications,
  type OpencodeBootstrapApplication,
  type OpencodeBootstrapRequestPayload,
  type OpencodeBootstrapResponse,
} from "./opencode-bootstrap-shared.js";

export type {
  OpencodeBootstrapApplication as ResolvedApplicationsBootstrapApplication,
  OpencodeBootstrapRequestPayload as ResolvedApplicationsBootstrapRequestPayload,
  OpencodeBootstrapResponse as ResolvedApplicationsBootstrapResponse,
} from "./opencode-bootstrap-shared.js";

export { startOpencodeApplications as startResolvedApplications } from "./opencode-bootstrap-shared.js";
