export interface WorkspaceAppDefinition {
  id: string;
  label: string;
  summary: string;
  accentClassName: string;
}

export interface WorkspaceInstalledAppDefinition extends WorkspaceAppDefinition {
  configPath: string;
  lifecycle: InstalledWorkspaceAppPayload["lifecycle"];
  ready: boolean;
  error: string | null;
}

const APP_CATALOG: Record<string, WorkspaceAppDefinition> = {
  gmail: {
    id: "gmail",
    label: "Gmail",
    summary: "Email drafts and sending. Use the agent to search threads, draft replies, and keep context in one place.",
    accentClassName: "bg-rose-300/80",
  },
  twitter: {
    id: "twitter",
    label: "Twitter",
    summary: "Short-form post drafting and thread editing inside the workspace app surface.",
    accentClassName: "bg-sky-400/80",
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    summary: "Long-form post drafting and professional social publishing flows.",
    accentClassName: "bg-primary/80",
  },
  reddit: {
    id: "reddit",
    label: "Reddit",
    summary: "Thread, post, and community response drafting in the workspace app surface.",
    accentClassName: "bg-orange-300/80",
  },
  sheets: {
    id: "sheets",
    label: "Google Sheets",
    summary: "Spreadsheet data management. Use the agent to query rows, update cells, and manage CRM contacts.",
    accentClassName: "bg-emerald-400/80",
  },
  github: {
    id: "github",
    label: "GitHub",
    summary: "Repository activity tracking and PR triage inside the workspace.",
    accentClassName: "bg-neutral-400/80",
  },
  calcom: {
    id: "calcom",
    label: "Cal",
    summary: "Cal.com event types and bookings — schedule, reschedule, and cancel through the agent.",
    accentClassName: "bg-neutral-300/80",
  }
};

function labelFromAppId(appId: string): string {
  return appId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function workspaceAppCatalogEntry(appId: string | null | undefined): WorkspaceAppDefinition | null {
  if (!appId) {
    return null;
  }
  const normalized = appId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return (
    APP_CATALOG[normalized] || {
      id: normalized,
      label: labelFromAppId(normalized),
      summary: "Workspace app surface routed from the selected workspace.",
      accentClassName: "bg-emerald-300/80"
    }
  );
}

export function hydrateInstalledWorkspaceApps(
  apps: InstalledWorkspaceAppPayload[]
): WorkspaceInstalledAppDefinition[] {
  return apps.map((app) => {
    const catalogEntry = workspaceAppCatalogEntry(app.app_id) || {
      id: app.app_id,
      label: app.app_id,
      summary: "Workspace app surface routed from the selected workspace.",
      accentClassName: "bg-emerald-300/80"
    };
    return {
      ...catalogEntry,
      configPath: app.config_path,
      lifecycle: app.lifecycle,
      ready: app.ready,
      error: app.error ?? null
    };
  });
}

export function getWorkspaceAppDefinition(
  appId: string | null | undefined,
  installedApps?: WorkspaceInstalledAppDefinition[]
): WorkspaceInstalledAppDefinition | WorkspaceAppDefinition | null {
  if (!appId) {
    return null;
  }
  const normalized = appId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const installed = installedApps?.find((app) => app.id === normalized);
  return installed || workspaceAppCatalogEntry(normalized);
}

export function inferWorkspaceAppIdFromText(text: string): string | null {
  const normalized = text.toLowerCase();
  if (normalized.includes("linkedin")) {
    return "linkedin";
  }
  if (normalized.includes("twitter") || normalized.includes("tweet") || normalized.includes("thread")) {
    return "twitter";
  }
  if (normalized.includes("reddit") || normalized.includes("subreddit")) {
    return "reddit";
  }
  return null;
}

export function inferInstalledWorkspaceAppIdFromText(
  text: string,
  installedApps: WorkspaceInstalledAppDefinition[]
): string | null {
  const inferredAppId = inferWorkspaceAppIdFromText(text);
  if (!inferredAppId) {
    return null;
  }
  return installedApps.some((app) => app.id === inferredAppId) ? inferredAppId : null;
}
