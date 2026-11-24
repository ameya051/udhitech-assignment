// Tests for lib/requestGeneration.ts: every server answer, including broken ones, becomes
// { result?, error? } instead of crashing the page. A fake fetch stands in for the network.

import { describe, expect, it, vi } from "vitest";
import { requestGeneration } from "../lib/requestGeneration";

const partialResult = { conceptId: "pythagoras", checks: [], svg: "<svg/>", status: "error" };

function fakeFetch(status: number, bodyText: string) {
  return vi.fn<typeof fetch>(async () => new Response(bodyText, { status }));
}

describe("requestGeneration", () => {
  it("returns the result on success and posts the concept id", async () => {
    const fetchFn = fakeFetch(200, JSON.stringify({ ok: true, result: { ...partialResult, status: "pass" } }));
    const outcome = await requestGeneration("pythagoras", fetchFn);

    expect(outcome.error).toBeUndefined();
    expect(outcome.result?.status).toBe("pass");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/generate");
    expect(init?.body).toBe(JSON.stringify({ conceptId: "pythagoras" }));
  });

  it("returns the error and the partial result from an error response", async () => {
    const body = JSON.stringify({ ok: false, error: "The model took too long to respond.", result: partialResult });
    const outcome = await requestGeneration("pythagoras", fakeFetch(502, body));

    expect(outcome.error).toBe("The model took too long to respond.");
    expect(outcome.result?.svg).toBe("<svg/>");
  });

  it("handles an HTML error page (e.g. Vercel's 504) without throwing", async () => {
    const outcome = await requestGeneration("pythagoras", fakeFetch(504, "<html>Gateway Timeout</html>"));

    expect(outcome).toEqual({ error: "Request failed: server returned HTTP 504 (not JSON)" });
  });

  it("handles a network failure", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const outcome = await requestGeneration("pythagoras", fetchFn);

    expect(outcome).toEqual({ error: "Request failed: Failed to fetch" });
  });
});
