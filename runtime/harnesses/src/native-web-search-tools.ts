export const NATIVE_WEB_SEARCH_TOOL_DEFINITIONS = [
  {
    id: "web_search",
    description:
      "Search the public web to discover and summarize information across multiple sources. Best for exploratory research, source discovery, and approximate or aggregated answers. Do not rely on it alone for exact live values, platform-native rankings or filters, UI-only state, or tasks that require interaction. If required facts remain unverified after search, escalate to browser tools or another more direct capability.",
    policy: "inspect"
  }
] as const;

export type NativeWebSearchToolId = (typeof NATIVE_WEB_SEARCH_TOOL_DEFINITIONS)[number]["id"];

export const NATIVE_WEB_SEARCH_TOOL_IDS: NativeWebSearchToolId[] = NATIVE_WEB_SEARCH_TOOL_DEFINITIONS.map(
  (tool) => tool.id
);
