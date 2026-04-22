import {
  executeRuntimeToolCapability,
  resolveRuntimeToolCapabilityBaseUrl,
  runtimeToolCapabilityAvailable,
} from "./runtime-tool-capability-client.js";
import {
  RUNTIME_AGENT_TOOL_DEFINITIONS,
  RUNTIME_AGENT_TOOL_IDS,
  type RuntimeAgentToolId,
} from "./runtime-agent-tools.js";

const CRONJOB_DELIVERY_CHANNELS = ["system_notification", "session_run"] as const;
const CRONJOB_DELIVERY_MODES = ["announce", "none"] as const;

export interface HarnessRuntimeToolOptions {
  runtimeApiBaseUrl: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  inputId?: string | null;
  selectedModel?: string | null;
  fetchImpl?: typeof fetch;
}

export interface HarnessRuntimeToolDefinitionLike {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: Record<string, unknown>;
  execute: (...args: any[]) => Promise<any>;
}

function literalStringUnion(values: readonly string[], description: string): Record<string, unknown> {
  return {
    anyOf: values.map((value) => ({ type: "string", const: value })),
    description,
  };
}

function cronjobDeliveryChannelSchema(): Record<string, unknown> {
  return literalStringUnion(
    CRONJOB_DELIVERY_CHANNELS,
    "Delivery channel. Use `session_run` for recurring agent work such as running instructions, tasks, analysis, browsing, or writing. Use `system_notification` only for lightweight reminder/notification messages.",
  );
}

function cronjobDeliveryModeSchema(): Record<string, unknown> {
  return literalStringUnion(
    CRONJOB_DELIVERY_MODES,
    "Delivery mode. Allowed values: `announce` or `none`.",
  );
}

