import type { RequestFn } from "../request";

export type MemoryMethods = Record<string, never>;

export function makeMemoryMethods(_request: RequestFn): MemoryMethods {
  return {};
}
