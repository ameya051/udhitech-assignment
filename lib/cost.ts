// Turns token counts into an estimated USD cost at list price. Called by the pipeline.

import { PRICE_PER_M_INPUT_USD, PRICE_PER_M_OUTPUT_USD } from "./config";

const TOKENS_PER_MILLION = 1_000_000;

// outputTokens already includes reasoning tokens, which bill at the output price.
export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  const inputCostUsd = (inputTokens * PRICE_PER_M_INPUT_USD) / TOKENS_PER_MILLION;
  const outputCostUsd = (outputTokens * PRICE_PER_M_OUTPUT_USD) / TOKENS_PER_MILLION;
  return inputCostUsd + outputCostUsd;
}
