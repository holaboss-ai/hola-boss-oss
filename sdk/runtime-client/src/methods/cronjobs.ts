import type { RequestFn } from "../request";

export type CronjobDelivery = {
  mode: string;
  channel: string;
  to: string | null;
};

export type CronjobRecord = {
  id: string;
  workspace_id: string;
  initiated_by: string;
  name: string;
  cron: string;
  description: string;
  instruction: string;
  enabled: boolean;
  delivery: CronjobDelivery;
  metadata: Record<string, unknown>;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type CronjobListResponse = {
  jobs: CronjobRecord[];
  count: number;
};

export type CronjobsMethods = {
  list(workspaceId: string, enabledOnly?: boolean): Promise<CronjobListResponse>;
};

export function makeCronjobsMethods(request: RequestFn): CronjobsMethods {
  return {
    list(workspaceId, enabledOnly = false) {
      return request<CronjobListResponse>({
        method: "GET",
        path: "/api/v1/cronjobs",
        params: {
          workspace_id: workspaceId,
          enabled_only: enabledOnly,
        },
      });
    },
  };
}
