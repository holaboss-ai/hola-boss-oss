import fs from "node:fs";
import path from "node:path";

import type { RuntimeStateStore, SessionInputRecord, WorkspaceRecord } from "@holaboss/runtime-state-store";

import { buildRunFailedEvent, executeRunnerRequest, type RunnerEvent } from "./runner-worker.js";
import { resolveProductRuntimeConfig } from "./runtime-config.js";
import { normalizeHarnessId, resolveRuntimeHarnessAdapter } from "./harness-registry.js";

const ONBOARD_PROMPT_HEADER = "[Holaboss Workspace Onboarding v1]";
const RUNTIME_EXEC_CONTEXT_KEY = "_sandbox_runtime_exec_v1";
const RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY = "model_proxy_api_key";
const RUNTIME_EXEC_SANDBOX_ID_KEY = "sandbox_id";

interface SessionInputAttachment {
  id: string;
  kind: "image" | "file";
  name: string;
  mime_type: string;
  size_bytes: number;
  workspace_path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSessionInputAttachment(value: unknown): SessionInputAttachment | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const mimeType = typeof value.mime_type === "string" ? value.mime_type.trim() : "";
  const workspacePath = typeof value.workspace_path === "string" ? value.workspace_path.trim() : "";
  const sizeBytes = typeof value.size_bytes === "number" && Number.isFinite(value.size_bytes) ? value.size_bytes : 0;
  const kind = value.kind === "image" ? "image" : value.kind === "file" ? "file" : mimeType.startsWith("image/") ? "image" : "file";
  if (!id || !name || !mimeType || !workspacePath) {
    return null;
  }
  return {
    id,
    kind,
    name,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    workspace_path: workspacePath
  };
}

function sessionInputAttachments(value: unknown): SessionInputAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseSessionInputAttachment(item)).filter((item): item is SessionInputAttachment => Boolean(item));
}

function defaultInstructionForAttachments(attachments: SessionInputAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }
  if (attachments.length === 1) {
    return attachments[0].kind === "image" ? "Review the attached image." : "Review the attached file.";
  }
  return attachments.some((attachment) => attachment.kind === "image")
    ? "Review the attached files and images."
    : "Review the attached files.";
}

function selectedHarness(): string {
  return normalizeHarnessId(process.env.SANDBOX_AGENT_HARNESS);
}

function ensureLocalBinding(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  sessionId: string;
  harness: string;
}): string {
  const existing = params.store.getBinding({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId
  });
  if (existing && existing.harnessSessionId.trim()) {
    return existing.harnessSessionId;
  }
  const binding = params.store.upsertBinding({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    harness: params.harness,
    harnessSessionId: params.sessionId
  });
  return binding.harnessSessionId;
}

function buildOnboardingInstruction(params: {
  workspaceRoot: string;
  workspaceId: string;
  sessionId: string;
  text: string;
  attachments: SessionInputAttachment[];
  workspace: WorkspaceRecord;
}): string {
  const trimmed = params.text.trim() || defaultInstructionForAttachments(params.attachments);
  if (!trimmed) {
    throw new Error("text or attachments are required");
  }
  const onboardingStatus = (params.workspace.onboardingStatus ?? "").trim().toLowerCase();
  const onboardingSessionId = (params.workspace.onboardingSessionId ?? "").trim();
  if (!["pending", "awaiting_confirmation"].includes(onboardingStatus) || onboardingSessionId !== params.sessionId) {
    return trimmed;
  }

  const onboardPath = path.join(params.workspaceRoot, params.workspaceId, "ONBOARD.md");
  if (!fs.existsSync(onboardPath)) {
    return trimmed;
  }
  const rawOnboardPrompt = fs.readFileSync(onboardPath, "utf8").trim();
  if (!rawOnboardPrompt || trimmed.startsWith(ONBOARD_PROMPT_HEADER)) {
    return trimmed;
  }

  return [
    ONBOARD_PROMPT_HEADER,
    "- You are in onboarding mode for this workspace.",
    `- The workspace directory is ./${params.workspaceId} relative to the current working directory.`,
    `- The onboarding guide file is ./${params.workspaceId}/ONBOARD.md (absolute path: ${onboardPath}).`,
    "- Use that workspace-scoped ONBOARD.md to drive the conversation and gather required details.",
    "- ONBOARD.md content is already included below; do not re-read it unless needed.",
    `- If file reads are needed, use ./${params.workspaceId}/... paths rather than files directly under ${params.workspaceRoot}.`,
    "- Ask concise questions and collect durable facts/preferences.",
    "- Do not start regular execution work until onboarding is complete.",
    "- Relevant native onboarding tools:",
    "- `holaboss_onboarding_status` reads the local onboarding status for this workspace.",
    "- `holaboss_onboarding_complete` marks onboarding complete. Required argument: `summary`. Optional argument: `requested_by`.",
    "- When all onboarding requirements are satisfied and the user confirms, call `holaboss_onboarding_complete` with a concise durable summary.",
    "",
    "[ONBOARD.md]",
    rawOnboardPrompt,
    "[/ONBOARD.md]",
    "",
    trimmed
  ].join("\n").trim();
}

