export const HARNESS_HOST_NOT_IMPLEMENTED_EXIT_CODE = 86;

export type RunnerEventType =
  | "run_claimed"
  | "run_started"
  | "thinking_delta"
  | "output_delta"
  | "tool_call"
  | "run_completed"
  | "run_failed";

export interface RunnerOutputEventPayload {
  session_id: string;
  input_id: string;
  sequence: number;
  event_type: RunnerEventType;
  timestamp?: string;
  payload: Record<string, unknown>;
}

export interface ModelClientConfigPayload {
  model_proxy_provider: string;
  api_key: string;
  base_url?: string | null;
  default_headers?: Record<string, string> | null;
}

export interface OpencodeHarnessHostRequest {
  workspace_id: string;
  workspace_dir: string;
  session_id: string;
  input_id: string;
  instruction: string;
  debug: boolean;
  harness_session_id?: string | null;
  persisted_harness_session_id?: string | null;
  provider_id: string;
  model_id: string;
  mode: string;
  opencode_base_url: string;
  timeout_seconds: number;
  system_prompt: string;
  tools: Record<string, boolean>;
  workspace_tool_ids: string[];
  workspace_skill_ids: string[];
  mcp_servers: Array<Record<string, unknown>>;
  output_format?: Record<string, unknown> | null;
  workspace_config_checksum: string;
  run_started_payload: Record<string, unknown>;
  model_client: ModelClientConfigPayload;
}

export function decodeRequestBase64<T>(encoded: string): T {
  const raw = Buffer.from(encoded, "base64").toString("utf-8");
  return JSON.parse(raw) as T;
}
