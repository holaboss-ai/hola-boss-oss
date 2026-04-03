export interface AppToolDefinition {
  name: string;
  description: string;
}

export interface WorkspaceAppDefinition {
  id: string;
  label: string;
  summary: string;
  accentClassName: string;
  tools?: AppToolDefinition[];
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
    tools: [
      { name: "gmail_search", description: "Search Gmail threads by query" },
      { name: "gmail_get_thread", description: "Read a full Gmail thread" },
      { name: "gmail_draft_reply", description: "Create an email draft (not sent)" },
      { name: "gmail_send_draft", description: "Send a pending draft via Gmail" },
      { name: "gmail_list_drafts", description: "List email drafts" },
    ],
  },
  twitter: {
    id: "twitter",
    label: "Twitter",
    summary: "Short-form post drafting and thread editing inside the workspace app surface.",
    accentClassName: "bg-sky-400/80",
    tools: [
      { name: "twitter_create_post", description: "Create a new post draft" },
      { name: "twitter_list_posts", description: "List posts by status" },
      { name: "twitter_get_post", description: "Get post details" },
      { name: "twitter_update_post", description: "Edit a draft post" },
      { name: "twitter_publish_post", description: "Queue a post for publishing" },
    ],
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    summary: "Long-form post drafting and professional social publishing flows.",
    accentClassName: "bg-blue-400/80",
    tools: [
      { name: "linkedin_create_post", description: "Create a new post draft" },
      { name: "linkedin_list_posts", description: "List posts by status" },
      { name: "linkedin_get_post", description: "Get post details" },
      { name: "linkedin_update_post", description: "Edit a draft post" },
      { name: "linkedin_publish_post", description: "Queue a post for publishing" },
    ],
  },
  reddit: {
    id: "reddit",
    label: "Reddit",
    summary: "Thread, post, and community response drafting in the workspace app surface.",
    accentClassName: "bg-orange-300/80",
    tools: [
      { name: "reddit_create_post", description: "Create a new post draft" },
      { name: "reddit_list_posts", description: "List posts by status" },
      { name: "reddit_get_post", description: "Get post details" },
      { name: "reddit_update_post", description: "Edit a draft post" },
      { name: "reddit_publish_post", description: "Queue a post for publishing" },
    ],
  },
  sheets: {
    id: "sheets",
    label: "Google Sheets",
    summary: "Spreadsheet data management. Use the agent to query rows, update cells, and manage CRM contacts.",
    accentClassName: "bg-emerald-400/80",
    tools: [
      { name: "sheets_create_spreadsheet", description: "Create a new spreadsheet" },
      { name: "sheets_list_spreadsheets", description: "List user's spreadsheets" },
      { name: "sheets_get_info", description: "Get sheet title, headers, row count" },
      { name: "sheets_read_rows", description: "Read rows with partial-match filter" },
      { name: "sheets_read_range", description: "Read raw cell values" },
      { name: "sheets_update_cell", description: "Update a single cell" },
      { name: "sheets_update_row", description: "Update an entire row" },
      { name: "sheets_append_row", description: "Append a new row" },
      { name: "sheets_delete_row", description: "Delete a row" },
      { name: "sheets_add_sheet", description: "Add a new sheet tab" },
    ],
  },
  github: {
    id: "github",
    label: "GitHub",
    summary: "Repository activity tracking and PR triage inside the workspace.",
    accentClassName: "bg-neutral-400/80",
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
