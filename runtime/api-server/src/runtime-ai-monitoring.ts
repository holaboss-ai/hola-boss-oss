const AI_SPAN_ATTRIBUTE = "holaboss.ai_span";

export interface GenAiUsageMetrics {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  reasoningOutputTokens?: number | null;
  totalTokens?: number | null;
  inputCostUsd?: number | null;
  outputCostUsd?: number | null;
  totalCostUsd?: number | null;
}

type MinimalSpan = {
  setAttribute(key: string, value: string | number | boolean | undefined): unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordValue(
  value: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  return isRecord(value[key]) ? (value[key] as Record<string, unknown>) : null;
}

function usageRecord(payload: unknown): Record<string, unknown> | null {
  return isRecord(payload) && isRecord(payload.usage)
    ? (payload.usage as Record<string, unknown>)
    : null;
}

function sumNumbers(...values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  return present.reduce((total, value) => total + value, 0);
}

function numericCost(
  usage: Record<string, unknown> | null,
  key: string,
): number | null {
  const direct = finiteNumberOrNull(usage?.[key]);
  if (direct !== null) {
    return direct;
  }
  const costRecord = recordValue(usage, "cost");
  return finiteNumberOrNull(costRecord?.[key]);
}

export function createAiOnlyTracesSampler(
  defaultRate = 1,
): (samplingContext: {
  name?: string;
  attributes?: Record<string, unknown>;
  parentSampled?: boolean;
  inheritOrSampleWith?: (fallback: number) => number;
}) => number | boolean {
  return (samplingContext) => {
    if (typeof samplingContext.parentSampled === "boolean") {
      return samplingContext.parentSampled ? 1 : 0;
    }
    if (samplingContext.attributes?.[AI_SPAN_ATTRIBUTE] === true) {
      return defaultRate;
    }
    if (typeof samplingContext.name === "string" && samplingContext.name.startsWith("gen_ai.")) {
      return defaultRate;
    }
    return samplingContext.inheritOrSampleWith
      ? samplingContext.inheritOrSampleWith(0)
      : 0;
  };
}

export function genAiSpanAttributes(params: {
  operationName: string;
  model: string;
  providerId?: string | null;
  workspaceId?: string | null;
  sessionId?: string | null;
  inputId?: string | null;
  userId?: string | null;
  sandboxId?: string | null;
  promptSystemChars?: number | null;
  promptUserChars?: number | null;
  size?: string | null;
}): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {
    [AI_SPAN_ATTRIBUTE]: true,
    "gen_ai.operation.name": params.operationName,
    "gen_ai.request.model": params.model,
  };
  if (params.providerId?.trim()) {
    attributes["holaboss.provider_id"] = params.providerId.trim();
  }
  if (params.workspaceId?.trim()) {
    attributes["holaboss.workspace_id"] = params.workspaceId.trim();
  }
  if (params.sessionId?.trim()) {
    attributes["holaboss.session_id"] = params.sessionId.trim();
  }
  if (params.inputId?.trim()) {
    attributes["holaboss.input_id"] = params.inputId.trim();
  }
  if (params.userId?.trim()) {
    attributes["holaboss.user_id"] = params.userId.trim();
  }
  if (params.sandboxId?.trim()) {
    attributes["holaboss.sandbox_id"] = params.sandboxId.trim();
  }
  if (typeof params.promptSystemChars === "number" && Number.isFinite(params.promptSystemChars)) {
    attributes["holaboss.prompt.system_chars"] = params.promptSystemChars;
  }
  if (typeof params.promptUserChars === "number" && Number.isFinite(params.promptUserChars)) {
    attributes["holaboss.prompt.user_chars"] = params.promptUserChars;
  }
  if (params.size?.trim()) {
    attributes["holaboss.image.size"] = params.size.trim();
  }
  return attributes;
}

