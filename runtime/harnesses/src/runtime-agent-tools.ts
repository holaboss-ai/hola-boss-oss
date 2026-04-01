export const RUNTIME_AGENT_TOOL_DEFINITIONS = [
  {
    id: "holaboss_onboarding_status",
    description: "Read the local onboarding status for the current workspace.",
    policy: "inspect"
  },
  {
    id: "holaboss_onboarding_complete",
    description: "Mark local workspace onboarding complete with a summary.",
    policy: "mutate"
  },
  {
    id: "holaboss_cronjobs_list",
    description: "List local cronjobs for the current workspace.",
    policy: "inspect"
  },
  {
    id: "holaboss_cronjobs_create",
    description: "Create a local cronjob for the current workspace.",
    policy: "mutate"
  },
  {
    id: "holaboss_cronjobs_get",
    description: "Read one local cronjob by id.",
    policy: "inspect"
  },
  {
    id: "holaboss_cronjobs_update",
    description: "Update one local cronjob by id.",
    policy: "mutate"
  },
  {
    id: "holaboss_cronjobs_delete",
    description: "Delete one local cronjob by id.",
    policy: "mutate"
  }
] as const;

export type RuntimeAgentToolId = (typeof RUNTIME_AGENT_TOOL_DEFINITIONS)[number]["id"];

export const RUNTIME_AGENT_TOOL_IDS: RuntimeAgentToolId[] = RUNTIME_AGENT_TOOL_DEFINITIONS.map((tool) => tool.id);
