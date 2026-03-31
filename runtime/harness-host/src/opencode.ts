import {
  createOpencodeClient,
  type McpLocalConfig,
  type McpRemoteConfig,
  type OutputFormat,
  type ToolPart,
} from "@opencode-ai/sdk/v2";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { JsonObject, JsonValue, OpencodeHarnessHostRequest, RunnerEventType, RunnerOutputEventPayload } from "./contracts.js";

export type OpencodeMappedEvent = {
  event_type: RunnerEventType;
  payload: JsonObject;
};

export type ToolSnapshot = {
  status: string;
  snapshot: string;
};

export type OpencodeEventMapperState = {
  textSnapshots: Map<string, string>;
  toolSnapshots: Map<string, ToolSnapshot>;
  partTypeSnapshots: Map<string, string>;
  partMessageSnapshots: Map<string, string>;
  messageRoleSnapshots: Map<string, string>;
  pendingPartDeltas: Map<string, Array<[string, string]>>;
  pendingMessageEvents: Map<string, OpencodeMappedEvent[]>;
};

const TERMINAL_EVENT_TYPES = new Set<RunnerEventType>(["run_completed", "run_failed"]);

function emitRunnerEvent(
  request: OpencodeHarnessHostRequest,
  sequence: number,
  eventType: RunnerEventType,
  payload: JsonObject
): void {
  const event: RunnerOutputEventPayload = {
    session_id: request.session_id,
    input_id: request.input_id,
    sequence,
    event_type: eventType,
    payload,
  };
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function getPath(record: Record<string, unknown> | null, path: string): unknown {
  if (!record) {
    return undefined;
  }
  let current: unknown = record;
  for (const segment of path.split(".")) {
    const nextRecord = asRecord(current);
    if (!nextRecord) {
      return undefined;
    }
    current = nextRecord[segment];
  }
  return current;
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonValue(item));
  }
  if (value && typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
      return String(value);
    }
  }
  return value === undefined ? null : String(value);
}

function jsonObjectValue(value: unknown): JsonObject | null {
  const normalized = jsonValue(value);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return null;
  }
  return normalized;
}

function snapshotValue(value: unknown): string {
  try {
    return JSON.stringify(jsonValue(value));
  } catch {
    return String(value);
  }
}

function extractErrorMessage(value: unknown): string | undefined {
  const record = asRecord(value);
  return firstNonEmptyString(
    record?.message,
    getPath(record, "error.message"),
    record?.detail,
    getPath(record, "error.detail"),
    typeof value === "string" ? value : undefined
  );
}

function sdkErrorMessage(error: unknown, prefix: string): string {
  const record = asRecord(error);
  const data = asRecord(record?.data);
  const name = firstNonEmptyString(record?.name);
  const message = firstNonEmptyString(
    extractErrorMessage(data),
    extractErrorMessage(record),
    prefix
  );
  const statusCode = firstNumber(data?.statusCode, data?.status, record?.statusCode, record?.status);
  const providerID = firstNonEmptyString(data?.providerID, data?.provider_id, getPath(data, "provider.id"));
  const errorCode = firstNonEmptyString(data?.code, getPath(data, "error.code"), record?.code);

  let summary = message ?? prefix;
  if (name && !summary.startsWith(`${name}:`)) {
    summary = `${name}: ${summary}`;
  }

  const detailParts: string[] = [];
  if (statusCode !== undefined) {
    detailParts.push(`status=${statusCode}`);
  }
  if (errorCode) {
    detailParts.push(`code=${errorCode}`);
  }
  if (providerID) {
    detailParts.push(`provider=${providerID}`);
  }
  return detailParts.length > 0 ? `${summary} (${detailParts.join(", ")})` : summary;
}

export function promptPartsForRequest(request: OpencodeHarnessHostRequest) {
  const parts: Array<
    { type: "text"; text: string } | { type: "file"; url: string; mime: string; filename?: string }
  > = [];
  if (request.instruction.trim()) {
    parts.push({ type: "text", text: request.instruction });
  }
  for (const attachment of request.attachments ?? []) {
    parts.push({
      type: "file",
      url: pathToFileURL(path.resolve(request.workspace_dir, attachment.workspace_path)).toString(),
      mime: attachment.mime_type,
      filename: attachment.name,
    });
  }
  return parts;
}

