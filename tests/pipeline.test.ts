// Tests for lib/pipeline.ts and lib/prompt.ts. A fake callLlm returns scripted replies,
// so the real checks run on real SVG text but nothing touches the network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONCEPTS } from "../lib/concepts";
import { LlmError, type LlmResponse } from "../lib/llm";
import { runPipeline } from "../lib/pipeline";
import { buildRetryConversation } from "../lib/prompt";
import type { ChatMessage, CheckResult } from "../lib/types";

const concept = CONCEPTS[1]; // circle-parts
const goodSvg = readFileSync(join(__dirname, "fixtures", "good.svg"), "utf8");
const noAnimationSvg = readFileSync(join(__dirname, "fixtures", "no-animation.svg"), "utf8");

function reply(text: string, costUsd: number | null = 0.03): LlmResponse {
  return { text, inputTokens: 1000, outputTokens: 2500, reasoningTokens: 300, actualCostUsd: costUsd, apiRetries: 0 };
}

// Returns each scripted reply in order; an Error in the script is thrown instead.
function fakeLlm(script: Array<LlmResponse | Error>) {
  return vi.fn<(args: { systemPrompt: string; messages: ChatMessage[] }) => Promise<LlmResponse>>(async () => {
    const next = script.shift();
    if (!next) throw new Error("fake callLlm called more times than scripted");
    if (next instanceof Error) throw next;
    return next;
  });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {}); // keep test output clean
});

describe("runPipeline", () => {
  it("passes on the first attempt without retrying", async () => {
    const callLlmFn = fakeLlm([reply(goodSvg)]);
    const result = await runPipeline(concept, { callLlmFn });

    expect(result.status).toBe("pass");
    expect(result.retries).toBe(0);
    expect(callLlmFn).toHaveBeenCalledTimes(1);
    expect(result.svg).toContain("<svg");
    expect(result.costUsd).toBeCloseTo((1000 * 2 + 2500 * 10) / 1_000_000);
  });

  it("retries once with the failure reasons and sums both attempts", async () => {
    const callLlmFn = fakeLlm([reply(noAnimationSvg), reply(goodSvg)]);
    const result = await runPipeline(concept, { callLlmFn });

    expect(result.status).toBe("pass");
    expect(result.retries).toBe(1);
    expect(result.inputTokens).toBe(2000);
    expect(result.actualCostUsd).toBeCloseTo(0.06);
    expect(result.attempts.map((attempt) => attempt.failedChecks)).toEqual([["animation"], []]);

    const retryMessages = callLlmFn.mock.calls[1][0].messages;
    expect(retryMessages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(retryMessages[2].content).toContain("- animation:");
  });

  it("stops after one retry and keeps the last failing SVG", async () => {
    const callLlmFn = fakeLlm([reply("no svg here"), reply(noAnimationSvg)]);
    const result = await runPipeline(concept, { callLlmFn });

    expect(result.status).toBe("fail");
    expect(callLlmFn).toHaveBeenCalledTimes(2);
    expect(result.svg).toContain("<svg");
  });

  it("returns status error instead of throwing, keeping attempt 1's SVG", async () => {
    const keyLimit = new LlmError(402, "OpenRouter error 402: key limit", "openrouter_key_limit");
    const callLlmFn = fakeLlm([reply(noAnimationSvg), keyLimit]);
    const result = await runPipeline(concept, { callLlmFn });

    expect(result.status).toBe("error");
    expect(result.error).toContain("402");
    expect(result.errorStatus).toBe(402);
    expect(result.errorLimitSource).toBe("openrouter_key_limit");
    expect(result.svg).toContain("<svg");
    expect(result.inputTokens).toBe(1000);
  });

  it("reports actual cost as null when OpenRouter did not report it", async () => {
    const result = await runPipeline(concept, { callLlmFn: fakeLlm([reply(goodSvg, null)]) });
    expect(result.actualCostUsd).toBeNull();
  });
});

describe("buildRetryConversation", () => {
  const failedParse: CheckResult = { id: "parse", name: "Valid SVG", passed: false, detail: "Invalid XML: bad tag" };
  const skipped: CheckResult = { id: "bounds", name: "In viewBox", passed: false, detail: "Skipped: SVG could not be parsed" };

  it("sends only the parse error when parsing failed, not the skipped checks", () => {
    const messages = buildRetryConversation(concept, "<svg", [failedParse, skipped]);
    expect(messages[2].content).toContain("- parse: Invalid XML: bad tag");
    expect(messages[2].content).not.toContain("Skipped");
  });
});
