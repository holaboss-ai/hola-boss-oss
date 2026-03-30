type JsonRecord = Record<string, unknown>;

export type IntegrationCredentialSource = "platform" | "manual" | "broker";

export interface ResolvedIntegrationRequirement {
  key: string;
  provider: string;
  capability: string | null;
  scopes: string[];
  required: boolean;
  credentialSource: IntegrationCredentialSource;
  holabossUserIdRequired: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function parseBool(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function parseScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCredentialSource(value: unknown): IntegrationCredentialSource {
  const normalized = firstString(value).toLowerCase();
  if (!normalized) {
    return "platform";
  }
  if (normalized === "manual") {
    return "manual";
  }
  if (normalized === "broker") {
    return "broker";
  }
  if (normalized === "platform") {
    return "platform";
  }
  throw new Error(
    `invalid credential_source '${normalized}'. Expected one of: platform, manual, broker`,
  );
}

function parseIntegrationRequirement(
  value: unknown,
  fallbackKey: string,
): ResolvedIntegrationRequirement | null {
  if (!isRecord(value)) {
    return null;
  }

  const provider = firstString(value.provider, value.destination);
  if (!provider) {
    return null;
  }
  const key = firstString(value.key, provider, fallbackKey) || provider;
  const capability = firstString(value.capability) || null;
  const scopes = parseScopes(value.scopes);
  return {
    key,
    provider,
    capability,
    scopes,
    required: parseBool(value.required, true),
    credentialSource: parseCredentialSource(value.credential_source ?? value.credentialSource),
    holabossUserIdRequired: parseBool(
      value.holaboss_user_id_required ?? value.holabossUserIdRequired,
      false,
    ),
  };
}

export function parseResolvedIntegrationRequirements(document: JsonRecord): ResolvedIntegrationRequirement[] {
  const resolved: ResolvedIntegrationRequirement[] = [];

  const hasLegacyIntegration = document.integration !== undefined && document.integration !== null;
  const hasIntegrationList = Array.isArray(document.integrations) && document.integrations.length > 0;
  if (hasLegacyIntegration && hasIntegrationList) {
    throw new Error("app.runtime.yaml cannot define both integration and integrations");
  }

  if (hasIntegrationList) {
    for (const [index, value] of document.integrations.entries()) {
      const parsed = parseIntegrationRequirement(value, `integration_${index}`);
      if (parsed) {
        resolved.push(parsed);
      }
    }
  } else if (hasLegacyIntegration) {
    const parsedLegacy = parseIntegrationRequirement(document.integration, "integration");
    if (parsedLegacy) {
      resolved.push(parsedLegacy);
    }
  }

  return resolved;
}