function requireData<T>(response: { data?: T; error?: unknown }, prefix: string): T {
  if (response.data !== undefined) {
    return response.data;
  }
  throw new Error(sdkErrorMessage(response.error, prefix));
}

function normalizePartType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeMessageRole(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function partValue(part: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!part) {
    return undefined;
  }
  for (const key of keys) {
    if (key in part && part[key] !== undefined) {
      return part[key];
    }
  }
  return undefined;
}

function eventSessionId(rawEvent: unknown): string {
  const payload = asRecord(rawEvent);
  const properties = asRecord(payload?.properties);
  const part = asRecord(properties?.part);
  const info = asRecord(properties?.info);
  return (
    firstNonEmptyString(
      properties?.sessionID,
      properties?.session_id,
      part?.sessionID,
      part?.session_id,
      info?.sessionID,
      info?.session_id
    ) ?? ""
  );
}

function eventDelta(rawEvent: unknown): string {
  const payload = asRecord(rawEvent);
  const properties = asRecord(payload?.properties);
  return typeof properties?.delta === "string" ? properties.delta : "";
}

function eventPart(rawEvent: unknown): Record<string, unknown> | null {
  const payload = asRecord(rawEvent);
  const properties = asRecord(payload?.properties);
  return asRecord(properties?.part);
}

function eventPartId(rawEvent: unknown, part: Record<string, unknown> | null): string {
  const payload = asRecord(rawEvent);
  const properties = asRecord(payload?.properties);
  return (
    firstNonEmptyString(
      partValue(part, "id", "part_id", "partID"),
      properties?.partID,
      properties?.partId,
      properties?.part_id,
      properties?.id
    ) ?? ""
  );
}

function eventMessageId(
  rawEvent: unknown,
  part: Record<string, unknown> | null,
  partMessageSnapshots: Map<string, string>
): string {
  const payload = asRecord(rawEvent);
  const properties = asRecord(payload?.properties);
  const info = asRecord(properties?.info);
  const direct =
    firstNonEmptyString(
      partValue(part, "messageID", "messageId", "message_id"),
      properties?.messageID,
      properties?.messageId,
      properties?.message_id,
      info?.messageID,
      info?.messageId,
      info?.message_id,
      info?.id
    ) ?? "";
  if (direct) {
    return direct;
  }
  const partID = eventPartId(rawEvent, part);
  if (!partID) {
    return "";
  }
  return partMessageSnapshots.get(partID) ?? "";
}

function eventSessionStatusType(rawEvent: unknown): string {
  const payload = asRecord(rawEvent);
  const properties = asRecord(payload?.properties);
  const status = asRecord(properties?.status);
  return firstNonEmptyString(status?.type) ?? "";
}

function textDeltaFromValues(partID: string, text: string, snapshots: Map<string, string>): string {
  const normalizedPartID = partID.trim();
  if (!normalizedPartID) {
    return "";
  }
  const previous = snapshots.get(normalizedPartID) ?? "";
  snapshots.set(normalizedPartID, text);
  if (!text) {
    return "";
  }
  return text.startsWith(previous) ? text.slice(previous.length) : text;
}

function textDelta(part: Record<string, unknown> | null, snapshots: Map<string, string>): string {
  const partID = firstNonEmptyString(partValue(part, "id", "part_id", "partID")) ?? "";
  if (!partID) {
    return "";
  }
  const text = String(partValue(part, "text", "snapshot") ?? "");
  if (!text) {
    return "";
  }
  return textDeltaFromValues(partID, text, snapshots);
}

function partStreamEventType(partType: string): [RunnerEventType, "thinking" | "output"] {
  return normalizePartType(partType) === "reasoning" ? ["thinking_delta", "thinking"] : ["output_delta", "output"];
}

