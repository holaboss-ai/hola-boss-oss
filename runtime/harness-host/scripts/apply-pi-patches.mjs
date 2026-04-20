import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

function patchFile(relativePath, replacements) {
  const filePath = path.join(rootDir, relativePath);
  let contents = fs.readFileSync(filePath, "utf8");
  let changed = false;

  for (const replacement of replacements) {
    if (replacement.verify && contents.includes(replacement.verify)) {
      continue;
    }
    if (!contents.includes(replacement.match)) {
      throw new Error(`Expected patch target not found in ${relativePath}`);
    }
    contents = contents.replace(replacement.match, replacement.replace);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, contents);
  }
}

patchFile("node_modules/@mariozechner/pi-ai/dist/providers/openai-responses.js", [
  {
    verify: "function supportsPromptCacheRetention(baseUrl) {",
    match: `/**
 * Get prompt cache retention based on cacheRetention and base URL.
 * Only applies to direct OpenAI API calls (api.openai.com).
 */
function getPromptCacheRetention(baseUrl, cacheRetention) {
    if (cacheRetention !== "long") {
        return undefined;
    }
    if (baseUrl.includes("api.openai.com")) {
        return "24h";
    }
    return undefined;
}
`,
    replace: `/**
 * Get prompt cache retention based on cacheRetention and base URL.
 * Applies to direct OpenAI API calls and explicit proxy routes that target OpenAI.
 */
function supportsPromptCacheRetention(baseUrl) {
    if (baseUrl.includes("api.openai.com")) {
        return true;
    }
    try {
        const url = new URL(baseUrl);
        return /(?:^|\\/)openai(?:\\/|$)/.test(url.pathname);
    }
    catch {
        return /(?:^|\\/)openai(?:\\/|$)/.test(baseUrl);
    }
}
function getPromptCacheRetention(baseUrl, cacheRetention) {
    if (cacheRetention !== "long") {
        return undefined;
    }
    if (supportsPromptCacheRetention(baseUrl)) {
        return "24h";
    }
    return undefined;
}
`,
  },
]);

patchFile("node_modules/@mariozechner/pi-coding-agent/dist/core/compaction/compaction.js", [
  {
    verify: "previousSummary, sessionId) {",
    match: "export async function generateSummary(currentMessages, model, reserveTokens, apiKey, headers, signal, customInstructions, previousSummary) {",
    replace: "export async function generateSummary(currentMessages, model, reserveTokens, apiKey, headers, signal, customInstructions, previousSummary, sessionId) {",
  },
  {
    verify: 'reasoning: "high", sessionId',
    match: `    const completionOptions = model.reasoning
        ? { maxTokens, signal, apiKey, headers, reasoning: "high" }
        : { maxTokens, signal, apiKey, headers };
`,
    replace: `    const completionOptions = model.reasoning
        ? { maxTokens, signal, apiKey, headers, reasoning: "high", sessionId }
        : { maxTokens, signal, apiKey, headers, sessionId };
`,
  },
  {
    verify: "customInstructions, signal, sessionId) {",
    match: "export async function compact(preparation, model, apiKey, headers, customInstructions, signal) {",
    replace: "export async function compact(preparation, model, apiKey, headers, customInstructions, signal, sessionId) {",
  },
  {
    verify: "previousSummary, sessionId)",
    match: "? generateSummary(messagesToSummarize, model, settings.reserveTokens, apiKey, headers, signal, customInstructions, previousSummary)",
    replace: "? generateSummary(messagesToSummarize, model, settings.reserveTokens, apiKey, headers, signal, customInstructions, previousSummary, sessionId)",
  },
  {
    verify: "signal, sessionId),",
    match: "generateTurnPrefixSummary(turnPrefixMessages, model, settings.reserveTokens, apiKey, headers, signal),",
    replace: "generateTurnPrefixSummary(turnPrefixMessages, model, settings.reserveTokens, apiKey, headers, signal, sessionId),",
  },
  {
    verify: "previousSummary, sessionId);",
    match: "summary = await generateSummary(messagesToSummarize, model, settings.reserveTokens, apiKey, headers, signal, customInstructions, previousSummary);",
    replace: "summary = await generateSummary(messagesToSummarize, model, settings.reserveTokens, apiKey, headers, signal, customInstructions, previousSummary, sessionId);",
  },
  {
    verify: "signal, sessionId) {",
    match: "async function generateTurnPrefixSummary(messages, model, reserveTokens, apiKey, headers, signal) {",
    replace: "async function generateTurnPrefixSummary(messages, model, reserveTokens, apiKey, headers, signal, sessionId) {",
  },
  {
    verify: "{ maxTokens, signal, apiKey, headers, sessionId }",
    match: "    const response = await completeSimple(model, { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages }, { maxTokens, signal, apiKey, headers });",
    replace: "    const response = await completeSimple(model, { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages }, { maxTokens, signal, apiKey, headers, sessionId });",
  },
]);

