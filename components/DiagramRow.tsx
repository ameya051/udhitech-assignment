// One table row: concept, diagram, one cell per check, cost and retries. Used by DiagramTable.
// To add a column: add a <td> here and a matching <th> in DiagramTable.

import type { CheckResult, DiagramResult } from "@/lib/types";
import SvgPreview from "./SvgPreview";

export interface CheckColumn {
  id: CheckResult["id"];
  name: string;
}

interface DiagramRowProps {
  result: DiagramResult;
  checkColumns: CheckColumn[];
}

// Shared cell style, so every column lines up the same way.
const CELL = "border border-gray-300 p-2 align-top";
const SMALL = "text-xs text-gray-500";

export default function DiagramRow({ result, checkColumns }: DiagramRowProps) {
  const statusColour = result.status === "pass" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";

  return (
    <tr>
      <td className={CELL}>
        <div className="font-semibold">{result.concept}</div>
        <div className={SMALL}>{result.subject}</div>
        <div className={`mt-1 inline-block rounded px-1.5 text-xs font-semibold uppercase ${statusColour}`}>
          {result.status}
        </div>
        {result.error && <div className="mt-1 text-xs text-red-800">{result.error}</div>}
      </td>
      <td className={CELL}>
        <SvgPreview svg={result.svg} conceptName={result.concept} />
        {result.svg !== null && (
          <details>
            <summary className="mt-1 cursor-pointer text-xs text-blue-600">View SVG source</summary>
            <pre className="max-h-60 max-w-[320px] overflow-auto bg-gray-50 p-2 text-[11px] break-all whitespace-pre-wrap">
              {result.svg}
            </pre>
          </details>
        )}
      </td>
      {checkColumns.map((column) => (
        <CheckCell key={column.id} check={result.checks.find((check) => check.id === column.id)} />
      ))}
      <td className={CELL}>
        <CostCell result={result} />
      </td>
      <td className={CELL}>
        <div>{result.retries}</div>
        {result.apiRetries > 0 && <div className={SMALL}>API retries: {result.apiRetries}</div>}
      </td>
    </tr>
  );
}

// `check` is undefined when the row has no result for this check (e.g. the API call failed).
function CheckCell({ check }: { check: CheckResult | undefined }) {
  const checkCell = `${CELL} min-w-20 max-w-48 text-center`;

  if (check === undefined) {
    return <td className={checkCell}>-</td>;
  }

  // The detail is in the tooltip for desktop, and also printed for failures so it's visible on mobile.
  return (
    <td className={checkCell} title={check.detail}>
      <span className={`text-xl ${check.passed ? "text-green-600" : "text-red-600"}`}>
        {check.passed ? "✓" : "✗"}
      </span>
      {!check.passed && <div className={`${SMALL} text-left`}>{check.detail}</div>}
    </td>
  );
}

function CostCell({ result }: { result: DiagramResult }) {
  return (
    <>
      <div>${result.costUsd.toFixed(6)}</div>
      <div className={SMALL}>(estimated)</div>
      {result.actualCostUsd !== null && (
        <div className={SMALL}>OpenRouter: ${result.actualCostUsd.toFixed(4)}</div>
      )}
      <div className={SMALL}>
        {formatCount(result.inputTokens)} in / {formatCount(result.outputTokens)} out tokens
      </div>
      <div className={SMALL}>{result.model}</div>
    </>
  );
}

// Fixed locale so the server and every browser print the same digits.
function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}