function queuedPartDeltaEvents(
  partID: string,
  partType: string,
  eventName: string,
  pendingPartDeltas: Map<string, Array<[string, string]>>
): OpencodeMappedEvent[] {
  const queued = pendingPartDeltas.get(partID) ?? [];
  pendingPartDeltas.delete(partID);
  if (queued.length === 0) {
    return [];
  }
  const [eventType, deltaKind] = partStreamEventType(partType);
  return queued.map(([queuedEventName, queuedDelta]) => ({
    event_type: eventType,
    payload: {
      delta: queuedDelta,
      event: queuedEventName || eventName,
      source: "opencode",
      part_id: partID,
      part_type: normalizePartType(partType),
      delta_kind: deltaKind,
    },
  }));
}

function discardPartTracking(partID: string, state: OpencodeEventMapperState): void {
  const normalizedPartID = partID.trim();
  if (!normalizedPartID) {
    return;
  }
  state.textSnapshots.delete(normalizedPartID);
  state.partTypeSnapshots.delete(normalizedPartID);
  state.partMessageSnapshots.delete(normalizedPartID);
  state.pendingPartDeltas.delete(normalizedPartID);
}

function releasePendingMessageEvents(
  messageID: string,
  role: string,
  pendingMessageEvents: Map<string, OpencodeMappedEvent[]>
): OpencodeMappedEvent[] {
  const normalizedMessageID = messageID.trim();
  if (!normalizedMessageID) {
    return [];
  }
  const pending = pendingMessageEvents.get(normalizedMessageID) ?? [];
  pendingMessageEvents.delete(normalizedMessageID);
  return role === "assistant" ? pending : [];
}

function flushPendingPartDeltas(pendingPartDeltas: Map<string, Array<[string, string]>>): OpencodeMappedEvent[] {
  const flushed: OpencodeMappedEvent[] = [];
  for (const [partID, queued] of pendingPartDeltas.entries()) {
    for (const [eventName, delta] of queued) {
      if (!delta) {
        continue;
      }
      flushed.push({
        event_type: "output_delta",
        payload: {
          delta,
          event: eventName || "message.part.delta",
          source: "opencode",
          part_id: partID,
          part_type: null,
          delta_kind: "unknown",
          unresolved_part_type: true,
        },
      });
    }
  }
  pendingPartDeltas.clear();
  return flushed;
}

function opencodeToolPayload(
  part: ToolPart | Record<string, unknown>,
  eventName: string,
  snapshots: Map<string, ToolSnapshot>
): JsonObject | null {
  const record = asRecord(part);
  const state = asRecord(record?.state);
  const status = normalizePartType(state?.status);
  if (!["pending", "running", "completed", "error"].includes(status)) {
    return null;
  }

  const phase = status === "pending" || status === "running" ? "started" : status;
  const partID = firstNonEmptyString(record?.id) ?? "";
  const snapshot = snapshotValue(status === "completed" ? state?.output : state?.error);
  const previous = snapshots.get(partID);
  const current = { status, snapshot };
  if (previous && previous.status === current.status && previous.snapshot === current.snapshot) {
    return null;
  }
  snapshots.set(partID, current);

  return {
    phase,
    tool_name: firstNonEmptyString(record?.tool) ?? "unknown_tool",
    error: phase === "error",
    tool_args: jsonValue(state?.input),
    result: jsonValue(status === "completed" ? state?.output : state?.error),
    event: eventName,
    source: "opencode",
    call_id: firstNonEmptyString(record?.callID, record?.call_id) ?? "",
  };
}

