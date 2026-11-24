// Runs the pipeline locally and writes results.json, which the page shows in Phase 8.
// Usage: `npm run generate` (all 5 concepts) or `npm run generate -- --only=photosynthesis`.
// --only always asks the model for a fresh diagram for that concept; the other saved rows are kept.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONCEPTS, findConcept } from "../lib/concepts";
import { PAUSE_BETWEEN_CONCEPTS_MS } from "../lib/config";
import { runPipeline } from "../lib/pipeline";
import type { Concept, DiagramResult, ResultsFile } from "../lib/types";

// npm runs scripts from the package root, so this is assignment/results.json.
const RESULTS_PATH = join(process.cwd(), "results.json");
const ONLY_FLAG = "--only=";
const COST_DECIMALS = 6;

async function main(): Promise<void> {
  const onlyConcept = readOnlyArg();
  const concepts = onlyConcept ? [onlyConcept] : CONCEPTS;
  // Read before calling the model, so a broken results.json fails fast without spending money.
  const existing = onlyConcept ? loadExistingResults() : [];

  const fresh: DiagramResult[] = [];
  for (const [index, concept] of concepts.entries()) {
    if (index > 0) await sleep(PAUSE_BETWEEN_CONCEPTS_MS);
    console.log(`Generating ${concept.id} (${index + 1}/${concepts.length})...`);
    fresh.push(await runPipeline(concept));
  }

  const file: ResultsFile = { generatedAt: new Date().toISOString(), results: mergeResults(existing, fresh) };
  writeFileSync(RESULTS_PATH, JSON.stringify(file, null, 2) + "\n");
  console.log(`Wrote ${RESULTS_PATH}`);
  printSummary(fresh);

  // The file is still written so passing results are kept; the exit code flags the problem.
  if (fresh.some((result) => result.status === "error")) process.exitCode = 1;
}

// Returns the concept named by --only=<id>, or null to run every concept. Throws on an unknown id.
function readOnlyArg(): Concept | null {
  const flag = process.argv.find((arg) => arg.startsWith(ONLY_FLAG));
  if (!flag) return null;

  const id = flag.slice(ONLY_FLAG.length);
  const concept = findConcept(id);
  if (!concept) {
    const validIds = CONCEPTS.map((known) => known.id).join(", ");
    throw new Error(`Unknown concept "${id}". Valid ids: ${validIds}`);
  }
  return concept;
}

// No file yet is fine (first run). A broken file is an error: silently overwriting it
// would throw away the saved results for the other concepts.
function loadExistingResults(): DiagramResult[] {
  if (!existsSync(RESULTS_PATH)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
    const results = (parsed as Partial<ResultsFile>).results;
    if (!Array.isArray(results)) throw new Error('missing "results" array');
    return results;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${RESULTS_PATH} (${reason}). Fix or delete it, then rerun.`);
  }
}

// Fresh results replace saved ones for the same concept; output follows the order in concepts.ts.
function mergeResults(existing: DiagramResult[], fresh: DiagramResult[]): DiagramResult[] {
  return CONCEPTS.map(
    (concept) =>
      fresh.find((result) => result.conceptId === concept.id) ??
      existing.find((result) => result.conceptId === concept.id),
  ).filter((result): result is DiagramResult => result !== undefined);
}

function printSummary(results: DiagramResult[]): void {
  console.table(
    results.map((result) => ({
      concept: result.conceptId,
      status: result.status,
      costUsd: result.costUsd.toFixed(COST_DECIMALS),
      retries: result.retries,
      apiRetries: result.apiRetries,
      error: result.error ?? "",
    })),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
