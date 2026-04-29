import type { RequestFn } from "../request";

export type WorkspacesMethods = Record<string, never>;

export function makeWorkspacesMethods(_request: RequestFn): WorkspacesMethods {
  return {};
}