function questionToolTerminalPayload(toolPayload: JsonObject): JsonObject | null {
  if (normalizePartType(toolPayload.tool_name) !== "question") {
    return null;
  }
  if (toolPayload.error === true) {
    return null;
  }
  const phase = normalizePartType(toolPayload.phase);
  if (phase !== "started" && phase !== "completed") {
    return null;
  }

  const toolArgs = asRecord(toolPayload.tool_args);
  const result = asRecord(toolPayload.result);
  const questionData = toolArgs && Object.keys(toolArgs).length > 0 ? toolArgs : result;
  const questionPayload = jsonObjectValue(questionData);
  if (!questionPayload) {
    return null;
  }
  if (!questionPayload.questions && !questionPayload.question) {
    return null;
  }

  return {
    status: "waiting_user",
    event: asString(toolPayload.event) || "message.part.updated",
    interaction_type: "question",
    tool_name: "question",
    question: questionPayload,
    call_id: toolPayload.call_id ?? null,
  };
}

function messageUpdatedEvents(
  rawEvent: unknown,
  eventName: string,
  state: OpencodeEventMapperState
): OpencodeMappedEvent[] {
  const { textSnapshots, partTypeSnapshots, partMessageSnapshots, messageRoleSnapshots, pendingPartDeltas, pendingMessageEvents } = state;
  const payload = asRecord(rawEvent);
  const properties = asRecord(payload?.properties);
  const info = asRecord(properties?.info);
  const messageID = firstNonEmptyString(info?.id, info?.messageID, info?.messageId, info?.message_id) ?? "";
  const role = normalizeMessageRole(info?.role);
  if (messageID && role) {
    messageRoleSnapshots.set(messageID, role);
  }
  const parts = asArray(info?.parts);
  const releasedPendingEvents = releasePendingMessageEvents(messageID, role, pendingMessageEvents);
  if (!parts) {
    return releasedPendingEvents;
  }

  const outputEvents: OpencodeMappedEvent[] = [];
  for (const [index, rawPart] of parts.entries()) {
    const part = asRecord(rawPart);
    if (!part) {
      continue;
    }
    const partType = normalizePartType(part.type);
    if (partType !== "text" && partType !== "reasoning") {
      continue;
    }
    const partID = firstNonEmptyString(part.id) ?? `message-updated-${index}`;
    if (messageID) {
      partMessageSnapshots.set(partID, messageID);
    }
    if (role && role !== "assistant") {
      discardPartTracking(partID, state);
      continue;
    }
    partTypeSnapshots.set(partID, partType);
    const delta = textDeltaFromValues(partID, String(part.text ?? ""), textSnapshots);
    outputEvents.push(...queuedPartDeltaEvents(partID, partType, eventName, pendingPartDeltas));
    if (!delta) {
      continue;
    }
    const [eventType, deltaKind] = partStreamEventType(partType);
    outputEvents.push({
      event_type: eventType,
      payload: {
        delta,
        event: eventName,
        source: "opencode",
        part_id: partID,
        part_type: partType,
        delta_kind: deltaKind,
      },
    });
  }
  return [...releasedPendingEvents, ...outputEvents];
}

function eventErrorPayload(rawEvent: unknown): JsonObject {
  const payload = asRecord(rawEvent);
  const properties = asRecord(payload?.properties);
  const error = asRecord(properties?.error);
  if (!error) {
    return { message: "OpenCode session reported an error" };
  }

  const data = asRecord(error.data);
  const errorName = firstNonEmptyString(error.name);
  const message = firstNonEmptyString(
    extractErrorMessage(data),
    extractErrorMessage(error),
    errorName,
    "OpenCode session reported an error"
  ) as string;
  const statusCode = firstNumber(data?.statusCode, data?.status, error.statusCode, error.status);
  const errorCode = firstNonEmptyString(data?.code, getPath(data, "error.code"), error.code);
  const providerID = firstNonEmptyString(data?.providerID, data?.provider_id, getPath(data, "provider.id"));

  let summary = message;
  if (errorName && !summary.startsWith(`${errorName}:`)) {
    summary = `${errorName}: ${summary}`;
  }

  const detailParts: string[] = [];
  if (statusCode !== undefined) {
    detailParts.push(`status=${statusCode}`);
  }
  if (errorCode) {
    detailParts.push(`code=${errorCode}`);
  }
  if (providerID) {
    detailParts.push(`provider=${providerID}`);
  }

  const result: JsonObject = {
    message: detailParts.length > 0 ? `${summary} (${detailParts.join(", ")})` : summary,
  };
  if (errorName) {
    result.error_name = errorName;
  }
  if (errorCode) {
    result.error_code = errorCode;
  }
  if (statusCode !== undefined) {
    result.status_code = statusCode;
  }
  if (providerID) {
    result.provider_id = providerID;
  }
  return result;
}

