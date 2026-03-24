export interface WorkspaceAppDefinition {
  id: string;
  label: string;
  summary: string;
  accentClassName: string;
}

export const WORKSPACE_APPS: WorkspaceAppDefinition[] = [
  {
    id: "twitter",
    label: "Twitter",
    summary: "Short-form post drafting and thread editing inside the workspace app surface.",
    accentClassName: "bg-sky-400/80",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    summary: "Long-form post drafting and professional social publishing flows.",
    accentClassName: "bg-blue-400/80",
  },
  {
    id: "reddit",
    label: "Reddit",
    summary: "Thread, post, and community response drafting in the workspace app surface.",
    accentClassName: "bg-orange-300/80",
  },
];

export function getWorkspaceAppDefinition(appId: string | null | undefined): WorkspaceAppDefinition | null {
  if (!appId) {
    return null;
  }
  return WORKSPACE_APPS.find((app) => app.id === appId) ?? null;
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
