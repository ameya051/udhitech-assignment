// Per-IP limit for live Generate, used by app/api/generate/route.ts.
// Best-effort only: on Vercel each serverless instance has its own memory, so a determined
// visitor could get more. It protects the $2 key budget from casual over-clicking; it is not a
// security boundary (the $2 cap on the key itself is the hard limit).

import { LIVE_GENERATE_MAX_REQUESTS, LIVE_GENERATE_WINDOW_MS } from "./config";

// `requestLog` maps a key (the client IP) to the times of its recent requests. The caller owns
// the map, so this function has no hidden state and tests can pass a fresh one.
// Returns true (and records the request) if the key is still under the limit.
export function allowRequest(requestLog: Map<string, number[]>, key: string, nowMs: number): boolean {
  const windowStartMs = nowMs - LIVE_GENERATE_WINDOW_MS;
  const recentTimes = (requestLog.get(key) ?? []).filter((timeMs) => timeMs > windowStartMs);

  if (recentTimes.length >= LIVE_GENERATE_MAX_REQUESTS) {
    requestLog.set(key, recentTimes);
    return false;
  }

  recentTimes.push(nowMs);
  requestLog.set(key, recentTimes);
  return true;
}