function createdAtForEvent(event: RunnerEvent): string | undefined {
  return typeof event.timestamp === "string" && event.timestamp.trim() ? event.timestamp : undefined;
}

function inferSessionKind(params: {
  workspace: WorkspaceRecord;
  sessionId: string;
  persistedKind?: string | null;
}): string {
  const persistedKind = typeof params.persistedKind === "string" ? params.persistedKind.trim() : "";
  if (persistedKind) {
    return persistedKind;
  }
  const sessionId = params.sessionId.trim();
  if (sessionId && sessionId === (params.workspace.mainSessionId ?? "").trim()) {
    return "main";
  }
  const onboardingSessionId = (params.workspace.onboardingSessionId ?? "").trim();
  const onboardingStatus = (params.workspace.onboardingStatus ?? "").trim().toLowerCase();
  if (sessionId && sessionId === onboardingSessionId && ["pending", "awaiting_confirmation", "in_progress"].includes(onboardingStatus)) {
    return "onboarding";
  }
  return "workspace_session";
}

function payloadForEvent(event: RunnerEvent): Record<string, unknown> {
  return isRecord(event.payload) ? event.payload : {};
}

function terminalStatusForCompletedPayload(
  payload: Record<string, unknown>,
  supportsWaitingUser: boolean
): "IDLE" | "WAITING_USER" {
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  return supportsWaitingUser && status === "waiting_user" ? "WAITING_USER" : "IDLE";
}

function maybePersistHarnessSessionId(params: {
  store: RuntimeStateStore;
  workspaceId: string;
  sessionId: string;
  harness: string;
  eventType: string;
  payload: Record<string, unknown>;
}): void {
  if (!["run_completed", "run_failed"].includes(params.eventType)) {
    return;
  }
  const harnessSessionId = params.payload.harness_session_id;
  if (typeof harnessSessionId !== "string" || !harnessSessionId.trim()) {
    return;
  }
  params.store.upsertBinding({
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    harness: params.harness,
    harnessSessionId: harnessSessionId.trim()
  });
}