export function createOpencodeEventMapperState(): OpencodeEventMapperState {
  return {
    textSnapshots: new Map<string, string>(),
    toolSnapshots: new Map<string, ToolSnapshot>(),
    partTypeSnapshots: new Map<string, string>(),
    partMessageSnapshots: new Map<string, string>(),
    messageRoleSnapshots: new Map<string, string>(),
    pendingPartDeltas: new Map<string, Array<[string, string]>>(),
    pendingMessageEvents: new Map<string, OpencodeMappedEvent[]>(),
  };
}

export function mapOpencodeEvent(
  rawEvent: unknown,
  targetSessionID: string,
  state: OpencodeEventMapperState
): OpencodeMappedEvent[] {
  const {
    textSnapshots,
    toolSnapshots,
    partTypeSnapshots,
    partMessageSnapshots,
    messageRoleSnapshots,
    pendingPartDeltas,
    pendingMessageEvents,
  } = state;
  const payload = asRecord(rawEvent);
  const eventName = firstNonEmptyString(payload?.type) ?? "";
  if (!eventName) {
    return [];
  }

  if (eventName === "session.error") {
    if (!["", targetSessionID].includes(eventSessionId(rawEvent))) {
      return [];
    }
    const errorPayload = eventErrorPayload(rawEvent);
    return [
      {
        event_type: "run_failed",
        payload: {
          type: "OpenCodeSessionError",
          message: String(errorPayload.message),
          event: eventName,
          ...Object.fromEntries(Object.entries(errorPayload).filter(([key]) => key !== "message")),
        },
      },
    ];
  }

  if (eventSessionId(rawEvent) !== targetSessionID) {
    return [];
  }

  if (eventName === "session.idle") {
    return [
      ...flushPendingPartDeltas(pendingPartDeltas),
      { event_type: "run_completed", payload: { status: "success", event: eventName } },
    ];
  }

  if (eventName === "session.status") {
    const statusType = eventSessionStatusType(rawEvent);
    if (statusType !== "idle") {
      return [];
    }
    return [
      ...flushPendingPartDeltas(pendingPartDeltas),
      {
        event_type: "run_completed",
        payload: {
          status: "success",
          event: eventName,
          session_status: statusType,
        },
      },
    ];
  }

  if (eventName === "message.updated") {
    return messageUpdatedEvents(rawEvent, eventName, state);
  }

  if (eventName !== "message.part.updated" && eventName !== "message.part.delta") {
    return [];
  }

  const part = eventPart(rawEvent);
  const partType = normalizePartType(partValue(part, "type"));
  const partID = eventPartId(rawEvent, part);
  const messageID = eventMessageId(rawEvent, part, partMessageSnapshots);
  const messageRole = normalizeMessageRole(messageRoleSnapshots.get(messageID) ?? "");
  if (partID && messageID) {
    partMessageSnapshots.set(partID, messageID);
  }
  if (partID && partType) {
    partTypeSnapshots.set(partID, partType);
  }
  const resolvedPartType = partID ? partTypeSnapshots.get(partID) ?? partType : partType;

  if (eventName === "message.part.delta") {
    const rawDelta = eventDelta(rawEvent);
    if (!rawDelta) {
      return [];
    }
    if (resolvedPartType && !["text", "reasoning", "snapshot"].includes(resolvedPartType)) {
      return [];
    }
    if (partID && !resolvedPartType) {
      const queued = pendingPartDeltas.get(partID) ?? [];
      queued.push([eventName, rawDelta]);
      pendingPartDeltas.set(partID, queued);
      return [];
    }
    let delta = rawDelta;
    if (partID) {
      const rawText = partValue(part, "text", "snapshot");
      const text = rawText !== undefined ? String(rawText) : "";
      if (text) {
        delta = textDeltaFromValues(partID, text, textSnapshots);
      } else {
        textSnapshots.set(partID, `${textSnapshots.get(partID) ?? ""}${rawDelta}`);
      }
    }
    const [eventType, deltaKind] = partStreamEventType(resolvedPartType);
    const queuedEvents = partID && resolvedPartType
      ? queuedPartDeltaEvents(partID, resolvedPartType, eventName, pendingPartDeltas)
      : [];
    if (!delta) {
      return queuedEvents;
    }
    const mappedEvents: OpencodeMappedEvent[] = [
      ...queuedEvents,
      {
        event_type: eventType,
        payload: {
          delta,
          event: eventName,
          source: "opencode",
          part_id: partID,
          part_type: resolvedPartType || null,
          delta_kind: deltaKind,
        },
      },
    ];
    if (messageRole && messageRole !== "assistant") {
      return [];
    }
    return mappedEvents;
  }

  if (resolvedPartType === "text") {
    let delta = "";
    if (partID) {
      const rawText = partValue(part, "text", "snapshot");
      const text = rawText !== undefined ? String(rawText) : "";
      if (text) {
        delta = textDeltaFromValues(partID, text, textSnapshots);
      }
    } else {
      delta = textDelta(part, textSnapshots);
    }
    const queuedEvents = partID ? queuedPartDeltaEvents(partID, resolvedPartType, eventName, pendingPartDeltas) : [];
    if (!delta) {
      return queuedEvents;
    }
    const mappedEvents: OpencodeMappedEvent[] = [
      ...queuedEvents,
      {
        event_type: "output_delta",
        payload: {
          delta,
          event: eventName,
          source: "opencode",
          part_id: partID,
          part_type: resolvedPartType,
          delta_kind: "output",
        },
      },
    ];
    if (messageRole === "assistant") {
      return mappedEvents;
    }
    if (messageRole && messageRole !== "assistant") {
      return [];
    }
    if (messageID) {
      const queued = pendingMessageEvents.get(messageID) ?? [];
      queued.push(...mappedEvents);
      pendingMessageEvents.set(messageID, queued);
      return [];
    }
    return mappedEvents;
  }

  if (resolvedPartType === "reasoning") {
    const delta = eventDelta(rawEvent) || textDelta(part, textSnapshots);
    if (!delta) {
      return [];
    }
    const queuedEvents = partID ? queuedPartDeltaEvents(partID, resolvedPartType, eventName, pendingPartDeltas) : [];
    const mappedEvents: OpencodeMappedEvent[] = [
      ...queuedEvents,
      {
        event_type: "thinking_delta",
        payload: {
          delta,
          event: eventName,
          source: "opencode",
          part_id: partID,
          part_type: resolvedPartType,
          delta_kind: "thinking",
        },
      },
    ];
    if (messageRole === "assistant") {
      return mappedEvents;
    }
    if (messageRole && messageRole !== "assistant") {
      return [];
    }
    if (eventName === "message.part.updated" && messageID) {
      const queued = pendingMessageEvents.get(messageID) ?? [];
      queued.push(...mappedEvents);
      pendingMessageEvents.set(messageID, queued);
      return [];
    }
    return mappedEvents;
  }

  if (resolvedPartType === "snapshot") {
    const delta = textDelta(part, textSnapshots);
    if (!delta) {
      return [];
    }
    return [
      {
        event_type: "output_delta",
        payload: {
          delta,
          event: eventName,
          source: "opencode",
          part_id: partID,
          part_type: resolvedPartType,
          delta_kind: "output",
        },
      },
    ];
  }

  if (resolvedPartType === "tool") {
    const toolPayload = opencodeToolPayload(part ?? {}, eventName, toolSnapshots);
    if (!toolPayload) {
      return [];
    }
    const terminalPayload = questionToolTerminalPayload(toolPayload);
    const events: OpencodeMappedEvent[] = [{ event_type: "tool_call", payload: toolPayload }];
    if (terminalPayload) {
      events.push({ event_type: "run_completed", payload: terminalPayload });
    }
    return events;
  }

  if (resolvedPartType === "step-start" || resolvedPartType === "step-finish") {
    return [
      {
        event_type: "thinking_delta",
        payload: {
          delta: resolvedPartType,
          event: eventName,
          source: "opencode",
          part_id: String(partValue(part, "id", "part_id", "partID") ?? ""),
          part_type: resolvedPartType,
          delta_kind: "thinking",
        },
      },
    ];
  }

  return [];
}

