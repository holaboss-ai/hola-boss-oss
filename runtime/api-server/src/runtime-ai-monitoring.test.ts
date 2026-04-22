import assert from "node:assert/strict";
import test from "node:test";

import {
  anthropicUsageMetrics,
  createAiOnlyTracesSampler,
  openAiCompatibleUsageMetrics,
} from "./runtime-ai-monitoring.js";

test("openAiCompatibleUsageMetrics parses cached and reasoning token details", () => {
  assert.deepEqual(
    openAiCompatibleUsageMetrics({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 40,
        total_tokens: 160,
        prompt_tokens_details: {
          cached_tokens: 80,
          cache_creation_tokens: 12,
        },
        completion_tokens_details: {
          reasoning_tokens: 6,
        },
      },
    }),
    {
      inputTokens: 120,
      outputTokens: 40,
      cachedInputTokens: 80,
      cacheWriteInputTokens: 12,
      reasoningOutputTokens: 6,
      totalTokens: 160,
      inputCostUsd: null,
      outputCostUsd: null,
      totalCostUsd: null,
    },
  );
});

test("anthropicUsageMetrics parses cache read and write tokens", () => {
  assert.deepEqual(
    anthropicUsageMetrics({
      usage: {
        input_tokens: 50,
        output_tokens: 15,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 4,
      },
    }),
    {
      inputTokens: 50,
      outputTokens: 15,
      cachedInputTokens: 30,
      cacheWriteInputTokens: 4,
      reasoningOutputTokens: null,
      totalTokens: 99,
      inputCostUsd: null,
      outputCostUsd: null,
      totalCostUsd: null,
    },
  );
});

test("createAiOnlyTracesSampler samples only explicit AI spans", () => {
  const sampler = createAiOnlyTracesSampler();

  assert.equal(
    sampler({
      name: "chat gpt-5.4",
      attributes: { "holaboss.ai_span": true },
    }),
    1,
  );
  assert.equal(
    sampler({
      name: "GET /health",
      attributes: {},
      inheritOrSampleWith(rate) {
        return rate;
      },
    }),
    0,
  );
});
