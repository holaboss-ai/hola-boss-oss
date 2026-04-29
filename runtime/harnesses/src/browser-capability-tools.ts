import {
  browserCapabilityAvailable,
  executeBrowserCapabilityTool,
  resolveBrowserCapabilityBaseUrl,
} from "./browser-capability-client.js";
import {
  DESKTOP_BROWSER_TOOL_DEFINITIONS,
  type DesktopBrowserToolDefinition,
  type DesktopBrowserToolId,
} from "./desktop-browser-tools.js";

export interface HarnessDesktopBrowserToolOptions {
  runtimeApiBaseUrl: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  space?: "agent" | "user" | null;
  fetchImpl?: typeof fetch;
}

export interface HarnessDesktopBrowserToolDefinitionLike {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  parameters: Record<string, unknown>;
  execute: (...args: any[]) => Promise<any>;
}

function browserToolLabel(toolId: DesktopBrowserToolId): string {
  return toolId
    .split("_")
    .map((part) => (part === "browser" ? "Browser" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function literalStringUnion(values: string[], description: string): Record<string, unknown> {
  return {
    anyOf: values.map((value) => ({ type: "string", const: value })),
    description,
  };
}

function browserLocatorProperties(): Record<string, unknown> {
  return {
    ref: {
      type: "string",
      description: "Stable ref returned by browser_find.",
    },
    text: {
      type: "string",
      description: "Visible text to find. Matches case-insensitively unless exact=true.",
    },
    label: {
      type: "string",
      description: "Accessible label, title, aria-label, value, or nearby label text to find.",
    },
    placeholder: {
      type: "string",
      description: "Input placeholder text to find.",
    },
    role: {
      type: "string",
      description: "ARIA or inferred element role, such as button, link, textbox, combobox, option, dialog, or menuitem.",
    },
    selector: {
      type: "string",
      description: "CSS selector to locate the target.",
    },
    xpath: {
      type: "string",
      description: "XPath expression to locate the target.",
    },
    exact: {
      type: "boolean",
      description: "Require an exact normalized text/label/placeholder match.",
    },
    scope: {
      anyOf: [
        { type: "string", const: "main" },
        { type: "string", const: "viewport" },
        { type: "string", const: "focused" },
        { type: "string", const: "dialog" },
        { type: "string", const: "active_dialog" },
        { type: "string", const: "modal" },
      ],
      description:
        "Limit matching to the main document, current viewport, focused subtree, or active dialog. `active_dialog` and `modal` are accepted aliases for `dialog`.",
    },
  };
}

function browserToolParameters(toolId: DesktopBrowserToolId): Record<string, unknown> {
  switch (toolId) {
    case "browser_navigate":
      return {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to open in the in-app browser.",
            minLength: 1,
          },
        },
        required: ["url"],
        additionalProperties: false,
      };
    case "browser_open_tab":
      return {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to open in a new in-app browser tab.",
            minLength: 1,
          },
          background: {
            type: "boolean",
            description: "Open the tab without switching focus.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      };
    case "browser_get_state":
      return {
        type: "object",
        properties: {
          mode: {
            anyOf: [
              { type: "string", const: "state" },
              { type: "string", const: "text" },
              { type: "string", const: "structured" },
              { type: "string", const: "visual" },
            ],
            description:
              "State mode to return. Use `state` by default, `text` for scoped visible text, `structured` for schema-like extraction state, and `visual` only when a screenshot is needed.",
          },
          scope: {
            anyOf: [
              { type: "string", const: "main" },
              { type: "string", const: "viewport" },
              { type: "string", const: "focused" },
              { type: "string", const: "dialog" },
              { type: "string", const: "active_dialog" },
              { type: "string", const: "modal" },
            ],
            description:
              "Limit browser state to the main document, viewport, focused element subtree, or active dialog. `active_dialog` and `modal` are accepted aliases for `dialog`.",
          },
          max_nodes: {
            type: "integer",
            description:
              "Maximum combined element/media nodes to return. Returned indexes still reference the original page order for follow-up click/type tools.",
            minimum: 1,
          },
          include_page_text: {
            type: "boolean",
            description:
              "Include current page text when content extraction is needed. Leave false for cheaper action-focused state checks.",
          },
          include_screenshot: {
            type: "boolean",
            description:
              "Include a page screenshot artifact handle when visual appearance, layout, overlays, charts, PDFs, or user-visible confirmation matter, or when DOM signals are ambiguous.",
          },
        },
        additionalProperties: false,
      };
    case "browser_find":
      return {
        type: "object",
        properties: {
          ...browserLocatorProperties(),
          include_hidden: {
            type: "boolean",
            description: "Include hidden/offscreen elements. Leave false for ordinary browser interaction.",
          },
          max_results: {
            type: "integer",
            description: "Maximum matches to return.",
            minimum: 1,
            maximum: 100,
          },
        },
        additionalProperties: false,
      };
    case "browser_act":
      return {
        type: "object",
        properties: {
          action: literalStringUnion(
            ["click", "double_click", "hover", "focus", "fill", "type", "press", "select", "scroll_into_view"],
            "Browser action to perform.",
          ),
          ...browserLocatorProperties(),
          value: {
            type: "string",
            description: "Text/value for fill, type, or select actions.",
          },
          key: {
            type: "string",
            description: "Keyboard key for press actions.",
          },
          clear: {
            type: "boolean",
            description: "Clear editable content before fill/type. Defaults true for fill and false for type.",
          },
          submit: {
            type: "boolean",
            description: "Submit after fill/type, usually by pressing Enter or requestSubmit.",
          },
        },
        required: ["action"],
        additionalProperties: false,
      };
    case "browser_wait":
      return {
        type: "object",
        properties: {
          condition: literalStringUnion(
            ["load", "url", "text", "element", "hidden", "dom_change", "dom_mutation", "change", "mutation"],
            "Browser condition to wait for.",
          ),
          url: {
            type: "string",
            description: "URL substring or regular expression body to wait for when condition=url.",
          },
          ...browserLocatorProperties(),
          timeout_ms: {
            type: "integer",
            description: "Maximum wait time in milliseconds.",
            minimum: 100,
            maximum: 30000,
          },
        },
        additionalProperties: false,
      };
    case "browser_evaluate":
      return {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "JavaScript expression or IIFE to evaluate in the active page.",
            minLength: 1,
          },
          allow_mutation: {
            type: "boolean",
            description:
              "Set true when the expression intentionally mutates page state. Leave false for read-only inspection.",
          },
          timeout_ms: {
            type: "integer",
            description: "Maximum evaluation time in milliseconds.",
            minimum: 100,
            maximum: 30000,
          },
        },
        required: ["expression"],
        additionalProperties: false,
      };
    case "browser_debug":
      return {
        type: "object",
        properties: {
          x: {
            type: "number",
            description: "Viewport x coordinate for elementFromPoint hit testing.",
          },
          y: {
            type: "number",
            description: "Viewport y coordinate for elementFromPoint hit testing.",
          },
          include_dom_sample: {
            type: "boolean",
            description: "Include a compact sample of visible DOM text and element tags.",
          },
        },
        additionalProperties: false,
      };
    case "browser_click":
      return {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Interactive element index from browser_get_state.",
            minimum: 1,
          },
        },
        required: ["index"],
        additionalProperties: false,
      };
    case "browser_context_click":
      return {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Element or media index from browser_get_state.",
            minimum: 1,
          },
          target: literalStringUnion(
            ["element", "media"],
            "Target list to use for the index. Use `media` for visible images or other media items.",
          ),
        },
        required: ["index"],
        additionalProperties: false,
      };
    case "browser_type":
      return {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Interactive element index from browser_get_state.",
            minimum: 1,
          },
          text: {
            type: "string",
            description: "Text to enter into the target element.",
          },
          clear: {
            type: "boolean",
            description: "Clear the target element before typing.",
          },
          submit: {
            type: "boolean",
            description: "Submit after typing, typically by pressing Enter.",
          },
        },
        required: ["index", "text"],
        additionalProperties: false,
      };
    case "browser_press":
      return {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Keyboard key to press.",
            minLength: 1,
          },
        },
        required: ["key"],
        additionalProperties: false,
      };
    case "browser_scroll":
      return {
        type: "object",
        properties: {
          direction: literalStringUnion(["up", "down"], "Scroll direction when delta_y is not provided."),
          amount: {
            type: "integer",
            description: "Positive scroll amount.",
            minimum: 1,
          },
          delta_y: {
            type: "integer",
            description: "Raw vertical scroll delta.",
          },
        },
        additionalProperties: false,
      };
    case "browser_screenshot":
      return {
        type: "object",
        properties: {
          format: literalStringUnion(["png", "jpeg"], "Screenshot image format."),
          quality: {
            type: "integer",
            description: "JPEG quality from 0-100.",
            minimum: 0,
            maximum: 100,
          },
        },
        additionalProperties: false,
      };
    case "browser_back":
    case "browser_forward":
    case "browser_reload":
    case "browser_list_tabs":
      return {
        type: "object",
        properties: {},
        additionalProperties: false,
      };
  }
}

