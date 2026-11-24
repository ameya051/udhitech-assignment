"use client";

// The results table: a summary of the saved run, then one row per concept. Rendered by app/page.tsx.
// Client component because it holds the live Generate state: one run at a time across the table.

import { useState } from "react";
import { requestGeneration } from "@/lib/requestGeneration";
import type { ConceptId, DiagramResult } from "@/lib/types";
import DiagramRow, { type CheckColumn } from "./DiagramRow";

interface DiagramTableProps {
  initialResults: DiagramResult[];
}

interface RunSummary {
  passed: number;
  total: number;
  totalCostUsd: number;
  checkRetries: number;
  apiRetries: number;
  model: string | null; // every saved row uses the same model, so it's shown once here
}

const HEADER_CELL = "border-b border-gray-300 bg-gray-100 p-2 text-left align-top font-semibold";

export default function DiagramTable({ initialResults }: DiagramTableProps) {
  const [liveResults, setLiveResults] = useState<Partial<Record<ConceptId, DiagramResult>>>({});
  const [liveErrors, setLiveErrors] = useState<Partial<Record<ConceptId, string>>>({});
  // One shared flag: only one Generate at a time, which also protects the $2 key budget.
  const [busyConceptId, setBusyConceptId] = useState<ConceptId | null>(null);

  const checkColumns = findCheckColumns(initialResults);
  // Describes the saved run only; live results are extra and not part of results.json.
  const summary = summarise(initialResults);

  async function handleGenerate(conceptId: ConceptId) {
    if (busyConceptId !== null) return;
    setBusyConceptId(conceptId);
    setLiveErrors((errors) => ({ ...errors, [conceptId]: undefined }));

    try {
      const { result, error } = await requestGeneration(conceptId);
      // A failed call with no diagram would replace a good saved one with "No diagram",
      // so a partial result is only shown when it has an SVG to look at.
      if (result !== undefined && (error === undefined || result.svg !== null)) {
        setLiveResults((results) => ({ ...results, [conceptId]: result }));
      }
      if (error !== undefined) {
        setLiveErrors((errors) => ({ ...errors, [conceptId]: error }));
      }
    } finally {
      setBusyConceptId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Stat label="passed all checks" value={`${summary.passed} / ${summary.total}`} />
        <Stat label="total estimated cost" value={`$${summary.totalCostUsd.toFixed(4)}`} />
        <Stat label="check retries" value={String(summary.checkRetries)} />
        <Stat label="API retries (429/503)" value={String(summary.apiRetries)} />
        {summary.model !== null && <Stat label="model" value={summary.model} />}
      </div>
      <p className="text-xs text-gray-500">
        Hover a ✓ for what the check found · click a diagram to enlarge · reviews are saved in this browser ·
        Generate re-runs one row live (not saved to results.json).
      </p>

      {/* Wide table: scroll sideways on small screens instead of squashing the diagrams. */}
      <div className="overflow-x-auto rounded-lg border border-gray-300 shadow-sm">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              {/* Pinned like the concept cells below, so it stays above them while scrolling sideways. */}
              <th className={`${HEADER_CELL} sticky left-0 z-10`}>Concept</th>
              <th className={HEADER_CELL}>Diagram</th>
              {checkColumns.map((column) => (
                <th key={column.id} className={HEADER_CELL}>
                  {column.name}
                </th>
              ))}
              <th className={HEADER_CELL}>Est. cost (USD)</th>
              <th className={HEADER_CELL}>Retries</th>
              <th className={HEADER_CELL}>Review</th>
              <th className={HEADER_CELL}>Generate</th>
            </tr>
          </thead>
          <tbody>
            {initialResults.map((savedResult) => {
              const conceptId = savedResult.conceptId;
              const liveResult = liveResults[conceptId];
              return (
                <DiagramRow
                  key={conceptId}
                  result={liveResult ?? savedResult}
                  checkColumns={checkColumns}
                  isLive={liveResult !== undefined}
                  liveError={liveErrors[conceptId]}
                  isGenerating={busyConceptId === conceptId}
                  isBusy={busyConceptId !== null}
                  onGenerate={() => handleGenerate(conceptId)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function summarise(results: DiagramResult[]): RunSummary {
  return {
    passed: results.filter((result) => result.status === "pass").length,
    total: results.length,
    totalCostUsd: results.reduce((sum, result) => sum + result.costUsd, 0),
    checkRetries: results.reduce((sum, result) => sum + result.retries, 0),
    apiRetries: results.reduce((sum, result) => sum + result.apiRetries, 0),
    model: results[0]?.model ?? null,
  };
}

// Check columns come from the saved results rather than lib/checks, so the browser bundle
// never pulls in the server-side checks. Every row that ran checks has the same list,
// so the first one is enough; a new check shows up once results.json is regenerated.
function findCheckColumns(results: DiagramResult[]): CheckColumn[] {
  const resultWithChecks = results.find((result) => result.checks.length > 0);
  if (resultWithChecks === undefined) {
    return [];
  }
  return resultWithChecks.checks.map((check) => ({ id: check.id, name: check.name }));
}
