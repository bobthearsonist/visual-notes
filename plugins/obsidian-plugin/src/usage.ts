import type { VisualNotesUsage } from "./schema";

export interface ExtractionUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface ModelPricing {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5": {
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 5,
  },
  "claude-sonnet-4-6": {
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
  },
};

export function createExtractionUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
): ExtractionUsage {
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimateCostUsd(model, inputTokens, outputTokens),
  };
}

export function addExtractionUsage(
  existing: VisualNotesUsage | undefined,
  last: ExtractionUsage,
): VisualNotesUsage {
  const previous = existing?.cumulative;

  return {
    currency: "USD",
    last,
    cumulative: {
      extractions: (previous?.extractions ?? 0) + 1,
      inputTokens: (previous?.inputTokens ?? 0) + last.inputTokens,
      outputTokens: (previous?.outputTokens ?? 0) + last.outputTokens,
      totalTokens: (previous?.totalTokens ?? 0) + last.totalTokens,
      estimatedCostUsd: roundCurrency(
        (previous?.estimatedCostUsd ?? 0) + last.estimatedCostUsd,
      ),
    },
  };
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-haiku-4-5"];
  return roundCurrency(
    (inputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens +
      (outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens,
  );
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