function runtimeToolLabel(toolId: RuntimeAgentToolId): string {
  return toolId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function runtimeToolParameters(toolId: RuntimeAgentToolId): Record<string, unknown> {
  switch (toolId) {
    case "holaboss_onboarding_status":
      return { type: "object", properties: {}, additionalProperties: false };
    case "holaboss_onboarding_complete":
      return {
        type: "object",
        properties: {
          summary: { type: "string", description: "Summary of the onboarding outcome." },
          requested_by: { type: "string", description: "Actor requesting completion." },
        },
        required: ["summary"],
        additionalProperties: false,
      };
    case "holaboss_cronjobs_list":
      return {
        type: "object",
        properties: {
          enabled_only: { type: "boolean", description: "Only return enabled cronjobs." },
        },
        additionalProperties: false,
      };
    case "holaboss_cronjobs_get":
    case "holaboss_cronjobs_delete":
      return {
        type: "object",
        properties: {
          job_id: { type: "string", description: "Cronjob id." },
        },
        required: ["job_id"],
        additionalProperties: false,
      };
    case "holaboss_cronjobs_create":
      return {
        type: "object",
        properties: {
          cron: { type: "string", description: "Cron expression." },
          description: { type: "string", description: "Short display description for the cronjob." },
          instruction: {
            type: "string",
            description: "The exact task to execute when the cronjob runs. Keep schedule wording out of this field.",
          },
          initiated_by: { type: "string", description: "Actor creating the cronjob." },
          name: { type: "string", description: "Optional cronjob name." },
          enabled: { type: "boolean", description: "Whether the cronjob is enabled." },
          delivery_channel: cronjobDeliveryChannelSchema(),
          delivery_mode: cronjobDeliveryModeSchema(),
          delivery_to: { type: "string", description: "Optional delivery target." },
          metadata_json: {
            type: "string",
            description:
              "JSON object string for cronjob metadata. For `system_notification`, include a short `message`. For `session_run`, use metadata for execution context only; keep the actual task instruction in `instruction`.",
          },
        },
        required: ["cron", "description", "instruction"],
        additionalProperties: false,
      };
    case "holaboss_cronjobs_update":
      return {
        type: "object",
        properties: {
          job_id: { type: "string", description: "Cronjob id." },
          name: { type: "string", description: "Optional cronjob name." },
          cron: { type: "string", description: "Cron expression." },
          description: { type: "string", description: "Short display description for the cronjob." },
          instruction: {
            type: "string",
            description: "The exact task to execute when the cronjob runs. Keep schedule wording out of this field.",
          },
          enabled: { type: "boolean", description: "Whether the cronjob is enabled." },
          delivery_channel: cronjobDeliveryChannelSchema(),
          delivery_mode: cronjobDeliveryModeSchema(),
          delivery_to: { type: "string", description: "Optional delivery target." },
          metadata_json: {
            type: "string",
            description:
              "JSON object string for cronjob metadata. For `system_notification`, include a short `message`. For `session_run`, use metadata for execution context only; keep the actual task instruction in `instruction`.",
          },
        },
        required: ["job_id"],
        additionalProperties: false,
      };
    case "image_generate":
      return {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Prompt describing the image to generate." },
          filename: { type: "string", description: "Optional output filename for the generated image." },
          size: { type: "string", description: "Optional provider-specific size hint such as `1024x1024`." },
        },
        required: ["prompt"],
        additionalProperties: false,
      };
    case "download_url":
      return {
        type: "object",
        properties: {
          url: { type: "string", description: "Direct http or https URL to download." },
          output_path: {
            type: "string",
            description:
              "Optional workspace-relative destination path. If omitted, the runtime saves the file under Downloads/ with an inferred filename.",
          },
          expected_mime_prefix: {
            type: "string",
            description:
              "Optional MIME prefix such as `image/` or `application/pdf` used to fail fast if the response type is not what you expect.",
          },
          overwrite: {
            type: "boolean",
            description:
              "Overwrite an existing file when output_path is provided. Ignored when output_path is omitted.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      };
    case "write_report":
      return {
        type: "object",
        properties: {
          title: { type: "string", description: "Optional report title shown in the artifact list." },
          filename: { type: "string", description: "Optional markdown filename stem for the saved report." },
          summary: { type: "string", description: "Optional short summary for artifact metadata and follow-up context." },
          content: {
            type: "string",
            description:
              "Full markdown report content to save as an artifact. Put the detailed research findings in this field instead of in chat.",
          },
        },
        required: ["content"],
        additionalProperties: false,
      };
    case "terminal_sessions_list":
      return { type: "object", properties: {}, additionalProperties: false };
    case "terminal_session_start":
      return {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "Shell command text to run in a background PTY session. This command is already executed through the workspace shell.",
          },
          title: { type: "string", description: "Optional display title for the terminal session." },
          cwd: {
            type: "string",
            description: "Optional workspace-relative working directory. Defaults to the workspace root.",
          },
          cols: { type: "number", description: "Optional terminal width in columns." },
          rows: { type: "number", description: "Optional terminal height in rows." },
        },
        required: ["command"],
        additionalProperties: false,
      };
    case "terminal_session_get":
    case "terminal_session_close":
      return {
        type: "object",
        properties: {
          terminal_id: { type: "string", description: "Terminal session id." },
        },
        required: ["terminal_id"],
        additionalProperties: false,
      };
    case "terminal_session_read":
    case "terminal_session_wait":
      return {
        type: "object",
        properties: {
          terminal_id: { type: "string", description: "Terminal session id." },
          after_sequence: {
            type: "number",
            description: "Only return events with sequence greater than this number.",
          },
          limit: {
            type: "number",
            description: "Maximum number of events to return.",
          },
          ...(toolId === "terminal_session_wait"
            ? {
                timeout_ms: {
                  type: "number",
                  description:
                    "Maximum time to wait for new output or a status change before returning with timed_out=true.",
                },
              }
            : {}),
        },
        required: ["terminal_id"],
        additionalProperties: false,
      };
    case "terminal_session_send_input":
      return {
        type: "object",
        properties: {
          terminal_id: { type: "string", description: "Terminal session id." },
          data: {
            type: "string",
            description:
              "Input to write to the terminal session. Include a trailing newline or carriage return when the command expects Enter.",
          },
        },
        required: ["terminal_id", "data"],
        additionalProperties: false,
      };
    case "terminal_session_signal":
      return {
        type: "object",
        properties: {
          terminal_id: { type: "string", description: "Terminal session id." },
          signal: { type: "string", description: "Optional signal name such as SIGINT, SIGTERM, or SIGHUP." },
        },
        required: ["terminal_id"],
        additionalProperties: false,
      };
  }
}

function runtimeToolPromptGuidelines(toolId: RuntimeAgentToolId): string[] {
  if (toolId === "download_url") {
    return [
      "Use `download_url` when you already have a direct asset URL and need the file saved into the workspace.",
      "Prefer `download_url` over browser-only downloads or ad hoc shell fetches for straightforward remote file saves.",
      "Omit `output_path` when the default workspace Downloads folder is fine; provide a workspace-relative path when the file must land in a specific location.",
      "Set `expected_mime_prefix` when the user asked for a specific file type such as an image or PDF, or when saving the wrong content would be risky.",
    ];
  }
  if (toolId === "write_report") {
    return [
      "Use `write_report` for research summaries, investigations, audits, plans, reviews, comparisons, timelines, and other long or evidence-heavy answers that should be saved as artifacts.",
      "Do not use `write_report` for a simple fact lookup, definition, brief clarification, current-page answer, or any other reply that is naturally short and self-contained.",
      "Prefer `write_report` when you are synthesizing multiple sources, summarizing current or latest developments, or producing findings the user may want to reference later.",
      "If the user explicitly asked for research, latest news, analysis, comparison, or a timeline and you gathered findings from multiple sources, call `write_report` before your final answer.",
      "A step like 'summarize findings for the user' still means: save the full findings with `write_report`, then keep the chat reply brief.",
      "After calling `write_report`, keep the chat reply short: mention the report title or path and give only the key takeaways.",
      "Write the full markdown report in `content` instead of pasting the full report inline in chat.",
    ];
  }
  if (
    toolId === "terminal_session_start" ||
    toolId === "terminal_session_read" ||
    toolId === "terminal_session_wait"
  ) {
    return [
      "Prefer `bash` for short one-shot commands that should complete within the current tool call.",
      "Prefer background terminal sessions for long-running commands, dev servers, watch processes, interactive prompts, or work you may need to revisit later in the run.",
      "After starting a terminal session, use `terminal_session_read` or `terminal_session_wait` to inspect output before claiming success.",
      "Use workspace-relative `cwd` values when you need a subdirectory; otherwise let the session start at the workspace root.",
      "When a background terminal is no longer needed, stop it with `terminal_session_signal` or `terminal_session_close` instead of leaving it running indefinitely.",
    ];
  }
  return [];
}

export function createHarnessRuntimeToolDefinition(
  toolId: RuntimeAgentToolId,
  description: string,
  options: HarnessRuntimeToolOptions,
): HarnessRuntimeToolDefinitionLike {
  return {
    name: toolId,
    label: runtimeToolLabel(toolId),
    description,
    promptSnippet: `${toolId}: ${description}`,
    promptGuidelines: runtimeToolPromptGuidelines(toolId),
    parameters: runtimeToolParameters(toolId),
    execute: async (_toolCallId, toolParams, signal) =>
      await executeRuntimeToolCapability({
        toolId,
        toolParams,
        runtimeApiBaseUrl: options.runtimeApiBaseUrl,
        workspaceId: options.workspaceId,
        sessionId: options.sessionId,
        inputId: options.inputId,
        selectedModel: options.selectedModel,
        fetchImpl: options.fetchImpl,
        signal,
      }),
  };
}

export async function resolveHarnessRuntimeToolDefinitions(
  options: {
    runtimeApiBaseUrl?: string | null;
    workspaceId?: string | null;
    sessionId?: string | null;
    inputId?: string | null;
    selectedModel?: string | null;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<HarnessRuntimeToolDefinitionLike[]> {
  const runtimeApiBaseUrl = resolveRuntimeToolCapabilityBaseUrl(
    options.runtimeApiBaseUrl ?? process.env.SANDBOX_RUNTIME_API_URL,
  );
  if (!runtimeApiBaseUrl) {
    return [];
  }

  const available = await runtimeToolCapabilityAvailable({
    runtimeApiBaseUrl,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
    inputId: options.inputId,
    selectedModel: options.selectedModel,
    fetchImpl: options.fetchImpl,
  });
  if (!available) {
    return [];
  }

  return RUNTIME_AGENT_TOOL_DEFINITIONS.map((tool) =>
    createHarnessRuntimeToolDefinition(tool.id, tool.description, {
      runtimeApiBaseUrl,
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
      inputId: options.inputId,
      selectedModel: options.selectedModel,
      fetchImpl: options.fetchImpl,
    }),
  );
}

export { RUNTIME_AGENT_TOOL_IDS };
