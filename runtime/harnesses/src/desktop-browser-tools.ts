export const DESKTOP_BROWSER_TOOL_IDS = [
  "browser_navigate",
  "browser_open_tab",
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
  session_scope: "all_sessions" | "workspace_session_only";
  input_schema: Record<string, unknown>;
}

export const DESKTOP_BROWSER_TOOL_DEFINITIONS: DesktopBrowserToolDefinition[] = [
  {
    id: "browser_navigate",
    description:
      "Navigate the desktop browser to a URL for direct inspection or interaction on a specific live site when search results are not enough.",
    policy: "mutate",
    session_scope: "workspace_session_only",
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
    id: "browser_open_tab",
    description:
      "Open a URL in a new desktop browser tab so you can inspect or compare specific live pages without losing the current page state.",
    policy: "mutate",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", minLength: 1 },
        background: { type: "boolean" },
      },
    },
  },
  {
    id: "browser_get_state",
    description:
      "Read the current desktop browser page, visible interactive elements, and optional screenshot. Prefer this as the DOM-first browser inspection tool for actions and structured extraction. By default it returns a compact state snapshot; set include_page_text=true only when you need the current page text, and set include_screenshot=true when visual appearance, layout, prominence, overlays, canvas/chart/PDF content, or user-visible confirmation matters, or when DOM signals are ambiguous or unreliable.",
    policy: "inspect",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        include_page_text: { type: "boolean" },
        include_screenshot: { type: "boolean" },
      },
    },
  },
  {
    id: "browser_click",
    description:
      "Click an interactive element from browser_get_state by index to follow links, apply filters, reveal hidden data, paginate, or continue a live browser workflow.",
    policy: "mutate",
    session_scope: "workspace_session_only",
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
    description:
      "Type text into an interactive element from browser_get_state by index to search, filter, fill inputs, or continue a live browser workflow.",
    policy: "mutate",
    session_scope: "workspace_session_only",
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
    description:
      "Send a keyboard key to the currently focused element to submit forms, confirm dialogs, or continue keyboard-driven browser interaction.",
    policy: "mutate",
    session_scope: "workspace_session_only",
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
    description:
      "Scroll the current page vertically to load, inspect, or reach additional live content that is not yet visible.",
    policy: "mutate",
    session_scope: "workspace_session_only",
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
    description: "Go back in the active browser tab history while preserving the live browser session state.",
    policy: "mutate",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    id: "browser_forward",
    description: "Go forward in the active browser tab history while preserving the live browser session state.",
    policy: "mutate",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    id: "browser_reload",
    description: "Reload the active browser tab to refresh live page state before re-checking exact details.",
    policy: "mutate",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    id: "browser_screenshot",
    description:
      "Capture a screenshot of the active browser tab when visual verification or interpretation is needed. Do not use it by default for routine navigation or straightforward structured extraction when DOM and text state already suffice.",
    policy: "inspect",
    session_scope: "workspace_session_only",
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
    description: "List open browser tabs and the active tab id so you can manage multi-tab browser workflows.",
    policy: "inspect",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
];