export function shouldEmitOpencodeEvent(
  eventType: RunnerEventType,
  payload: JsonObject,
  instruction: string
): boolean {
  if (eventType === "thinking_delta") {
    const delta = asString(payload.delta);
    if (delta === "step-start" || delta === "step-finish") {
      return false;
    }
  }

  return true;
}

function mapModeToAgent(mode: string): string | undefined {
  const normalized = mode.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "code") {
    return "build";
  }
  return normalized;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isMcpConfig(value: unknown): value is McpLocalConfig | McpRemoteConfig {
  const record = asRecord(value);
  const type = normalizePartType(record?.type);
  if (type === "local") {
    return Array.isArray(record?.command);
  }
  if (type === "remote") {
    return typeof record?.url === "string";
  }
  return false;
}

async function ensureMcpServers(
  client: ReturnType<typeof createOpencodeClient>,
  request: OpencodeHarnessHostRequest
): Promise<void> {
  const statusResponse = await client.mcp.status();
  const statusMap = asRecord(statusResponse.data) ?? {};
  const seenServerNames = new Set<string>();

  for (const rawServer of request.mcp_servers) {
    const server = asRecord(rawServer);
    const name = firstNonEmptyString(server?.name);
    const config = server?.config;
    if (!name || !isMcpConfig(config)) {
      continue;
    }
    if (seenServerNames.has(name)) {
      continue;
    }
    seenServerNames.add(name);
    const forceRefresh = Boolean(server?._holaboss_force_refresh);
    const currentStatus = normalizePartType(asRecord(statusMap[name])?.status);

    if (forceRefresh || !currentStatus || ["failed", "disabled", "needs_auth", "needs_client_registration"].includes(currentStatus)) {
      requireData(
        await client.mcp.add({ name, config }),
        `OpenCode MCP registration failed for '${name}'`
      );
      statusMap[name] = { status: "connected" };
    }

    if (forceRefresh || currentStatus !== "connected") {
      requireData(
        await client.mcp.connect({ name }),
        `OpenCode MCP connect failed for '${name}'`
      );
      statusMap[name] = { status: "connected" };
    }
  }
}

