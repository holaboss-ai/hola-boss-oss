import type { RequestFn } from "../request";

export type WorkspaceOutputRecord = {
  id: string;
  workspace_id: string;
  output_type: string;
  title: string;
  status: string;
  module_id: string | null;
  module_resource_id: string | null;
  file_path: string | null;
  html_content: string | null;
  session_id: string | null;
  input_id: string | null;
  artifact_id: string | null;
  folder_id: string | null;
  platform: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WorkspaceOutputListResponse = {
  items: WorkspaceOutputRecord[];
};

export type ListOutputsParams = {
  workspaceId: string;
  outputType?: string | null;
  status?: string | null;
  platform?: string | null;
  folderId?: string | null;
  sessionId?: string | null;
  inputId?: string | null;
  limit?: number;
  offset?: number;
};

export type OutputsMethods = {
  list(params: ListOutputsParams): Promise<WorkspaceOutputListResponse>;
};

export function makeOutputsMethods(request: RequestFn): OutputsMethods {
  return {
    list(params) {
      return request<WorkspaceOutputListResponse>({
        method: "GET",
        path: "/api/v1/outputs",
        params: {
          workspace_id: params.workspaceId,
          output_type: params.outputType ?? undefined,
          status: params.status ?? undefined,
          platform: params.platform ?? undefined,
          folder_id: params.folderId ?? undefined,
          session_id: params.sessionId ?? undefined,
          input_id: params.inputId ?? undefined,
          limit: params.limit ?? 50,
          offset: params.offset ?? 0,
        },
      });
    },
  };
}
