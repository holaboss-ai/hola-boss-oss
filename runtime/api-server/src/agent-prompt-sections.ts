import { createHash } from "node:crypto";

import type {
  HarnessPromptLayerApplyAt,
  HarnessPromptLayerId,
  HarnessPromptLayerPayload,
} from "../../harnesses/src/types.js";

export type AgentPromptSectionChannel = "system_prompt" | "context_message";

export type AgentPromptSectionVolatility = "stable" | "workspace" | "run";

export interface AgentPromptSection {
  id: HarnessPromptLayerId;
  channel: AgentPromptSectionChannel;
  apply_at: HarnessPromptLayerApplyAt;
  priority: number;
  volatility: AgentPromptSectionVolatility;
  content: string;
}

export interface AgentPromptCacheProfile {
  cacheable_section_ids: HarnessPromptLayerId[];
  volatile_section_ids: HarnessPromptLayerId[];
  context_message_ids: HarnessPromptLayerId[];
  cacheable_system_prompt: string;
  volatile_system_prompt: string;
  cacheable_fingerprint: string;
  volatile_fingerprint: string | null;
  full_system_prompt_fingerprint: string;
}

function normalizedContent(content: string): string {
  return content.trim();
}

export function sortAgentPromptSections(
  sections: AgentPromptSection[]
): AgentPromptSection[] {
  return [...sections].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    if (left.apply_at !== right.apply_at) {
      return left.apply_at.localeCompare(right.apply_at);
    }
    if (left.channel !== right.channel) {
      return left.channel.localeCompare(right.channel);
    }
    return left.id.localeCompare(right.id);
  });
}

export function normalizeAgentPromptSection(
  section: AgentPromptSection | null
): AgentPromptSection | null {
  if (!section) {
    return null;
  }
  const content = normalizedContent(section.content);
  if (!content) {
    return null;
  }
  return {
    ...section,
    content,
  };
}

export function collectAgentPromptSections(
  sections: Array<AgentPromptSection | null>
): AgentPromptSection[] {
  return sortAgentPromptSections(
    sections
      .map((section) => normalizeAgentPromptSection(section))
      .filter((section): section is AgentPromptSection => section !== null)
  );
}

export function renderAgentPromptSections(
  sections: AgentPromptSection[],
  channel: AgentPromptSectionChannel
): string {
  return sortAgentPromptSections(sections)
    .filter((section) => section.channel === channel)
    .map((section) => section.content)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function collectPromptSectionContents(
  sections: AgentPromptSection[],
  channel: AgentPromptSectionChannel
): string[] {
  return sortAgentPromptSections(sections)
    .filter((section) => section.channel === channel)
    .map((section) => section.content)
    .filter(Boolean);
}

export function projectPromptLayersFromSections(
  sections: AgentPromptSection[]
): HarnessPromptLayerPayload[] {
  return sortAgentPromptSections(sections)
    .filter((section) => section.channel === "system_prompt")
    .map((section) => ({
      id: section.id,
      apply_at: section.apply_at,
      content: section.content,
    }));
}

function fingerprintText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildPromptCacheProfileFromSections(
  sections: AgentPromptSection[]
): AgentPromptCacheProfile {
  const normalized = sortAgentPromptSections(sections).filter((section) => section.channel === "system_prompt");
  const cacheableSections = normalized.filter((section) => section.volatility !== "run");
  const volatileSections = normalized.filter((section) => section.volatility === "run");
  const contextMessageIds = sortAgentPromptSections(sections)
    .filter((section) => section.channel === "context_message")
    .map((section) => section.id);
  const cacheableSystemPrompt = renderAgentPromptSections(cacheableSections, "system_prompt");
  const volatileSystemPrompt = renderAgentPromptSections(volatileSections, "system_prompt");
  const fullSystemPrompt = renderAgentPromptSections(normalized, "system_prompt");
  return {
    cacheable_section_ids: cacheableSections.map((section) => section.id),
    volatile_section_ids: volatileSections.map((section) => section.id),
    context_message_ids: contextMessageIds,
    cacheable_system_prompt: cacheableSystemPrompt,
    volatile_system_prompt: volatileSystemPrompt,
    cacheable_fingerprint: fingerprintText(cacheableSystemPrompt),
    volatile_fingerprint: volatileSystemPrompt ? fingerprintText(volatileSystemPrompt) : null,
    full_system_prompt_fingerprint: fingerprintText(fullSystemPrompt),
  };
}
