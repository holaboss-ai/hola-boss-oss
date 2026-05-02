import { createHash } from "node:crypto";

export type TriggerHandlerSpec = {
  slug: string;
  handlerPath: string;
  config: Record<string, unknown>;
};

export type TriggersManifest = {
  version: number;
  handlers: TriggerHandlerSpec[];
};

export class TriggersManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriggersManifestError";
  }
}

const HANDLER_PATH_PREFIX = "/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTriggersManifest(raw: unknown): TriggersManifest {
  if (raw === undefined || raw === null) {
    return { version: 1, handlers: [] };
  }
  if (!Array.isArray(raw)) {
    throw new TriggersManifestError("`triggers:` must be an array of handler entries");
  }
  const handlers: TriggerHandlerSpec[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (!isRecord(entry)) {
      throw new TriggersManifestError(`triggers[${i}] must be a mapping`);
    }
    const slug = entry.slug;
    const handlerPath = entry.handler;
    if (typeof slug !== "string" || slug.length === 0) {
      throw new TriggersManifestError(`triggers[${i}].slug missing or not a string`);
    }
    if (typeof handlerPath !== "string" || !handlerPath.startsWith(HANDLER_PATH_PREFIX)) {
      throw new TriggersManifestError(
        `triggers[${i}].handler must be a path starting with "/"`
      );
    }
    const cfg = entry.config;
    const config: Record<string, unknown> = isRecord(cfg) ? { ...cfg } : {};
    handlers.push({ slug, handlerPath, config });
  }
  return { version: 1, handlers };
}

// Stable SHA over the (slug, handlerPath, sorted config) tuple per
// handler. Used to detect config drift on re-install so we know whether
// to delete + recreate the Composio trigger.
export function configSha(handler: TriggerHandlerSpec): string {
  const canonical = JSON.stringify({
    slug: handler.slug,
    handler: handler.handlerPath,
    config: sortedKeys(handler.config),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function sortedKeys(input: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(input).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = input[k];
    out[k] = isRecord(v) ? sortedKeys(v) : v;
  }
  return out;
}