export async function processClaimedInput(params: {
  store: RuntimeStateStore;
  record: SessionInputRecord;
  claimedBy?: string;
  executeRunnerRequestFn?: typeof executeRunnerRequest;
  resolveProductRuntimeConfigFn?: typeof resolveProductRuntimeConfig;
}): Promise<void> {
  const { store, record } = params;
  const workspace = store.getWorkspace(record.workspaceId);
  if (!workspace) {
    store.updateInput(record.inputId, { status: "FAILED" });
    store.updateRuntimeState({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      status: "ERROR",
      currentInputId: null,
      currentWorkerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      lastError: { message: "workspace not found" }
    });
    return;
  }

  const harness = normalizeHarnessId(workspace.harness ?? selectedHarness());
  const session = store.getSession({
    workspaceId: record.workspaceId,
    sessionId: record.sessionId
  });
  const sessionKind = inferSessionKind({
    workspace,
    sessionId: record.sessionId,
    persistedKind: session?.kind
  });
  const harnessSupportsWaitingUser = resolveRuntimeHarnessAdapter(harness)?.capabilities.supportsWaitingUser ?? false;
  const harnessSessionId = ensureLocalBinding({
    store,
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    harness
  });
  const attachments = sessionInputAttachments(record.payload.attachments);

  const instruction = buildOnboardingInstruction({
    workspaceRoot: store.workspaceRoot,
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    text: String(record.payload.text ?? ""),
    attachments,
    workspace
  });

  store.updateRuntimeState({
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    status: "BUSY",
    currentInputId: record.inputId,
    currentWorkerId: params.claimedBy ?? "sandbox-agent-ts-worker",
    leaseUntil: record.claimedUntil,
    heartbeatAt: undefined,
    lastError: null
  });

  const runtimeContext = isRecord(record.payload.context) ? { ...record.payload.context } : {};
  const priorExecContext = isRecord(runtimeContext[RUNTIME_EXEC_CONTEXT_KEY])
    ? { ...runtimeContext[RUNTIME_EXEC_CONTEXT_KEY] }
    : {};
  const resolveRuntimeConfig = params.resolveProductRuntimeConfigFn ?? resolveProductRuntimeConfig;
  const runtimeBinding = resolveRuntimeConfig({
    requireAuth: false,
    requireUser: false,
    requireBaseUrl: false
  });
  if (
    typeof priorExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY] !== "string" &&
    runtimeBinding.authToken
  ) {
    priorExecContext[RUNTIME_EXEC_MODEL_PROXY_API_KEY_KEY] = runtimeBinding.authToken;
  }
  if (typeof priorExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY] !== "string" && runtimeBinding.sandboxId) {
    priorExecContext[RUNTIME_EXEC_SANDBOX_ID_KEY] = runtimeBinding.sandboxId;
  }
  priorExecContext.harness = harness;
  priorExecContext.harness_session_id = harnessSessionId;
  runtimeContext[RUNTIME_EXEC_CONTEXT_KEY] = priorExecContext;

  const payload: Record<string, unknown> = {
    workspace_id: record.workspaceId,
    session_id: record.sessionId,
    session_kind: sessionKind,
    input_id: record.inputId,
    instruction,
    attachments,
    context: runtimeContext,
    model: record.payload.model ?? null,
    debug: false
  };

  const assistantParts: string[] = [];
  let terminalStatus: "IDLE" | "WAITING_USER" | "ERROR" = "IDLE";
  let lastError: Record<string, unknown> | null = null;
  let lastSequence = 0;

  try {
    const executeRunner = params.executeRunnerRequestFn ?? executeRunnerRequest;
    const execution = await executeRunner(payload, {
      onHeartbeat: () => {
        store.updateRuntimeState({
          workspaceId: record.workspaceId,
          sessionId: record.sessionId,
          status: "BUSY",
          currentInputId: record.inputId,
          currentWorkerId: params.claimedBy ?? "sandbox-agent-ts-worker",
          leaseUntil: record.claimedUntil,
          lastError: null
        });
      },
      onEvent: async (event) => {
        const sequence = typeof event.sequence === "number" ? event.sequence : 0;
        lastSequence = Math.max(lastSequence, sequence);
        const eventPayload = payloadForEvent(event);
        store.appendOutputEvent({
          workspaceId: record.workspaceId,
          sessionId: record.sessionId,
          inputId: record.inputId,
          sequence,
          eventType: typeof event.event_type === "string" ? event.event_type : "unknown",
          payload: eventPayload,
          createdAt: createdAtForEvent(event)
        });
        maybePersistHarnessSessionId({
          store,
          workspaceId: record.workspaceId,
          sessionId: record.sessionId,
          harness,
          eventType: typeof event.event_type === "string" ? event.event_type : "unknown",
          payload: eventPayload
        });
        if (event.event_type === "output_delta" && typeof eventPayload.delta === "string") {
          assistantParts.push(eventPayload.delta);
        }
        if (event.event_type === "run_completed") {
          terminalStatus = terminalStatusForCompletedPayload(eventPayload, harnessSupportsWaitingUser);
        }
        if (event.event_type === "run_failed") {
          terminalStatus = "ERROR";
          lastError = eventPayload;
        }
      }
    });

    if (!execution.sawTerminal) {
      const details = execution.skippedLines.length > 0 ? execution.skippedLines.slice(0, 3).join("; ") : "";
      const suffix = details ? ` (skipped output: ${details})` : "";
      const failure = buildRunFailedEvent({
        sessionId: record.sessionId,
        inputId: record.inputId,
        sequence: lastSequence + 1,
        message:
          execution.returnCode !== 0
            ? execution.stderr.trim() || `runner command failed with exit_code=${execution.returnCode}`
            : `runner ended before terminal event${suffix}`,
        errorType: execution.returnCode !== 0 ? "RunnerCommandError" : "RuntimeError"
      });
      const failurePayload = payloadForEvent(failure);
      store.appendOutputEvent({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        inputId: record.inputId,
        sequence: typeof failure.sequence === "number" ? failure.sequence : lastSequence + 1,
        eventType: String(failure.event_type),
        payload: failurePayload
      });
      terminalStatus = "ERROR";
      lastError = failurePayload;
    }

    store.updateInput(record.inputId, {
      status: terminalStatus === "ERROR" ? "FAILED" : "DONE",
      claimedUntil: null
    });
    store.updateRuntimeState({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      status: terminalStatus,
      currentInputId: null,
      currentWorkerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      lastError
    });

    const assistantText = assistantParts.join("").trim();
    if (assistantText) {
      store.insertSessionMessage({
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        role: "assistant",
        text: assistantText,
        messageId: `assistant-${record.inputId}`
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateInput(record.inputId, {
      status: "FAILED",
      claimedUntil: null
    });
    store.appendOutputEvent({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      inputId: record.inputId,
      sequence: 1,
      eventType: "run_failed",
      payload: { message }
    });
    store.updateRuntimeState({
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      status: "ERROR",
      currentInputId: null,
      currentWorkerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      lastError: { message }
    });
  }
}
