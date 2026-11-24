// The results table: one row per concept. Rendered by app/page.tsx with the saved results.

import type { DiagramResult } from "@/lib/types";
import DiagramRow, { type CheckColumn } from "./DiagramRow";

interface DiagramTableProps {
  initialResults: DiagramResult[];
}

const HEADER_CELL = "border border-gray-300 bg-gray-100 p-2 text-left align-top font-semibold";

export default function DiagramTable({ initialResults }: DiagramTableProps) {
  const checkColumns = findCheckColumns(initialResults);

  return (
    // Wide table: scroll sideways on small screens instead of squashing the diagrams.
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className={HEADER_CELL}>Concept</th>
            <th className={HEADER_CELL}>Diagram</th>
            {checkColumns.map((column) => (
              <th key={column.id} className={HEADER_CELL}>
                {column.name}
              </th>
            ))}
            <th className={HEADER_CELL}>Cost (USD)</th>
            <th className={HEADER_CELL}>Retries</th>
          </tr>
        </thead>
        <tbody>
          {initialResults.map((result) => (
            <DiagramRow key={result.conceptId} result={result} checkColumns={checkColumns} />
          ))}
        </tbody>
      </table>
    </div>
  );
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
