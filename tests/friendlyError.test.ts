// Tests for lib/friendlyError.ts: what a reviewer sees when live Generate fails.

import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "../lib/friendlyError";
import { MISSING_KEY_MESSAGE, TIMED_OUT_MESSAGE } from "../lib/llm";
import type { DiagramResult } from "../lib/types";

function errorResult(error: string, errorStatus?: number, errorLimitSource?: string): DiagramResult {
  return {
    conceptId: "pythagoras",
    concept: "Pythagoras' theorem",
    subject: "Maths",
    model: "anthropic/claude-sonnet-5.5",
    status: "error",
    svg: null,
    checks: [],
    retries: 0,
    apiRetries: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    actualCostUsd: null,
    durationMs: 10,
    generatedAt: "2026-11-24T00:00:00.000Z",
    attempts: [],
    error,
    errorStatus,
    errorLimitSource,
  };
}

describe("friendlyErrorMessage", () => {
  it("says the demo budget is used up for an exhausted key limit or credits", () => {
    const budgetMessage = "The live demo budget is used up. The 5 saved results above are unaffected.";
    expect(friendlyErrorMessage(errorResult("OpenRouter error 402: limit", 402, "openrouter_key_limit"))).toBe(
      budgetMessage,
    );
    expect(friendlyErrorMessage(errorResult("OpenRouter error 402: credits", 402, "openrouter_credits"))).toBe(
      budgetMessage,
    );
  });

  it("maps rate limits and provider outages", () => {
    expect(friendlyErrorMessage(errorResult("OpenRouter error 429: slow down", 429))).toBe(
      "Rate limit hit. Wait a minute and try again.",
    );
    expect(friendlyErrorMessage(errorResult("OpenRouter error 503: busy", 503))).toBe(
      "The model provider is overloaded or down. Try again shortly.",
    );
  });

  it("hides the env var name when the key is missing, and explains timeouts", () => {
    expect(friendlyErrorMessage(errorResult(MISSING_KEY_MESSAGE, 0))).toBe("Server is missing its API key.");
    expect(friendlyErrorMessage(errorResult(TIMED_OUT_MESSAGE, 0))).toBe("The model took too long to respond.");
  });

  it("passes OpenRouter's message through for a wrong model id", () => {
    const error = "OpenRouter error 400: anthropic/does-not-exist is not a valid model ID";
    expect(friendlyErrorMessage(errorResult(error, 400))).toBe(`Model request failed: ${error}`);
  });
});
