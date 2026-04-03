import { createHash } from "node:crypto";
import path from "node:path";

import type {
  MemoryEntryScope,
  MemoryEntrySourceType,
  MemoryEntryType,
  MemoryStalenessPolicy,
  MemoryVerificationPolicy,
  RuntimeStateStore,
  SessionMessageRecord,
  TurnResultRecord,
} from "@holaboss/runtime-state-store";

import type { MemoryServiceLike } from "./memory.js";
import { governanceRuleForMemoryType } from "./memory-governance.js";
import { buildCompactionBoundaryArtifacts, compactTurnSummary } from "./turn-result-summary.js";
import {
  extractDurableMemoryCandidatesFromModel,
  type DurableMemoryExtractionContext,
  type ExtractedDurableMemoryCandidate,
} from "./memory-writeback-extractor.js";
import type { MemoryModelClientConfig } from "./memory-model-client.js";

type TurnMemoryScope = "workspace" | "session" | "user" | "ephemeral";

interface RuntimeMemoryCandidate {
  scope: TurnMemoryScope;
  key: string;
  path: string;
  content: string;
}

interface DurableMemoryCandidate {
  memoryId: string;
  scope: Extract<MemoryEntryScope, "workspace" | "user">;
  memoryType: MemoryEntryType;
  subjectKey: string;
  path: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  verificationPolicy: MemoryVerificationPolicy;
  stalenessPolicy: MemoryStalenessPolicy;
  staleAfterSeconds: number | null;
  sourceMessageId?: string | null;
  sourceType: MemoryEntrySourceType;
  observedAt: string | null;
  lastVerifiedAt: string | null;
  confidence: number | null;
}

interface ModelDurableCandidate {
  extractedCandidate: ExtractedDurableMemoryCandidate;
  durableCandidate: DurableMemoryCandidate;
}

export interface TurnMemoryWritebackModelContext {
  modelClient?: MemoryModelClientConfig | null;
  instruction?: string | null;
}

const RECENT_TURNS_LIMIT = 5;
const MODEL_EXTRACTION_MIN_CONFIDENCE = 0.82;
const MODEL_EXTRACTION_MIN_CONFIDENCE_CORROBORATED = 0.6;
const MODEL_EXTRACTION_MIN_EVIDENCE_CHARS = 36;
const MODEL_EXTRACTION_MIN_EVIDENCE_CHARS_CORROBORATED = 16;

function safePathSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function blockerKey(toolName: string, toolId: string | null, reason: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ toolName, toolId, reason }))
    .digest("hex")
    .slice(0, 16);
}

