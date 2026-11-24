// Generates one diagram end to end: ask the model, extract the SVG, run the checks, retry once
// with the failure reasons, then total up tokens and cost. Called by scripts/generate.ts and the
// API route, so the live Generate button runs exactly the code that produced results.json.

import { runChecks } from "./checks";
import { MAX_CHECK_RETRIES, MODEL } from "./config";
import { estimateCostUsd } from "./cost";
import { extractSvg } from "./extractSvg";
import { callLlm, LlmError, type LlmResponse } from "./llm";
import { buildFirstAttempt, buildRetryConversation, SYSTEM_PROMPT } from "./prompt";
import type { AttemptLog, CheckResult, Concept, DiagramResult } from "./types";

// Tests pass a fake model call here so the pipeline runs without the network.
export interface PipelineDeps {
  callLlmFn?: typeof callLlm;
}

// Everything we keep from one model call.
interface Attempt {
  log: AttemptLog;
  reply: string;
  svg: string | null;
  checks: CheckResult[];
  reasoningTokens: number;
  actualCostUsd: number | null;
}

// Never throws for API failures: the caller always gets a result, with status "error" if needed.
export async function runPipeline(concept: Concept, deps: PipelineDeps = {}): Promise<DiagramResult> {
  const callLlmFn = deps.callLlmFn ?? callLlm;
  const startedAtMs = Date.now();
  const attempts: Attempt[] = [];
  let failure: unknown = null;

  try {
    let messages = buildFirstAttempt(concept);
    for (let attemptNumber = 1; attemptNumber <= 1 + MAX_CHECK_RETRIES; attemptNumber++) {
      const response = await callLlmFn({ systemPrompt: SYSTEM_PROMPT, messages });
      const attempt = checkReply(attemptNumber, response, concept);
      attempts.push(attempt);
      logAttempt(concept, attempt);

      if (attempt.log.failedChecks.length === 0) break;
      messages = buildRetryConversation(concept, attempt.reply, attempt.checks);
    }
  } catch (error) {
    failure = error;
  }

  const result = buildResult(concept, attempts, failure, Date.now() - startedAtMs);
  logSummary(result);
  return result;
}

// Turns one model reply into an Attempt: extract the SVG and run every check on it.
function checkReply(attemptNumber: number, response: LlmResponse, concept: Concept): Attempt {
  const svg = extractSvg(response.text);
  const checks = runChecks(svg, concept);
  return {
    log: {
      attempt: attemptNumber,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      apiRetries: response.apiRetries,
      failedChecks: checks.filter((check) => !check.passed).map((check) => check.id),
    },
    reply: response.text,
    svg,
    checks,
    reasoningTokens: response.reasoningTokens,
    actualCostUsd: response.actualCostUsd,
  };
}

// Sums every attempt and decides the status. The last attempt's SVG and checks are shown,
// even when they failed, so reviewers can see what the model actually produced.
function buildResult(
  concept: Concept,
  attempts: Attempt[],
  failure: unknown,
  durationMs: number,
): DiagramResult {
  const last = attempts.at(-1);
  const inputTokens = sum(attempts.map((attempt) => attempt.log.inputTokens));
  const outputTokens = sum(attempts.map((attempt) => attempt.log.outputTokens));
  const passed = last !== undefined && last.log.failedChecks.length === 0;

  const result: DiagramResult = {
    conceptId: concept.id,
    concept: concept.name,
    subject: concept.subject,
    model: MODEL,
    status: failure !== null ? "error" : passed ? "pass" : "fail",
    svg: last?.svg ?? null,
    checks: last?.checks ?? [],
    retries: Math.max(attempts.length - 1, 0),
    apiRetries: sum(attempts.map((attempt) => attempt.log.apiRetries)),
    inputTokens,
    outputTokens,
    reasoningTokens: sum(attempts.map((attempt) => attempt.reasoningTokens)),
    costUsd: estimateCostUsd(inputTokens, outputTokens),
    actualCostUsd: sumActualCost(attempts),
    durationMs,
    generatedAt: new Date().toISOString(),
    attempts: attempts.map((attempt) => attempt.log),
  };

  if (failure !== null) addError(result, failure);
  return result;
}

// Keeps what the API route needs to pick a friendly message (status and 402 reason).
function addError(result: DiagramResult, failure: unknown): void {
  result.error = failure instanceof Error ? failure.message : String(failure);
  if (failure instanceof LlmError) {
    result.errorStatus = failure.status;
    result.errorLimitSource = failure.limitSource;
  }
}

// A partial total would look like the real bill, so if any attempt lacks OpenRouter's cost
// we report null rather than an undercount.
function sumActualCost(attempts: Attempt[]): number | null {
  if (attempts.length === 0) return null;
  const costs = attempts.map((attempt) => attempt.actualCostUsd);
  if (costs.some((cost) => cost === null)) return null;
  return sum(costs as number[]);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// Checks as { parse: true, bounds: false, ... } so a log line shows them at a glance.
function checksSummary(checks: CheckResult[]): Record<string, boolean> {
  return Object.fromEntries(checks.map((check) => [check.id, check.passed]));
}

// One JSON line per model call. Never the key, never the full SVG (too big for a log line).
function logAttempt(concept: Concept, attempt: Attempt): void {
  console.log(
    JSON.stringify({
      event: "attempt",
      concept: concept.id,
      model: MODEL,
      attempt: attempt.log.attempt,
      inputTokens: attempt.log.inputTokens,
      outputTokens: attempt.log.outputTokens,
      costUsd: estimateCostUsd(attempt.log.inputTokens, attempt.log.outputTokens),
      actualCostUsd: attempt.actualCostUsd,
      apiRetries: attempt.log.apiRetries,
      checks: checksSummary(attempt.checks),
    }),
  );
}

function logSummary(result: DiagramResult): void {
  console.log(
    JSON.stringify({
      event: "summary",
      concept: result.conceptId,
      model: result.model,
      status: result.status,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      actualCostUsd: result.actualCostUsd,
      retries: result.retries,
      apiRetries: result.apiRetries,
      durationMs: result.durationMs,
      checks: checksSummary(result.checks),
      error: result.error,
    }),
  );
}
