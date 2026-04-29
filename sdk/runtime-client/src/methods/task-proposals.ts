import type { RequestFn } from "../request";

export type TaskProposalsMethods = Record<string, never>;

export function makeTaskProposalsMethods(
  _request: RequestFn
): TaskProposalsMethods {
  return {};
}