async function sessionExists(
  client: ReturnType<typeof createOpencodeClient>,
  sessionID: string
): Promise<boolean> {
  const trimmed = sessionID.trim();
  if (!trimmed) {
    return false;
  }
  const response = await client.session.get({ sessionID: trimmed });
  return response.data !== undefined;
}

async function createSession(client: ReturnType<typeof createOpencodeClient>): Promise<string> {
  const session = requireData(
    await client.session.create({ title: "Holaboss Runtime Session" }),
    "OpenCode session creation failed"
  );
  const sessionID = firstNonEmptyString(asRecord(session)?.id);
  if (!sessionID) {
    throw new Error("OpenCode session creation returned empty id");
  }
  return sessionID;
}

export async function resolveOpencodeSessionId(params: {
  requestedSessionId?: string | null;
  persistedSessionId?: string | null;
  sessionExists: (sessionId: string) => Promise<boolean>;
  createSession: () => Promise<string>;
}): Promise<string> {
  const requested = firstNonEmptyString(params.requestedSessionId) ?? "";
  const persisted = firstNonEmptyString(params.persistedSessionId) ?? "";

  if (requested) {
    if (await params.sessionExists(requested)) {
      return requested;
    }
    return await params.createSession();
  }

  if (persisted && (await params.sessionExists(persisted))) {
    return persisted;
  }

  return await params.createSession();
}