patchFile("node_modules/@mariozechner/pi-coding-agent/dist/core/compaction/compaction.d.ts", [
  {
    verify: "previousSummary?: string, sessionId?: string",
    match: "export declare function generateSummary(currentMessages: AgentMessage[], model: Model<any>, reserveTokens: number, apiKey: string, headers?: Record<string, string>, signal?: AbortSignal, customInstructions?: string, previousSummary?: string): Promise<string>;",
    replace: "export declare function generateSummary(currentMessages: AgentMessage[], model: Model<any>, reserveTokens: number, apiKey: string, headers?: Record<string, string>, signal?: AbortSignal, customInstructions?: string, previousSummary?: string, sessionId?: string): Promise<string>;",
  },
  {
    verify: "signal?: AbortSignal, sessionId?: string",
    match: "export declare function compact(preparation: CompactionPreparation, model: Model<any>, apiKey: string, headers?: Record<string, string>, customInstructions?: string, signal?: AbortSignal): Promise<CompactionResult>;",
    replace: "export declare function compact(preparation: CompactionPreparation, model: Model<any>, apiKey: string, headers?: Record<string, string>, customInstructions?: string, signal?: AbortSignal, sessionId?: string): Promise<CompactionResult>;",
  },
]);

patchFile("node_modules/@mariozechner/pi-coding-agent/dist/core/compaction/branch-summarization.js", [
  {
    verify: "reserveTokens = 16384, sessionId } = options",
    match: "    const { model, apiKey, headers, signal, customInstructions, replaceInstructions, reserveTokens = 16384 } = options;",
    replace: "    const { model, apiKey, headers, signal, customInstructions, replaceInstructions, reserveTokens = 16384, sessionId } = options;",
  },
  {
    verify: "maxTokens: 2048, sessionId",
    match: "    const response = await completeSimple(model, { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages }, { apiKey, headers, signal, maxTokens: 2048 });",
    replace: "    const response = await completeSimple(model, { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages }, { apiKey, headers, signal, maxTokens: 2048, sessionId });",
  },
]);

patchFile("node_modules/@mariozechner/pi-coding-agent/dist/core/compaction/branch-summarization.d.ts", [
  {
    verify: "sessionId?: string;",
    match: `    /** Tokens reserved for prompt + LLM response (default 16384) */
    reserveTokens?: number;
`,
    replace: `    /** Tokens reserved for prompt + LLM response (default 16384) */
    reserveTokens?: number;
    /** Stable cache key for summarization requests */
    sessionId?: string;
`,
  },
]);

patchFile("node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js", [
  {
    verify: "this._compactionAbortController.signal, this.sessionId",
    match: "const result = await compact(preparation, this.model, apiKey, headers, customInstructions, this._compactionAbortController.signal);",
    replace: "const result = await compact(preparation, this.model, apiKey, headers, customInstructions, this._compactionAbortController.signal, this.sessionId);",
  },
  {
    verify: "this._autoCompactionAbortController.signal, this.sessionId",
    match: "const compactResult = await compact(preparation, this.model, apiKey, headers, undefined, this._autoCompactionAbortController.signal);",
    replace: "const compactResult = await compact(preparation, this.model, apiKey, headers, undefined, this._autoCompactionAbortController.signal, this.sessionId);",
  },
  {
    verify: "reserveTokens: branchSummarySettings.reserveTokens,\n                sessionId: this.sessionId,",
    match: `                reserveTokens: branchSummarySettings.reserveTokens,
            });
`,
    replace: `                reserveTokens: branchSummarySettings.reserveTokens,
                sessionId: this.sessionId,
            });
`,
  },
]);
