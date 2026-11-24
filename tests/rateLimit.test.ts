// Tests for lib/rateLimit.ts: the per-IP guard on live Generate.

import { describe, expect, it } from "vitest";
import { LIVE_GENERATE_MAX_REQUESTS, LIVE_GENERATE_WINDOW_MS } from "../lib/config";
import { allowRequest } from "../lib/rateLimit";

const startMs = 1_000_000;

function fillUp(requestLog: Map<string, number[]>, key: string): void {
  for (let i = 0; i < LIVE_GENERATE_MAX_REQUESTS; i++) {
    expect(allowRequest(requestLog, key, startMs + i)).toBe(true);
  }
}

describe("allowRequest", () => {
  it("allows the limit, then refuses the next request", () => {
    const requestLog = new Map<string, number[]>();
    fillUp(requestLog, "1.2.3.4");
    expect(allowRequest(requestLog, "1.2.3.4", startMs + 10)).toBe(false);
  });

  it("allows again once the window has passed", () => {
    const requestLog = new Map<string, number[]>();
    fillUp(requestLog, "1.2.3.4");
    const afterWindowMs = startMs + LIVE_GENERATE_MAX_REQUESTS + LIVE_GENERATE_WINDOW_MS;
    expect(allowRequest(requestLog, "1.2.3.4", afterWindowMs)).toBe(true);
  });

  it("counts each IP separately", () => {
    const requestLog = new Map<string, number[]>();
    fillUp(requestLog, "1.2.3.4");
    expect(allowRequest(requestLog, "5.6.7.8", startMs + 10)).toBe(true);
  });
});