export function createHarnessDesktopBrowserToolDefinition(
  definition: DesktopBrowserToolDefinition,
  options: HarnessDesktopBrowserToolOptions,
): HarnessDesktopBrowserToolDefinitionLike {
  return {
    name: definition.id,
    label: browserToolLabel(definition.id),
    description: definition.description,
    promptSnippet: `${definition.id}: ${definition.description}`,
    parameters: browserToolParameters(definition.id),
    execute: async (_toolCallId, toolParams, signal) =>
      await executeBrowserCapabilityTool({
        toolId: definition.id,
        toolParams,
        runtimeApiBaseUrl: options.runtimeApiBaseUrl,
        workspaceId: options.workspaceId,
        sessionId: options.sessionId,
        space: options.space,
        fetchImpl: options.fetchImpl,
        signal,
      }),
  };
}

export function createHarnessDesktopBrowserToolDefinitions(
  options: HarnessDesktopBrowserToolOptions,
): HarnessDesktopBrowserToolDefinitionLike[] {
  return DESKTOP_BROWSER_TOOL_DEFINITIONS.map((definition) =>
    createHarnessDesktopBrowserToolDefinition(definition, options),
  );
}

export async function resolveHarnessDesktopBrowserToolDefinitions(
  options: {
    runtimeApiBaseUrl?: string | null;
    workspaceId?: string | null;
    sessionId?: string | null;
    space?: "agent" | "user" | null;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<HarnessDesktopBrowserToolDefinitionLike[]> {
  const runtimeApiBaseUrl = resolveBrowserCapabilityBaseUrl(
    options.runtimeApiBaseUrl ?? process.env.SANDBOX_RUNTIME_API_URL,
  );
  if (!runtimeApiBaseUrl) {
    return [];
  }

  const available = await browserCapabilityAvailable({
    runtimeApiBaseUrl,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
    space: options.space,
    fetchImpl: options.fetchImpl,
  });
  if (!available) {
    return [];
  }

  return createHarnessDesktopBrowserToolDefinitions({
    runtimeApiBaseUrl,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
    space: options.space,
    fetchImpl: options.fetchImpl,
  });
}