async function ensureSession(
  client: ReturnType<typeof createOpencodeClient>,
  request: OpencodeHarnessHostRequest
): Promise<string> {
  return await resolveOpencodeSessionId({
    requestedSessionId: request.harness_session_id,
    persistedSessionId: request.persisted_harness_session_id,
    sessionExists: async (sessionID) => await sessionExists(client, sessionID),
    createSession: async () => await createSession(client),
  });
}

export async function runOpencode(request: OpencodeHarnessHostRequest): Promise<number> {
  let sequence = 0;
  let activeSessionID: string | null = null;
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  try {
    emitRunnerEvent(request, nextSequence(), "run_started", { ...request.run_started_payload });

    const client = createOpencodeClient({
      baseUrl: request.opencode_base_url,
      directory: request.workspace_dir,
      experimental_workspaceID: request.workspace_id,
    });

    await ensureMcpServers(client, request);
    const opencodeSessionID = await ensureSession(client, request);
    activeSessionID = opencodeSessionID;

    const events = await client.event.subscribe();
    const iterator = events.stream[Symbol.asyncIterator]();
    const mapperState = createOpencodeEventMapperState();

    const promptTask = (async () => {
      const response = await client.session.promptAsync({
        sessionID: opencodeSessionID,
        model: {
          providerID: request.provider_id,
          modelID: request.model_id,
        },
        agent: mapModeToAgent(request.mode),
        tools: request.tools,
        format: (request.output_format as OutputFormat | null | undefined) ?? undefined,
        system: request.system_prompt,
        parts: promptPartsForRequest(request),
      });
      if (response.error !== undefined) {
        throw new Error(sdkErrorMessage(response.error, "OpenCode prompt submission failed"));
      }
      return response.data;
    })();

    let promptError: unknown = null;
    void promptTask.catch((error: unknown) => {
      promptError = error;
    });

    let terminalEmitted = false;
    let nextEventPromise: Promise<IteratorResult<unknown>> | null = null;
    const deadline = Date.now() + request.timeout_seconds * 1000;

    while (!terminalEmitted) {
      if (promptError) {
        throw promptError;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error("timed out waiting for OpenCode stream");
      }

      if (!nextEventPromise) {
        nextEventPromise = iterator.next();
      }
      const currentEventPromise = nextEventPromise;

      const winner = await Promise.race([
        currentEventPromise.then((result) => ({ kind: "event" as const, result })),
        sleep(Math.min(1000, remainingMs)).then(() => ({ kind: "tick" as const })),
      ]);

      if (winner.kind === "tick") {
        continue;
      }

      nextEventPromise = null;
      if (winner.result.done) {
        break;
      }

      const mappedEvents = mapOpencodeEvent(
        winner.result.value,
        opencodeSessionID,
        mapperState
      );

      for (const mappedEvent of mappedEvents) {
        if (!shouldEmitOpencodeEvent(mappedEvent.event_type, mappedEvent.payload, request.instruction)) {
          continue;
        }

        if (TERMINAL_EVENT_TYPES.has(mappedEvent.event_type)) {
          mappedEvent.payload = {
            ...mappedEvent.payload,
            harness_session_id: opencodeSessionID,
          };
        }

        emitRunnerEvent(request, nextSequence(), mappedEvent.event_type, mappedEvent.payload);
        if (TERMINAL_EVENT_TYPES.has(mappedEvent.event_type)) {
          terminalEmitted = true;
          break;
        }
      }
    }

    if (!terminalEmitted) {
      throw new Error("OpenCode event stream ended before terminal event");
    }

    void iterator.return?.(undefined);
    return 0;
  } catch (error: unknown) {
    const payload: JsonObject = {
      type: error instanceof Error ? error.name || "RuntimeError" : "RuntimeError",
      message: error instanceof Error ? error.message : String(error),
    };
    if (activeSessionID) {
      payload.harness_session_id = activeSessionID;
    }
    emitRunnerEvent(request, sequence === 0 ? 1 : nextSequence(), "run_failed", payload);
    return 1;
  }
}
