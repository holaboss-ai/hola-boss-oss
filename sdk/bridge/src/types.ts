export interface ProxyRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  endpoint: string
  body?: unknown
}

export interface ProxyResponse<T = unknown> {
  data: T | null
  status: number
  headers: Record<string, string>
}

export interface IntegrationClient {
  proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>>
}

export interface AppOutputPresentationInput {
  view: string
  path: string
}

export interface WorkspaceOutputPayload {
  id: string
  workspace_id: string
  output_type: string
  title: string
  status: string
  module_id: string | null
  module_resource_id: string | null
  file_path: string | null
  html_content: string | null
  session_id: string | null
  artifact_id: string | null
  folder_id: string | null
  platform: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CreateAppOutputRequest {
  outputType: string
  title: string
  moduleId: string
  moduleResourceId?: string | null
  platform?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
}

export interface UpdateAppOutputRequest {
  title?: string | null
  status?: string | null
  moduleResourceId?: string | null
  metadata?: Record<string, unknown> | null
}
