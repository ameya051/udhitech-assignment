// The only file that talks to the model. Sends one chat request to OpenRouter (Claude Sonnet 5.5),
// waits and retries on 429/503, and returns the text plus token counts and cost.
// Called by lib/pipeline.ts. The API key is read here and nowhere else.

import {
  BASE_BACKOFF_MS,
  MAX_API_RETRIES,
  MAX_BACKOFF_MS,
  MAX_JITTER_MS,
  MAX_OUTPUT_TOKENS,
  MODEL,
  REASONING_EFFORT,
  REQUEST_TIMEOUT_MS,
} from "./config";
import type { ChatMessage } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MS_PER_SECOND = 1000;

// OpenRouter sends this 402 when requests already in flight have used up the spending budget.
// It clears on its own, so it is worth retrying (unlike a 402 for an exhausted key limit).
const TEMPORARY_BUDGET_LIMIT = "openrouter_in_flight_budget";

// Status 0 means we never got an HTTP response (network error or timeout).
export class LlmError extends Error {
  status: number;
  limitSource?: string; // OpenRouter's reason for a 402, e.g. "openrouter_key_limit"
  retryAfterSeconds?: number; // from the Retry-After header, when the server sent one

  constructor(status: number, message: string, limitSource?: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.limitSource = limitSource;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number; // includes reasoning tokens
  reasoningTokens: number;
  actualCostUsd: number | null; // what OpenRouter says it charged; null if not reported
  apiRetries: number; // how many times we waited and retried
}

// Tests pass fakes here so they never hit the network or really wait.
export interface LlmDeps {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

export async function callLlm(
  args: { systemPrompt: string; messages: ChatMessage[] },
  deps: LlmDeps = {},
): Promise<LlmResponse> {
  const fetchFn = deps.fetchFn ?? fetch;
  const sleepFn = deps.sleepFn ?? sleep;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LlmError(0, "OPENROUTER_API_KEY is not set");
  }

  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: "system", content: args.systemPrompt }, ...args.messages],
    max_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: REASONING_EFFORT },
  });

  for (let attempt = 0; ; attempt++) {
    try {
      const json = await sendOnce(fetchFn, apiKey, body);
      return { ...parseSuccess(json), apiRetries: attempt };
    } catch (error) {
      if (!(error instanceof LlmError) || !isRetryable(error) || attempt >= MAX_API_RETRIES) {
        throw error;
      }
      const delayMs = retryDelayMs(attempt, error.retryAfterSeconds);
      console.log(
        JSON.stringify({ event: "llm_retry", status: error.status, attempt: attempt + 1, delayMs }),
      );
      await sleepFn(delayMs);
    }
  }
}

// One HTTP request. Returns the parsed JSON body on success, throws LlmError otherwise.
async function sendOnce(fetchFn: typeof fetch, apiKey: string, body: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchFn(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Science Diagram Maker", // labels our requests in the OpenRouter dashboard
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmError(0, `Request timed out after ${REQUEST_TIMEOUT_MS / MS_PER_SECOND}s`);
    }
    throw new LlmError(0, `Network error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }

  const json = await readJson(response);
  if (!response.ok) {
    throw errorFromBody(response.status, response.statusText, json, response.headers);
  }

  // OpenRouter can report a provider failure inside a 200 response.
  const choice = asRecord(asArray(asRecord(json).choices)[0]);
  if (choice.finish_reason === "error") {
    const embedded = asRecord(choice.error);
    const status = typeof embedded.code === "number" ? embedded.code : 502;
    throw errorFromBody(status, "Provider error", { error: embedded }, response.headers);
  }
  return json;
}

// A non-JSON body (e.g. an HTML error page from a proxy) becomes null instead of crashing.
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// OpenRouter errors look like { error: { message, metadata: { limit_source } } }.
function errorFromBody(status: number, fallbackMessage: string, json: unknown, headers: Headers): LlmError {
  const error = asRecord(asRecord(json).error);
  const metadata = asRecord(error.metadata);
  const message = typeof error.message === "string" ? error.message : fallbackMessage;
  const limitSource = typeof metadata.limit_source === "string" ? metadata.limit_source : undefined;
  const retryAfterSeconds = Number(headers.get("Retry-After"));

  return new LlmError(
    status,
    `OpenRouter error ${status}: ${message}`,
    limitSource,
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : undefined,
  );
}

// Brief: wait and retry on 429 and 503. Network errors and timeouts are also temporary.
// Anything else (bad request, bad key, exhausted $2 key limit, model down) will not fix itself.
function isRetryable(error: LlmError): boolean {
  if (error.status === 429 || error.status === 503 || error.status === 0) {
    return true;
  }
  return error.status === 402 && error.limitSource === TEMPORARY_BUDGET_LIMIT;
}

// Use the server's Retry-After when given; otherwise back off 2s, 4s, 8s (capped).
// The random jitter stops many clients from retrying at exactly the same moment.
function retryDelayMs(attempt: number, retryAfterSeconds: number | undefined): number {
  const baseMs =
    retryAfterSeconds !== undefined
      ? retryAfterSeconds * MS_PER_SECOND
      : Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return baseMs + Math.random() * MAX_JITTER_MS;
}

// Pulls the reply text and usage numbers out of a successful response.
function parseSuccess(json: unknown): Omit<LlmResponse, "apiRetries"> {
  const root = asRecord(json);
  const choice = asRecord(asArray(root.choices)[0]);
  const message = asRecord(choice.message);
  const text = typeof message.content === "string" ? message.content.trim() : "";

  if (!text && choice.finish_reason === "length") {
    throw new LlmError(200, "Model used its whole output budget (likely on reasoning) and returned no text");
  }
  if (!text) {
    throw new LlmError(200, "Model returned no text");
  }

  const usage = asRecord(root.usage);
  const completionDetails = asRecord(usage.completion_tokens_details);
  return {
    text,
    inputTokens: numberOrZero(usage.prompt_tokens),
    outputTokens: numberOrZero(usage.completion_tokens),
    reasoningTokens: numberOrZero(completionDetails.reasoning_tokens),
    actualCostUsd: typeof usage.cost === "number" ? usage.cost : null,
  };
}

// Small helpers for reading untyped JSON without `any`.
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