function titleCase(value: string): string {
  const normalized = compactWhitespace(value);
  if (!normalized) {
    return value;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function fingerprintText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionStatePath(turnResult: TurnResultRecord): string {
  return `workspace/${turnResult.workspaceId}/runtime/session-state/${safePathSegment(turnResult.sessionId, "session")}.md`;
}

function blockerStatePath(turnResult: TurnResultRecord): string {
  return `workspace/${turnResult.workspaceId}/runtime/blockers/${safePathSegment(turnResult.sessionId, "session")}.md`;
}

function latestTurnPath(turnResult: TurnResultRecord): string {
  return `workspace/${turnResult.workspaceId}/runtime/latest-turn.md`;
}

function recentTurnsPath(turnResult: TurnResultRecord): string {
  return `workspace/${turnResult.workspaceId}/runtime/recent-turns/${safePathSegment(turnResult.sessionId, "session")}.md`;
}

function sessionMemoryPath(turnResult: TurnResultRecord): string {
  return `workspace/${turnResult.workspaceId}/runtime/session-memory/${safePathSegment(turnResult.sessionId, "session")}.md`;
}

function permissionBlockerPath(turnResult: TurnResultRecord, toolName: string, toolId: string | null, reason: string): string {
  const key = blockerKey(toolName, toolId, reason);
  return `workspace/${turnResult.workspaceId}/runtime/permission-blockers/${key}.md`;
}

function repeatedPermissionKnowledgePath(
  turnResult: TurnResultRecord,
  toolName: string,
  toolId: string | null,
  reason: string
): string {
  const key = blockerKey(toolName, toolId, reason);
  return `workspace/${turnResult.workspaceId}/knowledge/blockers/permission-${key}.md`;
}

function workspaceMemoryIndexPath(workspaceId: string): string {
  return `workspace/${workspaceId}/MEMORY.md`;
}

function rootMemoryIndexPath(): string {
  return "MEMORY.md";
}

function preferenceMemoryIndexPath(): string {
  return "preference/MEMORY.md";
}

function responseStylePreferencePath(): string {
  return "preference/response-style.md";
}

function workspaceCommandFactPath(turnResult: TurnResultRecord, purpose: WorkspaceCommandPurpose): string {
  return `workspace/${turnResult.workspaceId}/knowledge/facts/${safePathSegment(purpose, "command")}-command.md`;
}

function workspaceBusinessFactPath(turnResult: TurnResultRecord, slug: string): string {
  return `workspace/${turnResult.workspaceId}/knowledge/facts/${safePathSegment(slug, "fact")}.md`;
}

function workspaceProcedurePath(turnResult: TurnResultRecord, subject: WorkspaceProcedureSubject): string {
  return `workspace/${turnResult.workspaceId}/knowledge/procedures/${safePathSegment(subject, "procedure")}-procedure.md`;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clippedText(value: string, maxChars: number): string {
  const normalized = compactWhitespace(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function renderPermissionDenials(turnResult: TurnResultRecord): string[] {
  if (turnResult.permissionDenials.length === 0) {
    return ["None."];
  }
  return turnResult.permissionDenials.map((denial) => {
    const toolName = typeof denial.tool_name === "string" && denial.tool_name.trim() ? denial.tool_name.trim() : "unknown";
    const toolId = typeof denial.tool_id === "string" && denial.tool_id.trim() ? ` (\`${denial.tool_id.trim()}\`)` : "";
    const reason = typeof denial.reason === "string" && denial.reason.trim() ? denial.reason.trim() : "permission denied";
    return `- ${toolName}${toolId}: ${reason}`;
  });
}

function renderSessionState(turnResult: TurnResultRecord, summary: string | null): string {
  const lines = [
    "# Runtime Session Snapshot",
    "",
    `- Session ID: \`${turnResult.sessionId}\``,
    `- Input ID: \`${turnResult.inputId}\``,
    `- Status: \`${turnResult.status}\``,
    `- Stop reason: ${turnResult.stopReason ? `\`${turnResult.stopReason}\`` : "none"}`,
    `- Completed at: ${turnResult.completedAt ?? turnResult.updatedAt}`,
  ];
  if (turnResult.capabilityManifestFingerprint) {
    lines.push(`- Capability fingerprint: \`${turnResult.capabilityManifestFingerprint}\``);
  }
  if (turnResult.promptSectionIds.length > 0) {
    lines.push(`- Prompt sections: ${turnResult.promptSectionIds.map((id) => `\`${id}\``).join(", ")}`);
  }
  if (turnResult.tokenUsage) {
    const inputTokens = typeof turnResult.tokenUsage.input_tokens === "number" ? turnResult.tokenUsage.input_tokens : null;
    const outputTokens = typeof turnResult.tokenUsage.output_tokens === "number" ? turnResult.tokenUsage.output_tokens : null;
    if (inputTokens !== null || outputTokens !== null) {
      lines.push(`- Token usage: input=${inputTokens ?? "?"}, output=${outputTokens ?? "?"}`);
    }
  }
  lines.push("", "## Summary", "", summary ?? "No compact summary available.", "", "## Permission Denials", "");
  lines.push(...renderPermissionDenials(turnResult));
  return `${lines.join("\n").trim()}\n`;
}

function renderBlockerState(turnResult: TurnResultRecord): string {
  const lines = [
    "# Runtime Blocker Snapshot",
    "",
    `- Session ID: \`${turnResult.sessionId}\``,
    `- Input ID: \`${turnResult.inputId}\``,
    `- Updated at: ${turnResult.completedAt ?? turnResult.updatedAt}`,
    "",
    "## Current State",
    "",
  ];

  if (turnResult.status === "waiting_user") {
    lines.push("The latest run is paused waiting for user input.");
  } else if (turnResult.status === "failed") {
    lines.push(
      turnResult.stopReason ? `The latest run failed with stop reason \`${turnResult.stopReason}\`.` : "The latest run failed."
    );
  } else {
    lines.push("No active blocker in the latest turn.");
  }

  lines.push("", "## Permission Denials", "");
  lines.push(...renderPermissionDenials(turnResult));
  return `${lines.join("\n").trim()}\n`;
}

function renderLatestTurn(turnResult: TurnResultRecord, summary: string | null): string {
  const lines = [
    "# Latest Runtime Turn",
    "",
    `- Session ID: \`${turnResult.sessionId}\``,
    `- Input ID: \`${turnResult.inputId}\``,
    `- Status: \`${turnResult.status}\``,
    `- Stop reason: ${turnResult.stopReason ? `\`${turnResult.stopReason}\`` : "none"}`,
    `- Completed at: ${turnResult.completedAt ?? turnResult.updatedAt}`,
    "",
    "## Summary",
    "",
    summary ?? "No compact summary available.",
  ];
  return `${lines.join("\n").trim()}\n`;
}

function renderRecentTurns(turnResults: TurnResultRecord[]): string {
  const lines = [
    "# Recent Runtime Turns",
    "",
    `- Included turns: ${turnResults.length}`,
    "",
  ];

  if (turnResults.length === 0) {
    lines.push("No recent turn history available.");
    return `${lines.join("\n").trim()}\n`;
  }

  turnResults.forEach((turnResult, index) => {
    const summary = turnResult.compactedSummary ?? compactTurnSummary(turnResult) ?? "No compact summary available.";
    lines.push(`## ${index + 1}. Input \`${turnResult.inputId}\``);
    lines.push("");
    lines.push(`- Status: \`${turnResult.status}\``);
    lines.push(`- Stop reason: ${turnResult.stopReason ? `\`${turnResult.stopReason}\`` : "none"}`);
    lines.push(`- Completed at: ${turnResult.completedAt ?? turnResult.updatedAt}`);
    lines.push(`- Summary: ${summary}`);
    lines.push("");
  });

  return `${lines.join("\n").trim()}\n`;
}

function recentUserRequests(sessionMessages: SessionMessageRecord[], maxCount: number): string[] {
  const userMessages = sessionMessages
    .filter((message) => message.role === "user")
    .map((message) => compactWhitespace(message.text))
    .filter(Boolean);
  if (userMessages.length <= maxCount) {
    return userMessages;
  }
  return userMessages.slice(userMessages.length - maxCount);
}

function renderSessionMemory(turnResult: TurnResultRecord, recentTurns: TurnResultRecord[], sessionMessages: SessionMessageRecord[]): string {
  const latestSummary = turnResult.compactedSummary ?? compactTurnSummary(turnResult) ?? "No compact summary available.";
  const recentTurnSummaries = recentTurns.slice(0, 3).map((item) => ({
    inputId: item.inputId,
    status: item.status,
    summary: item.compactedSummary ?? compactTurnSummary(item) ?? "No compact summary available.",
  }));
  const userRequests = recentUserRequests(sessionMessages, 3);
  const recentErrors = recentTurns
    .filter((item) => item.status === "failed" || item.permissionDenials.length > 0)
    .slice(0, 3)
    .map((item) => {
      const reason = compactWhitespace(item.stopReason ?? "");
      return `${item.inputId}: ${reason || "runtime error or permission denial"}`;
    });

  const lines = [
    "# Session Memory",
    "",
    `- Workspace ID: \`${turnResult.workspaceId}\``,
    `- Session ID: \`${turnResult.sessionId}\``,
    `- Updated at: ${turnResult.completedAt ?? turnResult.updatedAt}`,
    "",
    "## Current State",
    "",
    latestSummary,
    "",
    "## Recent User Requests",
    "",
  ];
  if (userRequests.length === 0) {
    lines.push("- No recent user requests captured.");
  } else {
    for (const request of userRequests) {
      lines.push(`- ${clippedText(request, 220)}`);
    }
  }

  lines.push("", "## Recent Runtime Progress", "");
  for (const item of recentTurnSummaries) {
    lines.push(`- \`${item.inputId}\` (\`${item.status}\`): ${item.summary}`);
  }
  if (recentTurnSummaries.length === 0) {
    lines.push("- No prior turn summaries available.");
  }

  lines.push("", "## Errors and Corrections", "");
  if (recentErrors.length === 0) {
    lines.push("- No recent runtime errors or permission denials.");
  } else {
    for (const error of recentErrors) {
      lines.push(`- ${error}`);
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

type ResponseStylePreference = {
  style: "concise" | "detailed";
  evidence: string;
};

type MemorySourceEvidence = {
  text: string;
  sourceLabel: string;
  sourceType: MemoryEntrySourceType;
  observedAt: string | null;
  sourceMessageId?: string | null;
};

type WorkspaceCommandPurpose = "verification" | "build" | "development" | "deploy" | "release";

type WorkspaceProcedureSubject =
  | "verification"
  | "build"
  | "deploy"
  | "release"
  | "onboarding"
  | "approval"
  | "reporting"
  | "follow-up"
  | "handoff"
  | "escalation"
  | "review";

type WorkspaceCommandFact = {
  purpose: WorkspaceCommandPurpose;
  label: string;
  command: string;
  evidence: string;
};

type WorkspaceBusinessFact = {
  slug: string;
  title: string;
  summary: string;
  evidence: string;
  tags: string[];
};

type WorkspaceProcedure = {
  subject: WorkspaceProcedureSubject;
  label: string;
  steps: string[];
  evidence: string;
};

function detectExplicitResponseStylePreference(messageText: string): ResponseStylePreference | null {
  const normalized = compactWhitespace(messageText);
  if (!normalized) {
    return null;
  }

  const concisePatterns = [
    /\bprefer\s+(?:responses?|answers?|replies)\s+(?:to be\s+)?(?:concise|brief|short)\b/i,
    /\b(?:keep|make)\s+(?:your\s+)?(?:responses?|answers?|replies)\s+(?:concise|brief|short)\b/i,
    /\b(?:be|stay)\s+(?:concise|brief|short)\b/i,
  ];
  for (const pattern of concisePatterns) {
    if (pattern.test(normalized)) {
      return {
        style: "concise",
        evidence: clippedText(normalized, 220),
      };
    }
  }

  const detailedPatterns = [
    /\bprefer\s+(?:responses?|answers?|replies)\s+(?:to be\s+)?(?:detailed|thorough|comprehensive|in-depth)\b/i,
    /\b(?:keep|make)\s+(?:your\s+)?(?:responses?|answers?|replies)\s+(?:detailed|thorough|comprehensive|in-depth)\b/i,
    /\b(?:be|stay)\s+(?:detailed|thorough|comprehensive)\b/i,
  ];
  for (const pattern of detailedPatterns) {
    if (pattern.test(normalized)) {
      return {
        style: "detailed",
        evidence: clippedText(normalized, 220),
      };
    }
  }

  return null;
}

function latestUserMessage(sessionMessages: SessionMessageRecord[]): SessionMessageRecord | null {
  for (let index = sessionMessages.length - 1; index >= 0; index -= 1) {
    const message = sessionMessages[index];
    if (message.role === "user" && compactWhitespace(message.text)) {
      return message;
    }
  }
  return null;
}

function durableMemorySources(turnResult: TurnResultRecord, sessionMessages: SessionMessageRecord[]): MemorySourceEvidence[] {
  const sources: MemorySourceEvidence[] = [];
  const message = latestUserMessage(sessionMessages);
  if (message) {
    sources.push({
      text: message.text,
      sourceLabel: "latest user message",
      sourceType: "session_message",
      observedAt: message.createdAt,
      sourceMessageId: message.id,
    });
  }
  if (compactWhitespace(turnResult.assistantText)) {
    sources.push({
      text: turnResult.assistantText,
      sourceLabel: "latest assistant turn",
      sourceType: "assistant_turn",
      observedAt: turnResult.completedAt ?? turnResult.updatedAt,
      sourceMessageId: null,
    });
  }
  return sources;
}

function workspaceCommandDefinitions(): Array<{
  purpose: WorkspaceCommandPurpose;
  label: string;
  patterns: RegExp[];
}> {
  return [
    {
      purpose: "verification",
      label: "verification",
      patterns: [
        /\b(?:main|default|primary|preferred|recommended|standard|canonical)\s+(?:verification|test(?:ing)?)\s+command\s+(?:is|:)\s*`([^`]+)`/i,
        /\b(?:for|during)\s+(?:verification|tests?|testing)[,:]?\s*(?:use|run)\s*`([^`]+)`/i,
        /\buse\s*`([^`]+)`\s*(?:for|to)\s+(?:verify|verification|run tests?|testing)\b/i,
      ],
    },
    {
      purpose: "build",
      label: "build",
      patterns: [
        /\b(?:main|default|primary|preferred|recommended|standard|canonical)\s+build\s+command\s+(?:is|:)\s*`([^`]+)`/i,
        /\b(?:for|during)\s+build(?:ing)?[,:]?\s*(?:use|run)\s*`([^`]+)`/i,
        /\buse\s*`([^`]+)`\s*(?:for|to)\s+build\b/i,
      ],
    },
    {
      purpose: "development",
      label: "development",
      patterns: [
        /\b(?:main|default|primary|preferred|recommended|standard|canonical)\s+(?:development|dev|start)\s+command\s+(?:is|:)\s*`([^`]+)`/i,
        /\b(?:for|during)\s+(?:development|dev|local development)[,:]?\s*(?:use|run)\s*`([^`]+)`/i,
        /\buse\s*`([^`]+)`\s*(?:for|to)\s+(?:start|run)\s+(?:the app|development|dev)\b/i,
      ],
    },
    {
      purpose: "deploy",
      label: "deployment",
      patterns: [
        /\b(?:main|default|primary|preferred|recommended|standard|canonical)\s+deploy(?:ment)?\s+command\s+(?:is|:)\s*`([^`]+)`/i,
        /\b(?:for|during)\s+deploy(?:ment)?[,:]?\s*(?:use|run)\s*`([^`]+)`/i,
        /\buse\s*`([^`]+)`\s*(?:for|to)\s+deploy\b/i,
      ],
    },
    {
      purpose: "release",
      label: "release",
      patterns: [
        /\b(?:main|default|primary|preferred|recommended|standard|canonical)\s+release\s+command\s+(?:is|:)\s*`([^`]+)`/i,
        /\b(?:for|during)\s+release(?:s)?[,:]?\s*(?:use|run)\s*`([^`]+)`/i,
        /\buse\s*`([^`]+)`\s*(?:for|to)\s+release\b/i,
      ],
    },
  ];
}

function detectWorkspaceCommandFacts(messageText: string): WorkspaceCommandFact[] {
  const normalized = compactWhitespace(messageText);
  if (!normalized) {
    return [];
  }
  return workspaceCommandDefinitions().flatMap((definition) => {
    for (const pattern of definition.patterns) {
      const match = normalized.match(pattern);
      const command = typeof match?.[1] === "string" ? compactWhitespace(match[1]) : "";
      if (command) {
        return [
          {
            purpose: definition.purpose,
            label: definition.label,
            command,
            evidence: clippedText(normalized, 240),
          },
        ];
      }
    }
    return [];
  });
}

function detectWorkspaceBusinessFacts(messageText: string): WorkspaceBusinessFact[] {
  const normalized = compactWhitespace(messageText);
  if (!normalized) {
    return [];
  }
  const facts: WorkspaceBusinessFact[] = [];
  const seen = new Set<string>();

  const cadenceMatch = normalized.match(
    /\b(weekly|daily|monthly|quarterly)\s+([a-z][a-z0-9 /-]+?)\s+(?:is|happens|runs|occurs)\s+([^.!?\n]+)\.?/i
  );
  if (cadenceMatch) {
    const cadence = compactWhitespace(cadenceMatch[1] ?? "");
    const subject = compactWhitespace(cadenceMatch[2] ?? "");
    const schedule = compactWhitespace(cadenceMatch[3] ?? "");
    if (cadence && subject && schedule) {
      const slug = `${safePathSegment(subject.toLowerCase(), "cadence")}-cadence`;
      const summary = `${clippedText(cadenceMatch[0].replace(/[.]+$/, ""), 220)}.`;
      seen.add(slug);
      facts.push({
        slug,
        title: `${titleCase(subject)} cadence`,
        summary,
        evidence: clippedText(cadenceMatch[0], 240),
        tags: ["cadence", cadence, ...subject.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)],
      });
    }
  }

  const approvalMatch = normalized.match(
    /\b([a-z0-9$][a-z0-9$,% /-]{2,}?)\s+require(?:s)?\s+([a-z][a-z0-9 /-]+?)\s+approval\b/i
  );
  if (approvalMatch) {
    const subject = compactWhitespace(approvalMatch[1] ?? "");
    const approver = compactWhitespace(approvalMatch[2] ?? "");
    if (subject && approver) {
      const slug = `${safePathSegment(subject.toLowerCase(), "approval")}-approval-rule`;
      if (!seen.has(slug)) {
        const summary = `${clippedText(approvalMatch[0].replace(/[.]+$/, ""), 220)} in this workspace.`;
        facts.push({
          slug,
          title: `${titleCase(approver)} approval rule`,
          summary: titleCase(summary),
          evidence: clippedText(approvalMatch[0], 240),
          tags: [
            "approval",
            approver.toLowerCase(),
            ...subject.toLowerCase().split(/[^a-z0-9$]+/).filter(Boolean),
          ],
        });
      }
    }
  }

  return facts;
}

function detectWorkspaceProcedure(messageText: string): WorkspaceProcedure[] {
  if (!messageText.trim()) {
    return [];
  }
  const lines = messageText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [];
  }
  const numberedOrBulletedSteps = lines
    .filter((line) => /^\d+\.\s+/.test(line) || /^-\s+/.test(line))
    .map((line) => line.replace(/^(?:\d+\.\s+|-\s+)/, "").trim())
    .filter((line) => line.length > 0);
  if (numberedOrBulletedSteps.length < 2) {
    return [];
  }
  const fullText = lines.join("\n");
  const subjectMatchers: Array<{ subject: WorkspaceProcedureSubject; label: string; pattern: RegExp }> = [
    { subject: "verification", label: "verification", pattern: /\bverification\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "build", label: "build", pattern: /\bbuild\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "deploy", label: "deployment", pattern: /\bdeploy(?:ment)?\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "release", label: "release", pattern: /\brelease\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "onboarding", label: "onboarding", pattern: /\bonboarding\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "approval", label: "approval", pattern: /\bapproval\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "reporting", label: "reporting", pattern: /\breport(?:ing)?\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "follow-up", label: "follow-up", pattern: /\bfollow[- ]?up\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "handoff", label: "handoff", pattern: /\b(?:handoff|handover)\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "escalation", label: "escalation", pattern: /\bescalation\s+(?:procedure|process|workflow|steps)\b/i },
    { subject: "review", label: "review", pattern: /\b(?:review|sales review|weekly review|monthly review)\s+(?:procedure|process|workflow|steps)\b/i },
  ];
  for (const matcher of subjectMatchers) {
    if (matcher.pattern.test(fullText)) {
      return [
        {
          subject: matcher.subject,
          label: matcher.label,
          steps: numberedOrBulletedSteps.slice(0, 6),
          evidence: clippedText(compactWhitespace(fullText), 260),
        },
      ];
    }
  }
  return [];
}

function responseStylePreferenceCandidate(
  turnResult: TurnResultRecord,
  sessionMessages: SessionMessageRecord[]
): DurableMemoryCandidate[] {
  const message = latestUserMessage(sessionMessages);
  if (!message) {
    return [];
  }
  const preference = detectExplicitResponseStylePreference(message.text);
  if (!preference) {
    return [];
  }
  const summary = `User prefers ${preference.style} responses.`;
  const lines = [
    "# User Response Style Preference",
    "",
    `- Preference: \`${preference.style}\``,
    `- Session ID: \`${turnResult.sessionId}\``,
    `- Source message ID: \`${message.id}\``,
    `- Updated at: ${turnResult.completedAt ?? turnResult.updatedAt}`,
    "",
    "## Summary",
    "",
    summary,
    "",
    "## Evidence",
    "",
    preference.evidence,
  ];
  const governance = governanceRuleForMemoryType("preference");
  return [
    {
      memoryId: "user-preference:response-style",
      scope: "user",
      memoryType: "preference",
      subjectKey: "response-style",
      path: responseStylePreferencePath(),
      title: "User response style",
      summary,
      content: `${lines.join("\n").trim()}\n`,
      tags: ["response-style", preference.style],
      verificationPolicy: governance.verificationPolicy,
      stalenessPolicy: governance.stalenessPolicy,
      staleAfterSeconds: governance.staleAfterSeconds,
      sourceMessageId: message.id,
      sourceType: "session_message",
      observedAt: message.createdAt,
      lastVerifiedAt: message.createdAt,
      confidence: 0.99,
    },
  ];
}

function workspaceCommandFactCandidates(
  turnResult: TurnResultRecord,
  sessionMessages: SessionMessageRecord[]
): DurableMemoryCandidate[] {
  const governance = governanceRuleForMemoryType("fact");
  const deduped = new Map<string, DurableMemoryCandidate>();
  for (const source of durableMemorySources(turnResult, sessionMessages)) {
    for (const fact of detectWorkspaceCommandFacts(source.text)) {
      const summary = `Use \`${fact.command}\` for ${fact.label} in this workspace.`;
      const lines = [
        `# Workspace Fact: ${titleCase(fact.label)} Command`,
        "",
        `- Purpose: \`${fact.purpose}\``,
        `- Command: \`${fact.command}\``,
        `- Workspace ID: \`${turnResult.workspaceId}\``,
        `- Source: ${source.sourceLabel}`,
        `- Updated at: ${turnResult.completedAt ?? turnResult.updatedAt}`,
        "",
        "## Summary",
        "",
        summary,
        "",
        "## Evidence",
        "",
        fact.evidence,
      ];
      const memoryId = `workspace-fact:${turnResult.workspaceId}:command:${fact.purpose}`;
      if (!deduped.has(memoryId)) {
        deduped.set(memoryId, {
          memoryId,
          scope: "workspace",
          memoryType: "fact",
          subjectKey: `command:${fact.purpose}`,
          path: workspaceCommandFactPath(turnResult, fact.purpose),
          title: `${titleCase(fact.label)} command`,
          summary,
          content: `${lines.join("\n").trim()}\n`,
          tags: ["command", fact.purpose, fact.label],
          verificationPolicy: governance.verificationPolicy,
          stalenessPolicy: governance.stalenessPolicy,
          staleAfterSeconds: governance.staleAfterSeconds,
          sourceMessageId: source.sourceMessageId ?? null,
          sourceType: source.sourceType,
          observedAt: source.observedAt,
          lastVerifiedAt: source.observedAt,
          confidence: source.sourceType === "session_message" ? 0.94 : 0.88,
        });
      }
    }
  }
  return [...deduped.values()];
}

function workspaceBusinessFactCandidates(
  turnResult: TurnResultRecord,
  sessionMessages: SessionMessageRecord[]
): DurableMemoryCandidate[] {
  const governance = governanceRuleForMemoryType("fact");
  const deduped = new Map<string, DurableMemoryCandidate>();
  for (const source of durableMemorySources(turnResult, sessionMessages)) {
    for (const fact of detectWorkspaceBusinessFacts(source.text)) {
      const lines = [
        `# Workspace Fact: ${fact.title}`,
        "",
        `- Workspace ID: \`${turnResult.workspaceId}\``,
        `- Source: ${source.sourceLabel}`,
        `- Updated at: ${turnResult.completedAt ?? turnResult.updatedAt}`,
        "",
        "## Summary",
        "",
        fact.summary,
        "",
        "## Evidence",
        "",
        fact.evidence,
      ];
      const memoryId = `workspace-fact:${turnResult.workspaceId}:${fact.slug}`;
      if (!deduped.has(memoryId)) {
        deduped.set(memoryId, {
          memoryId,
          scope: "workspace",
          memoryType: "fact",
          subjectKey: `fact:${fact.slug}`,
          path: workspaceBusinessFactPath(turnResult, fact.slug),
          title: fact.title,
          summary: fact.summary,
          content: `${lines.join("\n").trim()}\n`,
          tags: [...fact.tags],
          verificationPolicy: governance.verificationPolicy,
          stalenessPolicy: governance.stalenessPolicy,
          staleAfterSeconds: governance.staleAfterSeconds,
          sourceMessageId: source.sourceMessageId ?? null,
          sourceType: source.sourceType,
          observedAt: source.observedAt,
          lastVerifiedAt: source.observedAt,
          confidence: source.sourceType === "session_message" ? 0.91 : 0.85,
        });
      }
    }
  }
  return [...deduped.values()];
}

function workspaceProcedureCandidates(
  turnResult: TurnResultRecord,
  sessionMessages: SessionMessageRecord[]
): DurableMemoryCandidate[] {
  const governance = governanceRuleForMemoryType("procedure");
  const deduped = new Map<string, DurableMemoryCandidate>();
  for (const source of durableMemorySources(turnResult, sessionMessages)) {
    for (const procedure of detectWorkspaceProcedure(source.text)) {
      const summary = `${titleCase(procedure.label)} procedure for this workspace.`;
      const lines = [
        `# Workspace Procedure: ${titleCase(procedure.label)}`,
        "",
        `- Procedure: \`${procedure.subject}\``,
        `- Workspace ID: \`${turnResult.workspaceId}\``,
        `- Source: ${source.sourceLabel}`,
        `- Updated at: ${turnResult.completedAt ?? turnResult.updatedAt}`,
        "",
        "## Summary",
        "",
        summary,
        "",
        "## Steps",
        "",
        ...procedure.steps.map((step, index) => `${index + 1}. ${step}`),
        "",
        "## Evidence",
        "",
        procedure.evidence,
      ];
      const memoryId = `workspace-procedure:${turnResult.workspaceId}:${procedure.subject}`;
      if (!deduped.has(memoryId)) {
        deduped.set(memoryId, {
          memoryId,
          scope: "workspace",
          memoryType: "procedure",
          subjectKey: `procedure:${procedure.subject}`,
          path: workspaceProcedurePath(turnResult, procedure.subject),
          title: `${titleCase(procedure.label)} procedure`,
          summary,
          content: `${lines.join("\n").trim()}\n`,
          tags: ["procedure", procedure.subject, procedure.label],
          verificationPolicy: governance.verificationPolicy,
          stalenessPolicy: governance.stalenessPolicy,
          staleAfterSeconds: governance.staleAfterSeconds,
          sourceMessageId: source.sourceMessageId ?? null,
          sourceType: source.sourceType,
          observedAt: source.observedAt,
          lastVerifiedAt: source.observedAt,
          confidence: source.sourceType === "session_message" ? 0.93 : 0.87,
        });
      }
    }
  }
  return [...deduped.values()];
}

function permissionBlockerCandidates(turnResult: TurnResultRecord, summary: string | null): RuntimeMemoryCandidate[] {
  return turnResult.permissionDenials.map((denial, index) => {
    const toolName = typeof denial.tool_name === "string" && denial.tool_name.trim() ? denial.tool_name.trim() : "unknown";
    const toolId = typeof denial.tool_id === "string" && denial.tool_id.trim() ? denial.tool_id.trim() : null;
    const reason = typeof denial.reason === "string" && denial.reason.trim() ? denial.reason.trim() : "permission denied";
    const lines = [
      "# Runtime Permission Blocker",
      "",
      `- Session ID: \`${turnResult.sessionId}\``,
      `- Input ID: \`${turnResult.inputId}\``,
      `- Tool: \`${toolName}\``,
      `- Tool ID: ${toolId ? `\`${toolId}\`` : "none"}`,
      `- Reason: ${reason}`,
      `- Stop reason: ${turnResult.stopReason ? `\`${turnResult.stopReason}\`` : "none"}`,
      `- Last seen: ${turnResult.completedAt ?? turnResult.updatedAt}`,
      "",
      "## Summary",
      "",
      summary ?? "No compact summary available.",
    ];
    return {
      scope: "workspace",
      key: `permission-blocker:${blockerKey(toolName, toolId, reason)}:${index}`,
      path: permissionBlockerPath(turnResult, toolName, toolId, reason),
      content: `${lines.join("\n").trim()}\n`,
    };
  });
}

function repeatedPermissionBlockerCandidates(params: {
  turnResult: TurnResultRecord;
  recentTurns: TurnResultRecord[];
  summary: string | null;
}): DurableMemoryCandidate[] {
  const governance = governanceRuleForMemoryType("blocker");
  return params.turnResult.permissionDenials.flatMap((denial) => {
    const toolName = typeof denial.tool_name === "string" && denial.tool_name.trim() ? denial.tool_name.trim() : "unknown";
    const toolId = typeof denial.tool_id === "string" && denial.tool_id.trim() ? denial.tool_id.trim() : null;
    const reason = typeof denial.reason === "string" && denial.reason.trim() ? denial.reason.trim() : "permission denied";
    const recurrenceCount = params.recentTurns.flatMap((turnResult) => turnResult.permissionDenials).filter((candidate) => {
      const candidateToolName =
        typeof candidate.tool_name === "string" && candidate.tool_name.trim() ? candidate.tool_name.trim() : "unknown";
      const candidateToolId =
        typeof candidate.tool_id === "string" && candidate.tool_id.trim() ? candidate.tool_id.trim() : null;
      const candidateReason =
        typeof candidate.reason === "string" && candidate.reason.trim() ? candidate.reason.trim() : "permission denied";
      return candidateToolName === toolName && candidateToolId === toolId && candidateReason === reason;
    }).length;

    if (recurrenceCount < 2) {
      return [];
    }

    const summary =
      `${toolName}${toolId ? ` (\`${toolId}\`)` : ""} may be denied by workspace policy. Seen ${recurrenceCount} times in recent turns.`;
    const lines = [
      "# Workspace Knowledge: Recurring Permission Blocker",
      "",
      `- Tool: \`${toolName}\``,
      `- Tool ID: ${toolId ? `\`${toolId}\`` : "none"}`,
      `- Reason: ${reason}`,
      `- Workspace ID: \`${params.turnResult.workspaceId}\``,
      `- Last seen: ${params.turnResult.completedAt ?? params.turnResult.updatedAt}`,
      `- Recent recurrence count: ${recurrenceCount}`,
      "",
      "## Summary",
      "",
      summary,
      "",
      "## Latest Turn Summary",
      "",
      params.summary ?? "No compact summary available.",
    ];
    const key = blockerKey(toolName, toolId, reason);
    return [
      {
        memoryId: `workspace-blocker:${params.turnResult.workspaceId}:${key}`,
        scope: "workspace",
        memoryType: "blocker",
        subjectKey: `permission:${key}`,
        path: repeatedPermissionKnowledgePath(params.turnResult, toolName, toolId, reason),
        title: `${titleCase(toolName)} permission blocker`,
        summary,
        content: `${lines.join("\n").trim()}\n`,
        tags: ["permission", "blocker", toolName, ...(toolId ? [toolId] : [])],
        verificationPolicy: governance.verificationPolicy,
        stalenessPolicy: governance.stalenessPolicy,
        staleAfterSeconds: governance.staleAfterSeconds,
        sourceType: "permission_denial",
        observedAt: params.turnResult.completedAt ?? params.turnResult.updatedAt,
        lastVerifiedAt: params.turnResult.completedAt ?? params.turnResult.updatedAt,
        confidence: 0.92,
      },
    ];
  });
}

function extractedMemoryPath(turnResult: TurnResultRecord, candidate: ExtractedDurableMemoryCandidate): string {
  const subjectToken = safePathSegment(candidate.subjectKey, "memory");
  if (candidate.scope === "user") {
    if (candidate.memoryType === "identity") {
      return `identity/${subjectToken}.md`;
    }
    return `preference/${subjectToken}.md`;
  }
  switch (candidate.memoryType) {
    case "procedure":
      return `workspace/${turnResult.workspaceId}/knowledge/procedures/${subjectToken}-procedure.md`;
    case "blocker":
      return `workspace/${turnResult.workspaceId}/knowledge/blockers/${subjectToken}.md`;
    case "reference":
      return `workspace/${turnResult.workspaceId}/knowledge/reference/${subjectToken}.md`;
    default:
      return `workspace/${turnResult.workspaceId}/knowledge/facts/${subjectToken}.md`;
  }
}

function extractedMemoryContent(params: {
  turnResult: TurnResultRecord;
  candidate: ExtractedDurableMemoryCandidate;
}): string {
  const lines = [
    `# ${params.candidate.title}`,
    "",
    `- Scope: \`${params.candidate.scope}\``,
    `- Type: \`${params.candidate.memoryType}\``,
    `- Subject: \`${params.candidate.subjectKey}\``,
    `- Workspace ID: \`${params.turnResult.workspaceId}\``,
    `- Session ID: \`${params.turnResult.sessionId}\``,
    `- Updated at: ${params.turnResult.completedAt ?? params.turnResult.updatedAt}`,
    "",
    "## Summary",
    "",
    params.candidate.summary,
  ];
  if (params.candidate.evidence) {
    lines.push("", "## Evidence", "", params.candidate.evidence);
  }
  return `${lines.join("\n").trim()}\n`;
}

function durableCandidateFromExtracted(params: {
  turnResult: TurnResultRecord;
  extracted: ExtractedDurableMemoryCandidate;
}): DurableMemoryCandidate {
  const governance = governanceRuleForMemoryType(params.extracted.memoryType);
  const pathValue = extractedMemoryPath(params.turnResult, params.extracted);
  const memoryId = `extracted:${createHash("sha256")
    .update(`${params.extracted.scope}:${params.extracted.memoryType}:${params.extracted.subjectKey}:${pathValue}`)
    .digest("hex")
    .slice(0, 24)}`;
  const observedAt = params.turnResult.completedAt ?? params.turnResult.updatedAt;
  return {
    memoryId,
    scope: params.extracted.scope,
    memoryType: params.extracted.memoryType,
    subjectKey: params.extracted.subjectKey,
    path: pathValue,
    title: params.extracted.title,
    summary: params.extracted.summary,
    content: extractedMemoryContent({
      turnResult: params.turnResult,
      candidate: params.extracted,
    }),
    tags: params.extracted.tags,
    verificationPolicy: governance.verificationPolicy,
    stalenessPolicy: governance.stalenessPolicy,
    staleAfterSeconds: governance.staleAfterSeconds,
    sourceType: "assistant_turn",
    observedAt,
    lastVerifiedAt: observedAt,
    confidence: params.extracted.confidence,
  };
}

async function extractedDurableMemoryCandidates(params: {
  turnResult: TurnResultRecord;
  recentTurns: TurnResultRecord[];
  sessionMessages: SessionMessageRecord[];
  modelContext?: TurnMemoryWritebackModelContext | null;
}): Promise<ModelDurableCandidate[]> {
  if (!params.modelContext?.modelClient) {
    return [];
  }
  const recentTurnSummaries = params.recentTurns
    .slice(0, 4)
    .map((turnResult) => turnResult.compactedSummary ?? compactTurnSummary(turnResult))
    .filter((summary): summary is string => Boolean(summary));
  const recentUserMessages = params.sessionMessages
    .filter((message) => message.role === "user")
    .slice(-4)
    .map((message) => clippedText(message.text, 220));
  const extractionContext: DurableMemoryExtractionContext = {
    modelClient: params.modelContext.modelClient,
    workspaceId: params.turnResult.workspaceId,
    sessionId: params.turnResult.sessionId,
    inputId: params.turnResult.inputId,
    instruction: params.modelContext.instruction?.trim() || recentUserMessages[recentUserMessages.length - 1] || "",
    assistantText: clippedText(params.turnResult.assistantText, 1400),
    recentUserMessages,
    recentTurnSummaries,
  };
  const extracted = await extractDurableMemoryCandidatesFromModel(extractionContext);
  return extracted.map((candidate) => ({
    extractedCandidate: candidate,
    durableCandidate: durableCandidateFromExtracted({
      turnResult: params.turnResult,
      extracted: candidate,
    }),
  }));
}

function hasHeuristicCorroboration(params: {
  turnResult: TurnResultRecord;
  extractedCandidate: ExtractedDurableMemoryCandidate;
  heuristicDurableCandidates: DurableMemoryCandidate[];
}): boolean {
  const extractedPath = extractedMemoryPath(params.turnResult, params.extractedCandidate);
  return params.heuristicDurableCandidates.some((candidate) => {
    if (candidate.path === extractedPath) {
      return true;
    }
    return (
      candidate.scope === params.extractedCandidate.scope &&
      candidate.memoryType === params.extractedCandidate.memoryType &&
      candidate.subjectKey === params.extractedCandidate.subjectKey
    );
  });
}

function acceptedModelDurableCandidates(params: {
  turnResult: TurnResultRecord;
  modelCandidates: ModelDurableCandidate[];
  heuristicDurableCandidates: DurableMemoryCandidate[];
}): DurableMemoryCandidate[] {
  const accepted: DurableMemoryCandidate[] = [];
  for (const modelCandidate of params.modelCandidates) {
    const corroborated = hasHeuristicCorroboration({
      turnResult: params.turnResult,
      extractedCandidate: modelCandidate.extractedCandidate,
      heuristicDurableCandidates: params.heuristicDurableCandidates,
    });
    const confidence = modelCandidate.extractedCandidate.confidence ?? -1;
    const evidenceChars = compactWhitespace(modelCandidate.extractedCandidate.evidence).length;
    const minConfidence = corroborated
      ? MODEL_EXTRACTION_MIN_CONFIDENCE_CORROBORATED
      : MODEL_EXTRACTION_MIN_CONFIDENCE;
    const minEvidenceChars = corroborated
      ? MODEL_EXTRACTION_MIN_EVIDENCE_CHARS_CORROBORATED
      : MODEL_EXTRACTION_MIN_EVIDENCE_CHARS;
    if (confidence < minConfidence || evidenceChars < minEvidenceChars) {
      continue;
    }
    accepted.push(modelCandidate.durableCandidate);
  }
  return accepted;
}

function mergeDurableCandidates(
  primary: DurableMemoryCandidate[],
  secondary: DurableMemoryCandidate[]
): DurableMemoryCandidate[] {
  const byPath = new Map<string, DurableMemoryCandidate>();
  for (const candidate of primary) {
    byPath.set(candidate.path, candidate);
  }
  for (const candidate of secondary) {
    if (!byPath.has(candidate.path)) {
      byPath.set(candidate.path, candidate);
    }
  }
  return [...byPath.values()];
}

function buildRuntimeMemoryCandidates(params: {
  turnResult: TurnResultRecord;
  summary: string | null;
  recentTurns: TurnResultRecord[];
  sessionMessages: SessionMessageRecord[];
}): RuntimeMemoryCandidate[] {
  return [
    {
      scope: "session",
      key: `session-state:${params.turnResult.sessionId}`,
      path: sessionStatePath(params.turnResult),
      content: renderSessionState(params.turnResult, params.summary),
    },
    {
      scope: "session",
      key: `blocker-state:${params.turnResult.sessionId}`,
      path: blockerStatePath(params.turnResult),
      content: renderBlockerState(params.turnResult),
    },
    {
      scope: "workspace",
      key: "latest-turn",
      path: latestTurnPath(params.turnResult),
      content: renderLatestTurn(params.turnResult, params.summary),
    },
    {
      scope: "workspace",
      key: `recent-turns:${params.turnResult.sessionId}`,
      path: recentTurnsPath(params.turnResult),
      content: renderRecentTurns(params.recentTurns),
    },
    {
      scope: "session",
      key: `session-memory:${params.turnResult.sessionId}`,
      path: sessionMemoryPath(params.turnResult),
      content: renderSessionMemory(params.turnResult, params.recentTurns, params.sessionMessages),
    },
    ...permissionBlockerCandidates(params.turnResult, params.summary),
  ];
}

function buildDurableMemoryCandidates(params: {
  turnResult: TurnResultRecord;
  summary: string | null;
  recentTurns: TurnResultRecord[];
  sessionMessages: SessionMessageRecord[];
}): DurableMemoryCandidate[] {
  return [
    ...responseStylePreferenceCandidate(params.turnResult, params.sessionMessages),
    ...workspaceCommandFactCandidates(params.turnResult, params.sessionMessages),
    ...workspaceBusinessFactCandidates(params.turnResult, params.sessionMessages),
    ...workspaceProcedureCandidates(params.turnResult, params.sessionMessages),
    ...repeatedPermissionBlockerCandidates({
      turnResult: params.turnResult,
      recentTurns: params.recentTurns,
      summary: params.summary,
    }),
  ];
}

function renderWorkspaceMemoryIndex(params: {
  workspaceId: string;
  entries: DurableMemoryCandidate[];
}): string {
  const lines = [
    "# Workspace Durable Memory Index",
    "",
    `- Workspace ID: \`${params.workspaceId}\``,
    `- Indexed memories: ${params.entries.length}`,
    "",
  ];
  if (params.entries.length === 0) {
    lines.push("No durable workspace memories indexed yet.");
    return `${lines.join("\n").trim()}\n`;
  }
  for (const entry of params.entries.sort((left, right) => left.path.localeCompare(right.path))) {
    const relativeTarget = path.posix.relative(`workspace/${params.workspaceId}`, entry.path);
    lines.push(`- [${entry.title}](${relativeTarget}) - ${entry.summary}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function renderPreferenceMemoryIndex(entries: DurableMemoryCandidate[]): string {
  const lines = [
    "# Preference Memory Index",
    "",
    `- Indexed memories: ${entries.length}`,
    "",
  ];
  if (entries.length === 0) {
    lines.push("No durable preference memories indexed yet.");
    return `${lines.join("\n").trim()}\n`;
  }
  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    const relativeTarget = path.posix.relative("preference", entry.path);
    lines.push(`- [${entry.title}](${relativeTarget}) - ${entry.summary}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function renderRootMemoryIndex(params: {
  workspaceIndexCounts: Array<{ workspaceId: string; count: number }>;
  preferenceEntryCount: number;
}): string {
  const lines = [
    "# Memory Index",
    "",
    "Use the scoped indexes below to find durable memory. Runtime state under `workspace/<workspace-id>/runtime/` is intentionally not indexed here.",
    "",
  ];
  for (const workspaceIndex of params.workspaceIndexCounts.sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))) {
    lines.push(
      `- [Workspace ${workspaceIndex.workspaceId}](workspace/${workspaceIndex.workspaceId}/MEMORY.md) - ${workspaceIndex.count} durable workspace memories.`
    );
  }
  if (params.preferenceEntryCount > 0) {
    lines.push(`- [Preferences](preference/MEMORY.md) - ${params.preferenceEntryCount} durable preference memories.`);
  }
  if (lines.length === 4) {
    lines.push("No durable memories indexed yet.");
  }
  return `${lines.join("\n").trim()}\n`;
}

async function upsertMemoryIndexes(params: {
  store: RuntimeStateStore;
  memoryService: MemoryServiceLike;
  workspaceId: string;
}): Promise<string[]> {
  const entries = params.store.listMemoryEntries({
    status: "active",
    limit: 500,
    offset: 0,
  });
  const workspaceEntries = entries.filter((entry) => entry.scope === "workspace" && entry.workspaceId === params.workspaceId);
  const workspaceIndexCounts = [...new Set(entries
    .filter((entry) => entry.scope === "workspace" && entry.workspaceId)
    .map((entry) => entry.workspaceId as string))]
    .map((workspaceId) => ({
      workspaceId,
      count: entries.filter((entry) => entry.scope === "workspace" && entry.workspaceId === workspaceId).length,
    }));
  const preferenceEntries = entries.filter((entry) => entry.scope === "user");
  const restoredPaths: string[] = [];
  const workspaceIndexContent = renderWorkspaceMemoryIndex({
    workspaceId: params.workspaceId,
    entries: workspaceEntries.map((entry) => ({
      memoryId: entry.memoryId,
      scope: entry.scope as "workspace" | "user",
      memoryType: entry.memoryType as MemoryEntryType,
      subjectKey: entry.subjectKey,
      path: entry.path,
      title: entry.title,
      summary: entry.summary,
      content: "",
      tags: entry.tags,
      verificationPolicy: entry.verificationPolicy as MemoryVerificationPolicy,
      stalenessPolicy: entry.stalenessPolicy as MemoryStalenessPolicy,
      staleAfterSeconds: entry.staleAfterSeconds,
      sourceType: entry.sourceType ?? "manual",
      observedAt: entry.observedAt,
      lastVerifiedAt: entry.lastVerifiedAt,
      confidence: entry.confidence,
    })),
  });
  await params.memoryService.upsert({
    workspace_id: params.workspaceId,
    path: workspaceMemoryIndexPath(params.workspaceId),
    content: workspaceIndexContent,
    append: false,
  });
  restoredPaths.push(workspaceMemoryIndexPath(params.workspaceId));

  const preferenceIndexContent = renderPreferenceMemoryIndex(
    preferenceEntries.map((entry) => ({
      memoryId: entry.memoryId,
      scope: entry.scope as "workspace" | "user",
      memoryType: entry.memoryType as MemoryEntryType,
      subjectKey: entry.subjectKey,
      path: entry.path,
      title: entry.title,
      summary: entry.summary,
      content: "",
      tags: entry.tags,
      verificationPolicy: entry.verificationPolicy as MemoryVerificationPolicy,
      stalenessPolicy: entry.stalenessPolicy as MemoryStalenessPolicy,
      staleAfterSeconds: entry.staleAfterSeconds,
      sourceType: entry.sourceType ?? "manual",
      observedAt: entry.observedAt,
      lastVerifiedAt: entry.lastVerifiedAt,
      confidence: entry.confidence,
    }))
  );
  await params.memoryService.upsert({
    workspace_id: params.workspaceId,
    path: preferenceMemoryIndexPath(),
    content: preferenceIndexContent,
    append: false,
  });
  restoredPaths.push(preferenceMemoryIndexPath());

  const rootIndexContent = renderRootMemoryIndex({
    workspaceIndexCounts,
    preferenceEntryCount: preferenceEntries.length,
  });
  await params.memoryService.upsert({
    workspace_id: params.workspaceId,
    path: rootMemoryIndexPath(),
    content: rootIndexContent,
    append: false,
  });
  restoredPaths.push(rootMemoryIndexPath());

  return restoredPaths;
}

function upsertCompactedSummary(store: RuntimeStateStore, turnResult: TurnResultRecord, compactedSummary: string | null): TurnResultRecord {
  if (turnResult.compactedSummary === compactedSummary) {
    return turnResult;
  }
  return store.upsertTurnResult({
    workspaceId: turnResult.workspaceId,
    sessionId: turnResult.sessionId,
    inputId: turnResult.inputId,
    startedAt: turnResult.startedAt,
    completedAt: turnResult.completedAt,
    status: turnResult.status,
    stopReason: turnResult.stopReason,
    assistantText: turnResult.assistantText,
    toolUsageSummary: turnResult.toolUsageSummary,
    permissionDenials: turnResult.permissionDenials,
    promptSectionIds: turnResult.promptSectionIds,
    capabilityManifestFingerprint: turnResult.capabilityManifestFingerprint,
    requestSnapshotFingerprint: turnResult.requestSnapshotFingerprint,
    promptCacheProfile: turnResult.promptCacheProfile,
    compactedSummary,
    compactionBoundaryId: turnResult.compactionBoundaryId,
    tokenUsage: turnResult.tokenUsage,
    createdAt: turnResult.createdAt,
  });
}

function compactionBoundaryId(turnResult: TurnResultRecord): string {
  return `compaction:${turnResult.inputId}`;
}

function upsertCompactionBoundaryArtifact(params: {
  store: RuntimeStateStore;
  turnResult: TurnResultRecord;
  recentTurns: TurnResultRecord[];
  sessionMessages: SessionMessageRecord[];
  restoredMemoryPaths: string[];
}): TurnResultRecord {
  const previousBoundary = params.store
    .listCompactionBoundaries({
      workspaceId: params.turnResult.workspaceId,
      sessionId: params.turnResult.sessionId,
      limit: 2,
      offset: 0,
    })
    .find((boundary) => boundary.inputId !== params.turnResult.inputId) ?? null;
  const boundaryArtifacts = buildCompactionBoundaryArtifacts({
    turnResult: params.turnResult,
    recentTurns: params.recentTurns,
    sessionMessages: params.sessionMessages,
    restoredMemoryPaths: params.restoredMemoryPaths,
  });
  const boundaryId = compactionBoundaryId(params.turnResult);
  params.store.upsertCompactionBoundary({
    boundaryId,
    workspaceId: params.turnResult.workspaceId,
    sessionId: params.turnResult.sessionId,
    inputId: params.turnResult.inputId,
    boundaryType: "executor_post_turn",
    previousBoundaryId: previousBoundary?.boundaryId ?? null,
    summary: boundaryArtifacts.summary,
    recentRuntimeContext: boundaryArtifacts.recentRuntimeContext as Record<string, unknown> | null,
    restorationContext: boundaryArtifacts.restorationContext,
    preservedTurnInputIds: boundaryArtifacts.preservedTurnInputIds,
    requestSnapshotFingerprint: params.turnResult.requestSnapshotFingerprint,
  });
  if (params.turnResult.compactionBoundaryId === boundaryId) {
    return params.turnResult;
  }
  return params.store.upsertTurnResult({
    workspaceId: params.turnResult.workspaceId,
    sessionId: params.turnResult.sessionId,
    inputId: params.turnResult.inputId,
    startedAt: params.turnResult.startedAt,
    completedAt: params.turnResult.completedAt,
    status: params.turnResult.status,
    stopReason: params.turnResult.stopReason,
    assistantText: params.turnResult.assistantText,
    toolUsageSummary: params.turnResult.toolUsageSummary,
    permissionDenials: params.turnResult.permissionDenials,
    promptSectionIds: params.turnResult.promptSectionIds,
    capabilityManifestFingerprint: params.turnResult.capabilityManifestFingerprint,
    requestSnapshotFingerprint: params.turnResult.requestSnapshotFingerprint,
    promptCacheProfile: params.turnResult.promptCacheProfile,
    compactedSummary: params.turnResult.compactedSummary,
    compactionBoundaryId: boundaryId,
    tokenUsage: params.turnResult.tokenUsage,
    createdAt: params.turnResult.createdAt,
  });
}

async function upsertRuntimeMemoryCandidate(params: {
  memoryService: MemoryServiceLike;
  workspaceId: string;
  candidate: RuntimeMemoryCandidate;
}): Promise<string> {
  await params.memoryService.upsert({
    workspace_id: params.workspaceId,
    path: params.candidate.path,
    content: params.candidate.content,
    append: false,
  });
  return params.candidate.path;
}

async function upsertDurableMemoryCandidate(params: {
  store: RuntimeStateStore;
  memoryService: MemoryServiceLike;
  workspaceId: string;
  sessionId: string;
  inputId: string;
  candidate: DurableMemoryCandidate;
}): Promise<string> {
  await params.memoryService.upsert({
    workspace_id: params.workspaceId,
    path: params.candidate.path,
    content: params.candidate.content,
    append: false,
  });
  params.store.upsertMemoryEntry({
    memoryId: params.candidate.memoryId,
    workspaceId: params.candidate.scope === "workspace" ? params.workspaceId : null,
    sessionId: params.sessionId,
    scope: params.candidate.scope,
    memoryType: params.candidate.memoryType,
    subjectKey: params.candidate.subjectKey,
    path: params.candidate.path,
    title: params.candidate.title,
    summary: params.candidate.summary,
    tags: params.candidate.tags,
    verificationPolicy: params.candidate.verificationPolicy,
    stalenessPolicy: params.candidate.stalenessPolicy,
    staleAfterSeconds: params.candidate.staleAfterSeconds,
    sourceTurnInputId: params.inputId,
    sourceMessageId: params.candidate.sourceMessageId ?? null,
    sourceType: params.candidate.sourceType,
    observedAt: params.candidate.observedAt,
    lastVerifiedAt: params.candidate.lastVerifiedAt,
    confidence: params.candidate.confidence,
    fingerprint: fingerprintText(params.candidate.content),
  });
  return params.candidate.path;
}

export async function writeTurnMemory(params: {
  store: RuntimeStateStore;
  memoryService: MemoryServiceLike;
  turnResult: TurnResultRecord;
  modelContext?: TurnMemoryWritebackModelContext | null;
}): Promise<TurnResultRecord> {
  const compactedSummary = compactTurnSummary(params.turnResult);
  const updatedTurnResult = upsertCompactedSummary(params.store, params.turnResult, compactedSummary);
  const recentTurns = params.store.listTurnResults({
    workspaceId: updatedTurnResult.workspaceId,
    sessionId: updatedTurnResult.sessionId,
    limit: RECENT_TURNS_LIMIT,
    offset: 0,
  });
  const sessionMessages = params.store.listSessionMessages({
    workspaceId: updatedTurnResult.workspaceId,
    sessionId: updatedTurnResult.sessionId,
  });
  const runtimeCandidates = buildRuntimeMemoryCandidates({
    turnResult: updatedTurnResult,
    summary: compactedSummary,
    recentTurns,
    sessionMessages,
  });
  const heuristicDurableCandidates = buildDurableMemoryCandidates({
    turnResult: updatedTurnResult,
    summary: compactedSummary,
    recentTurns,
    sessionMessages,
  });
  const extractedCandidates = await extractedDurableMemoryCandidates({
    turnResult: updatedTurnResult,
    recentTurns,
    sessionMessages,
    modelContext: params.modelContext ?? null,
  });
  const acceptedExtractedCandidates = acceptedModelDurableCandidates({
    turnResult: updatedTurnResult,
    modelCandidates: extractedCandidates,
    heuristicDurableCandidates,
  });
  const durableCandidates = mergeDurableCandidates(acceptedExtractedCandidates, heuristicDurableCandidates);
  const restoredMemoryPaths: string[] = [];

  try {
    for (const candidate of runtimeCandidates) {
      restoredMemoryPaths.push(await upsertRuntimeMemoryCandidate({
        memoryService: params.memoryService,
        workspaceId: updatedTurnResult.workspaceId,
        candidate,
      }));
    }
    for (const candidate of durableCandidates) {
      restoredMemoryPaths.push(await upsertDurableMemoryCandidate({
        store: params.store,
        memoryService: params.memoryService,
        workspaceId: updatedTurnResult.workspaceId,
        sessionId: updatedTurnResult.sessionId,
        inputId: updatedTurnResult.inputId,
        candidate,
      }));
    }
    restoredMemoryPaths.push(...await upsertMemoryIndexes({
      store: params.store,
      memoryService: params.memoryService,
      workspaceId: updatedTurnResult.workspaceId,
    }));
  } catch {
    return upsertCompactionBoundaryArtifact({
      store: params.store,
      turnResult: updatedTurnResult,
      recentTurns,
      sessionMessages,
      restoredMemoryPaths,
    });
  }

  return upsertCompactionBoundaryArtifact({
    store: params.store,
    turnResult: updatedTurnResult,
    recentTurns,
    sessionMessages,
    restoredMemoryPaths,
  });
}
