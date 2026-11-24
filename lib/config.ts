// Every tunable number in one place, each with the reason for its value.
// Changing the model, prices, retries or timeouts should only need an edit here.

// OpenRouter model id. Override with LLM_MODEL in .env.local or on Vercel.
export const MODEL = process.env.LLM_MODEL ?? "anthropic/claude-sonnet-5.5";

// List prices for Claude Sonnet 5.5 on OpenRouter (USD per 1M tokens), checked 2026-11-24.
// Reasoning tokens bill as output. The estimate is cross-checked against OpenRouter's usage.cost.
export const PRICE_PER_M_INPUT_USD = 2.0;
export const PRICE_PER_M_OUTPUT_USD = 10.0;

// Room for a detailed SVG (usually 2-4k tokens) plus low-effort reasoning.
export const MAX_OUTPUT_TOKENS = 8192;

// Drawing an SVG doesn't need deep thinking; low effort keeps each call fast and cheap.
export const REASONING_EFFORT = "low";

// Brief: "If a check fails, retry once".
export const MAX_CHECK_RETRIES = 1;

// Brief: "On a 429 or 503 error, wait and try again, up to 3 times".
export const MAX_API_RETRIES = 3;

// Backoff when the server sends no Retry-After header: 2s, 4s, 8s, never more than 20s.
export const BASE_BACKOFF_MS = 2000;
export const MAX_BACKOFF_MS = 20000;

// Random extra wait so parallel clients don't all retry at the same moment.
export const MAX_JITTER_MS = 500;

// One model call. Stays under the API route's 60s limit, leaving time for the response.
export const REQUEST_TIMEOUT_MS = 45000;

// viewBox units of slack in the bounds check, so a stroke touching the edge isn't a failure.
export const BOUNDS_TOLERANCE = 2;

// Bounds check lists at most this many offenders, so the retry prompt stays short and focused.
export const MAX_REPORTED_OFFENDERS = 5;

// Text has no real font metrics on the server, so its box is estimated from the font size.
// 0.6em per character is a little wider than most sans-serif fonts, so the estimate errs safe.
export const TEXT_CHAR_WIDTH_EM = 0.6;
// Glyphs sit mostly above the baseline: ascent ~0.8em above y, descent ~0.2em below.
export const TEXT_ASCENT_EM = 0.8;
export const TEXT_DESCENT_EM = 0.2;
// The SVG/CSS default when no font-size is set anywhere up the tree.
export const DEFAULT_FONT_SIZE = 16;

// Brief: "at least 3 text labels".
export const MIN_TEXT_LABELS = 3;
