// Browser side of live Generate: POSTs to /api/generate and turns every outcome (good JSON,
// error JSON, an HTML error page, a network failure, a timeout) into { result?, error? }.
// Used by components/DiagramTable.tsx. Imports no server code, so it is safe in the bundle.

import { LIVE_GENERATE_CLIENT_TIMEOUT_MS } from "./config";
import type { ConceptId, DiagramResult } from "./types";

export interface GenerationOutcome {
  result?: DiagramResult; // present on success, and on failure when a partial result came back
  error?: string; // present on any failure
}

export async function requestGeneration(
  conceptId: ConceptId,
  fetchFn: typeof fetch = fetch,
): Promise<GenerationOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_GENERATE_CLIENT_TIMEOUT_MS);

  let status: number;
  let bodyText: string;
  try {
    const response = await fetchFn("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conceptId }),
      signal: controller.signal,
    });
    status = response.status;
    bodyText = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      return { error: "Request failed: no answer from the server in time. Try again." };
    }
    return { error: `Request failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }

  return parseBody(status, bodyText);
}

// Read as text first: a Vercel timeout returns an HTML 504 page, and calling res.json() on
// that would throw. A bad body must never crash the page.
function parseBody(status: number, bodyText: string): GenerationOutcome {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { error: `Request failed: server returned HTTP ${status} (not JSON)` };
  }

  const record = asRecord(body);
  const result = isDiagramResult(record.result) ? record.result : undefined;

  if (record.ok === true && result !== undefined) {
    return { result };
  }
  const error = typeof record.error === "string" ? record.error : `Request failed: HTTP ${status}`;
  return { error, result };
}

// A light shape check: enough that the row can render it without crashing.
function isDiagramResult(value: unknown): value is DiagramResult {
  const record = asRecord(value);
  return typeof record.conceptId === "string" && Array.isArray(record.checks);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
