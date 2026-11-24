// Tests for lib/llm.ts. A fake fetch returns scripted responses and a fake sleep records
// the delays, so nothing touches the network and no test really waits.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { callLlm, LlmError } from "../lib/llm";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function okBody(text: string) {
  return {
    choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 3000,
      completion_tokens_details: { reasoning_tokens: 400 },
      cost: 0.0324,
    },
  };
}

function errorBody(message: string, limitSource?: string) {
  return { error: { code: 0, message, metadata: limitSource ? { limit_source: limitSource } : {} } };
}

// Returns each scripted response in order, one per call.
function fakeFetch(responses: Response[]) {
  return vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("fake fetch called more times than scripted");
    return next;
  });
}

const fakeSleep = () => vi.fn(async () => {});

const args = {
  systemPrompt: "You draw SVGs.",
  messages: [{ role: "user" as const, content: "Draw a circle." }],
};

describe("callLlm", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("retries a 429 then succeeds, and parses tokens and cost", async () => {
    const fetchFn = fakeFetch([jsonResponse(429, errorBody("Rate limited")), jsonResponse(200, okBody("<svg/>"))]);
    const sleepFn = fakeSleep();

    const result = await callLlm(args, { fetchFn, sleepFn });

    expect(result).toEqual({
      text: "<svg/>",
      inputTokens: 1200,
      outputTokens: 3000,
      reasoningTokens: 400,
      actualCostUsd: 0.0324,
      apiRetries: 1,
    });
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it("sends the key as a Bearer header and the system prompt first", async () => {
    const fetchFn = fakeFetch([jsonResponse(200, okBody("<svg/>"))]);

    await callLlm(args, { fetchFn, sleepFn: fakeSleep() });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.messages[0]).toEqual({ role: "system", content: "You draw SVGs." });
    expect(sentBody.messages[1]).toEqual({ role: "user", content: "Draw a circle." });
  });

  it("gives up after 3 retries when every attempt is a 503", async () => {
    const fetchFn = fakeFetch([1, 2, 3, 4].map(() => jsonResponse(503, errorBody("Overloaded"))));
    const sleepFn = fakeSleep();

    const error = await callLlm(args, { fetchFn, sleepFn }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(503);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(sleepFn).toHaveBeenCalledTimes(3);
  });

  it("fails fast on a 400 without retrying", async () => {
    const fetchFn = fakeFetch([jsonResponse(400, errorBody("Bad request"))]);
    const sleepFn = fakeSleep();

    await expect(callLlm(args, { fetchFn, sleepFn })).rejects.toThrow("OpenRouter error 400: Bad request");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("waits for the Retry-After header when the server sends one", async () => {
    const fetchFn = fakeFetch([
      jsonResponse(429, errorBody("Rate limited"), { "Retry-After": "7" }),
      jsonResponse(200, okBody("<svg/>")),
    ]);
    const sleepFn = fakeSleep();

    await callLlm(args, { fetchFn, sleepFn });

    const delayMs = (sleepFn.mock.calls[0] as unknown as [number])[0];
    expect(delayMs).toBeGreaterThanOrEqual(7000);
    expect(delayMs).toBeLessThanOrEqual(7500);
  });

  it("fails fast when the key's $2 credit limit is used up (402)", async () => {
    const fetchFn = fakeFetch([jsonResponse(402, errorBody("Key limit exceeded", "openrouter_key_limit"))]);
    const sleepFn = fakeSleep();

    const error = await callLlm(args, { fetchFn, sleepFn }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(402);
    expect((error as LlmError).limitSource).toBe("openrouter_key_limit");
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("throws a clear error when the API key is missing, without calling fetch", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchFn = fakeFetch([]);

    await expect(callLlm(args, { fetchFn, sleepFn: fakeSleep() })).rejects.toThrow("OPENROUTER_API_KEY is not set");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("explains an empty reply caused by running out of output tokens", async () => {
    const body = okBody("");
    body.choices[0].finish_reason = "length";
    const fetchFn = fakeFetch([jsonResponse(200, body)]);

    await expect(callLlm(args, { fetchFn, sleepFn: fakeSleep() })).rejects.toThrow(
      "Model used its whole output budget",
    );
  });
});
