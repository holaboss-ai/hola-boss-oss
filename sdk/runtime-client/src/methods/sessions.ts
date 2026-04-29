import type { RequestFn } from "../request";

export type SessionsMethods = Record<string, never>;

export function makeSessionsMethods(_request: RequestFn): SessionsMethods {
  return {};
}
