// Turns a failed pipeline result into a short message a reviewer can act on.
// Used by app/api/generate/route.ts; the raw error stays in the server log.

import { MISSING_KEY_MESSAGE, TIMED_OUT_MESSAGE } from "./llm";
import type { DiagramResult } from "./types";

// OpenRouter's 402 reasons that mean the money is gone, not just busy for a moment.
const BUDGET_USED_UP_SOURCES = ["openrouter_key_limit", "openrouter_credits"];

export function friendlyErrorMessage(result: DiagramResult): string {
  const status = result.errorStatus;
  const error = result.error ?? "Unknown error";

  // Status 0 = we never got an HTTP response (see LlmError in lib/llm.ts).
  if (error === MISSING_KEY_MESSAGE) return "Server is missing its API key.";
  if (error === TIMED_OUT_MESSAGE) return "The model took too long to respond.";
  if (status === 0) return "Could not reach the model provider. Try again shortly.";

  if (status === 429) return "Rate limit hit. Wait a minute and try again.";
  if (status === 502 || status === 503) return "The model provider is overloaded or down. Try again shortly.";
  if (status === 402) {
    const isBudgetUsedUp = BUDGET_USED_UP_SOURCES.includes(result.errorLimitSource ?? "");
    return isBudgetUsedUp
      ? "The live demo budget is used up. The 5 saved results above are unaffected."
      : "The live demo budget is busy. Try again in a minute.";
  }
  if (status === 401 || status === 403) return "The server's API key was rejected by OpenRouter.";
  if (status === 200) return "The model returned no usable reply. Try again.";

  // Anything else (e.g. 400 for a wrong model id): OpenRouter's own message is the clearest
  // explanation, and it never contains the key.
  return `Model request failed: ${error}`;
}
