export const DESKTOP_BROWSER_TOOL_IDS = [
  "browser_navigate",
  "browser_open_tab",
  "browser_wait_for_selector",
  "browser_wait_for_url",
  "browser_wait_for_load_state",
  "browser_get_state",
  "browser_click",
  "browser_context_click",
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
        confirm: { type: "boolean" },
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
        confirm: { type: "boolean" },
      },
    },
  },
  {
    id: "browser_wait_for_selector",
    description:
      "Wait until a selector appears (or matches the requested state) in the current browser page before continuing interaction. Use this to reduce flakiness after navigation or mutation.",
    policy: "inspect",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["selector"],
      properties: {
        selector: { type: "string", minLength: 1 },
        state: { type: "string", enum: ["present", "visible", "hidden"] },
        timeout_ms: { type: "integer", minimum: 1 },
        interval_ms: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    id: "browser_wait_for_url",
    description:
      "Wait until the active page URL matches an expected value. Supports exact, contains, and regex matching modes.",
    policy: "inspect",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", minLength: 1 },
        mode: { type: "string", enum: ["exact", "contains", "regex"] },
        timeout_ms: { type: "integer", minimum: 1 },
        interval_ms: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    id: "browser_wait_for_load_state",
    description:
      "Wait for browser readiness state. `domcontentloaded` waits for DOM readiness, `load` waits for full document load, and `networkidle` waits for page loading to settle.",
    policy: "inspect",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        state: { type: "string", enum: ["domcontentloaded", "load", "networkidle"] },
        timeout_ms: { type: "integer", minimum: 1 },
        interval_ms: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    id: "browser_get_state",
    description:
      "Read the current desktop browser page, visible interactive elements, visible media such as images, and optional screenshot. Prefer this as the DOM-first browser inspection tool for actions and structured extraction. Supports selector scoping and paged windows for elements/media to keep results compact while preserving continuation metadata. Set include_page_text=true only when you need page text, and include_screenshot=true when visual confirmation matters or DOM signals are ambiguous.",
    policy: "inspect",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        include_page_text: { type: "boolean" },
        include_screenshot: { type: "boolean" },
        scope_selector: { type: "string", minLength: 1 },
        element_offset: { type: "integer", minimum: 0 },
        element_limit: { type: "integer", minimum: 1 },
        media_offset: { type: "integer", minimum: 0 },
        media_limit: { type: "integer", minimum: 1 },
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
        confirm: { type: "boolean" },
      },
    },
  },
  {
    id: "browser_context_click",
    description:
      "Open the native browser context menu on an interactive element or visible media item from browser_get_state by index. Use target=`media` for images and other visible media content.",
    policy: "mutate",
    session_scope: "workspace_session_only",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["index"],
      properties: {
        index: { type: "integer", minimum: 1 },
        target: { type: "string", enum: ["element", "media"] },
        confirm: { type: "boolean" },
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
        confirm: { type: "boolean" },
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
        confirm: { type: "boolean" },
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
        confirm: { type: "boolean" },
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
      properties: {
        confirm: { type: "boolean" },
      },
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
      properties: {
        confirm: { type: "boolean" },
      },
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
      properties: {
        confirm: { type: "boolean" },
      },
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
