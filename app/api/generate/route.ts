// POST /api/generate { conceptId } → runs the same runPipeline() that wrote results.json, for one
// concept, and returns the result as JSON. Called by the Generate button (lib/requestGeneration.ts).
// Every path returns JSON, never an HTML error page, so the page can always show a message.

import { findConcept } from "@/lib/concepts";
import { friendlyErrorMessage } from "@/lib/friendlyError";
import { runPipeline } from "@/lib/pipeline";
import { allowRequest } from "@/lib/rateLimit";
import type { GenerateResponse } from "@/lib/types";

// The pipeline uses Node APIs (@xmldom/xmldom, process.env).
export const runtime = "nodejs";
// Enough for one or two model calls (saved runs took 5-28s). Must be a literal: Next reads it at build time.
export const maxDuration = 60;
// Every request is a fresh generation; never cache.
export const dynamic = "force-dynamic";

// IP → recent request times. Lives as long as this server instance (see lib/rateLimit.ts).
const recentRequests = new Map<string, number[]>();

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply(400, { ok: false, error: 'Request body must be JSON like {"conceptId": "pythagoras"}' });
    }

    // Only a known id reaches the pipeline, so raw user input never goes into the prompt.
    const conceptId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).conceptId : undefined;
    const concept = typeof conceptId === "string" ? findConcept(conceptId) : undefined;
    if (concept === undefined) {
      return reply(400, { ok: false, error: "Unknown concept" });
    }

    // Checked after validation, so malformed requests don't use up a visitor's tries.
    if (!allowRequest(recentRequests, clientIp(request), Date.now())) {
      return reply(429, { ok: false, error: "Too many live generations from your network. Try again in a few minutes." });
    }

    const result = await runPipeline(concept);
    if (result.status !== "error") {
      return reply(200, { ok: true, result });
    }

    // The raw error is already in the pipeline's server log; the browser gets the friendly version.
    const error = friendlyErrorMessage(result);
    return reply(502, { ok: false, error, result: { ...result, error } });
  } catch (error) {
    console.error("Unexpected error in /api/generate", error);
    return reply(500, { ok: false, error: "Unexpected server error. Try again." });
  }
}

function reply(status: number, body: GenerateResponse): Response {
  return Response.json(body, { status });
}

// Vercel puts the visitor's IP first in x-forwarded-for. Locally there is often none, so all
// local requests share one "unknown" bucket.
function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || "unknown";
}
