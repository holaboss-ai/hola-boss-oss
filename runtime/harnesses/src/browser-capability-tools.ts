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
          confirm: {
            type: "boolean",
            description:
              "Set true when the runtime browser safety policy requires explicit confirmation for this action category.",
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
          confirm: {
            type: "boolean",
            description:
              "Set true when the runtime browser safety policy requires explicit confirmation for this action category.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      };
    case "browser_wait_for_selector":
      return {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector to wait for.",
            minLength: 1,
          },
          state: literalStringUnion(
            ["present", "visible", "hidden"],
            "Selector wait mode.",
          ),
          timeout_ms: {
            type: "integer",
            description: "Maximum wait time in milliseconds.",
            minimum: 1,
          },
          interval_ms: {
            type: "integer",
            description: "Polling interval in milliseconds.",
            minimum: 1,
          },
        },
        required: ["selector"],
        additionalProperties: false,
      };
    case "browser_wait_for_url":
      return {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Expected URL token or pattern.",
            minLength: 1,
          },
          mode: literalStringUnion(
            ["exact", "contains", "regex"],
            "URL matching mode.",
          ),
          timeout_ms: {
            type: "integer",
            description: "Maximum wait time in milliseconds.",
            minimum: 1,
          },
          interval_ms: {
            type: "integer",
            description: "Polling interval in milliseconds.",
            minimum: 1,
          },
        },
        required: ["url"],
        additionalProperties: false,
      };
    case "browser_wait_for_load_state":
      return {
        type: "object",
        properties: {
          state: literalStringUnion(
            ["domcontentloaded", "load", "networkidle"],
            "Load state to wait for.",
          ),
          timeout_ms: {
            type: "integer",
            description: "Maximum wait time in milliseconds.",
            minimum: 1,
          },
          interval_ms: {
            type: "integer",
            description: "Polling interval in milliseconds.",
            minimum: 1,
          },
        },
        additionalProperties: false,
      };
    case "browser_get_state":
      return {
        type: "object",
        properties: {
          include_page_text: {
            type: "boolean",
            description:
              "Include current page text when content extraction is needed. Leave false for cheaper action-focused state checks.",
          },
          include_screenshot: {
            type: "boolean",
            description:
              "Include a page screenshot when visual appearance, layout, overlays, charts, PDFs, or user-visible confirmation matter, or when DOM signals are ambiguous.",
          },
          scope_selector: {
            type: "string",
            description:
              "Optional CSS selector to scope extraction to a page subtree. Useful for dense pages where only one region is relevant.",
            minLength: 1,
          },
          element_offset: {
            type: "integer",
            description:
              "Zero-based offset into the full interactive-element list for paged browsing.",
            minimum: 0,
          },
          element_limit: {
            type: "integer",
            description:
              "Maximum interactive elements to return for this call. Use with element_offset for continuation.",
            minimum: 1,
          },
          media_offset: {
            type: "integer",
            description:
              "Zero-based offset into the full visible-media list for paged browsing.",
            minimum: 0,
          },
          media_limit: {
            type: "integer",
            description:
              "Maximum media entries to return for this call. Use with media_offset for continuation.",
            minimum: 1,
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
          confirm: {
            type: "boolean",
            description:
              "Set true when the runtime browser safety policy requires explicit confirmation for this action category.",
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
          confirm: {
            type: "boolean",
            description:
              "Set true when the runtime browser safety policy requires explicit confirmation for this action category.",
          },
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
          confirm: {
            type: "boolean",
            description:
              "Set true when the runtime browser safety policy requires explicit confirmation for this action category.",
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
          confirm: {
            type: "boolean",
            description:
              "Set true when the runtime browser safety policy requires explicit confirmation for this action category.",
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
          confirm: {
            type: "boolean",
            description:
              "Set true when the runtime browser safety policy requires explicit confirmation for this action category.",
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
        properties:
          toolId === "browser_list_tabs"
            ? {}
            : {
                confirm: {
                  type: "boolean",
                  description:
                    "Set true when the runtime browser safety policy requires explicit confirmation for this action category.",
                },
              },
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