export function applyGenAiUsageMetrics(
  span: MinimalSpan,
  usage: GenAiUsageMetrics | null | undefined,
): void {
  if (!usage) {
    return;
  }
  if (usage.inputTokens !== null && usage.inputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.input_tokens", usage.inputTokens);
  }
  if (usage.outputTokens !== null && usage.outputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.output_tokens", usage.outputTokens);
  }
  if (usage.cachedInputTokens !== null && usage.cachedInputTokens !== undefined) {
    span.setAttribute(
      "gen_ai.usage.input_tokens.cached",
      usage.cachedInputTokens,
    );
  }
  if (
    usage.cacheWriteInputTokens !== null &&
    usage.cacheWriteInputTokens !== undefined
  ) {
    span.setAttribute(
      "gen_ai.usage.input_tokens.cache_write",
      usage.cacheWriteInputTokens,
    );
  }
  if (
    usage.reasoningOutputTokens !== null &&
    usage.reasoningOutputTokens !== undefined
  ) {
    span.setAttribute(
      "gen_ai.usage.output_tokens.reasoning",
      usage.reasoningOutputTokens,
    );
  }
  if (usage.inputCostUsd !== null && usage.inputCostUsd !== undefined) {
    span.setAttribute("gen_ai.cost.input_tokens", usage.inputCostUsd);
  }
  if (usage.outputCostUsd !== null && usage.outputCostUsd !== undefined) {
    span.setAttribute("gen_ai.cost.output_tokens", usage.outputCostUsd);
  }
  if (usage.totalCostUsd !== null && usage.totalCostUsd !== undefined) {
    span.setAttribute("gen_ai.cost.total_tokens", usage.totalCostUsd);
  }
  if (usage.totalTokens !== null && usage.totalTokens !== undefined) {
    span.setAttribute("holaboss.token_usage.total_tokens", usage.totalTokens);
  }
}

export function openAiCompatibleUsageMetrics(
  payload: unknown,
  options: { defaultOutputTokens?: number | null } = {},
): GenAiUsageMetrics | null {
  const usage = usageRecord(payload);
  if (!usage) {
    return null;
  }
  const inputTokens =
    finiteNumberOrNull(usage.input_tokens) ??
    finiteNumberOrNull(usage.prompt_tokens);
  const outputTokens =
    finiteNumberOrNull(usage.output_tokens) ??
    finiteNumberOrNull(usage.completion_tokens) ??
    options.defaultOutputTokens ??
    null;
  const cachedInputTokens =
    finiteNumberOrNull(recordValue(usage, "input_tokens_details")?.cached_tokens) ??
    finiteNumberOrNull(recordValue(usage, "prompt_tokens_details")?.cached_tokens);
  const cacheWriteInputTokens =
    finiteNumberOrNull(recordValue(usage, "input_tokens_details")?.cache_creation_tokens) ??
    finiteNumberOrNull(recordValue(usage, "prompt_tokens_details")?.cache_creation_tokens) ??
    finiteNumberOrNull(recordValue(usage, "input_tokens_details")?.cache_write_tokens) ??
    finiteNumberOrNull(recordValue(usage, "prompt_tokens_details")?.cache_write_tokens);
  const reasoningOutputTokens =
    finiteNumberOrNull(recordValue(usage, "output_tokens_details")?.reasoning_tokens) ??
    finiteNumberOrNull(recordValue(usage, "completion_tokens_details")?.reasoning_tokens);
  const totalTokens =
    finiteNumberOrNull(usage.total_tokens) ??
    sumNumbers(inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens);

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    reasoningOutputTokens,
    totalTokens,
    inputCostUsd: numericCost(usage, "input"),
    outputCostUsd: numericCost(usage, "output"),
    totalCostUsd: recordValue(usage, "cost")
      ? numericCost(recordValue(usage, "cost"), "total_tokens") ??
        numericCost(recordValue(usage, "cost"), "total")
      : null,
  };
}

export function anthropicUsageMetrics(payload: unknown): GenAiUsageMetrics | null {
  const usage = usageRecord(payload);
  if (!usage) {
    return null;
  }
  const inputTokens = finiteNumberOrNull(usage.input_tokens);
  const outputTokens = finiteNumberOrNull(usage.output_tokens);
  const cachedInputTokens = finiteNumberOrNull(usage.cache_read_input_tokens);
  const cacheWriteInputTokens = finiteNumberOrNull(
    usage.cache_creation_input_tokens,
  );
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    reasoningOutputTokens: null,
    totalTokens:
      sumNumbers(inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens),
    inputCostUsd: numericCost(usage, "input"),
    outputCostUsd: numericCost(usage, "output"),
    totalCostUsd: recordValue(usage, "cost")
      ? numericCost(recordValue(usage, "cost"), "total_tokens") ??
        numericCost(recordValue(usage, "cost"), "total")
      : null,
  };
}
