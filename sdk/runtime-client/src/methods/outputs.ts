import type { RequestFn } from "../request";

export type OutputsMethods = Record<string, never>;

export function makeOutputsMethods(_request: RequestFn): OutputsMethods {
  return {};
}
