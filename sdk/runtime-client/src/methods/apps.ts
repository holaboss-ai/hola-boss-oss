import type { RequestFn } from "../request";

export type AppsMethods = Record<string, never>;

export function makeAppsMethods(_request: RequestFn): AppsMethods {
  return {};
}
