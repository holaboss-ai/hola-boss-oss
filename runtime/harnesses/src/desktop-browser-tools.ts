export const DESKTOP_BROWSER_TOOL_IDS = [
  "browser_navigate",
  "browser_get_state",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_scroll",
  "browser_back",
  "browser_forward",
  "browser_reload",
  "browser_screenshot",
  "browser_list_tabs",
] as const;

export type DesktopBrowserToolId = (typeof DESKTOP_BROWSER_TOOL_IDS)[number];

export interface DesktopBrowserToolDefinition {
  id: DesktopBrowserToolId;
  description: string;
  policy: "inspect" | "mutate";
  session_scope: "all_sessions" | "main_only";
  input_schema: Record<string, unknown>;
}

export const DESKTOP_BROWSER_TOOL_DEFINITIONS: DesktopBrowserToolDefinition[] = [
  {
    id: "browser_navigate",
    description: "Navigate the desktop browser to a URL.",
    policy: "mutate",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", minLength: 1 },
      },
    },
  },
  {
    id: "browser_get_state",
    description: "Read the current desktop browser page, visible interactive elements, and optional screenshot.",
    policy: "inspect",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        include_screenshot: { type: "boolean" },
      },
    },
  },
  {
    id: "browser_click",
    description: "Click an interactive element from browser_get_state by index.",
    policy: "mutate",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["index"],
      properties: {
        index: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    id: "browser_type",
    description: "Type text into an interactive element from browser_get_state by index.",
    policy: "mutate",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["index", "text"],
      properties: {
        index: { type: "integer", minimum: 1 },
        text: { type: "string" },
        clear: { type: "boolean" },
        submit: { type: "boolean" },
      },
    },
  },
  {
    id: "browser_press",
    description: "Send a keyboard key to the currently focused element.",
    policy: "mutate",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["key"],
      properties: {
        key: { type: "string", minLength: 1 },
      },
    },
  },
  {
    id: "browser_scroll",
    description: "Scroll the current page vertically.",
    policy: "mutate",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "integer", minimum: 1 },
        delta_y: { type: "integer" },
      },
    },
  },
  {
    id: "browser_back",
    description: "Go back in the active browser tab history.",
    policy: "mutate",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    id: "browser_forward",
    description: "Go forward in the active browser tab history.",
    policy: "mutate",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    id: "browser_reload",
    description: "Reload the active browser tab.",
    policy: "mutate",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    id: "browser_screenshot",
    description: "Capture a screenshot of the active browser tab.",
    policy: "inspect",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        format: { type: "string", enum: ["png", "jpeg"] },
        quality: { type: "integer", minimum: 0, maximum: 100 },
      },
    },
  },
  {
    id: "browser_list_tabs",
    description: "List open browser tabs and the active tab id.",
    policy: "inspect",
    session_scope: "main_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
];
