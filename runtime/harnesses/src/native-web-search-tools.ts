export const NATIVE_WEB_SEARCH_TOOL_DEFINITIONS = [
  {
    id: "web_search",
    description: "Search the public web for up-to-date information and return concise result summaries.",
    policy: "inspect"
  }
] as const;

export type NativeWebSearchToolId = (typeof NATIVE_WEB_SEARCH_TOOL_DEFINITIONS)[number]["id"];

export const NATIVE_WEB_SEARCH_TOOL_IDS: NativeWebSearchToolId[] = NATIVE_WEB_SEARCH_TOOL_DEFINITIONS.map(
  (tool) => tool.id
);
