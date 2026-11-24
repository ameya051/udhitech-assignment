// One table row: concept, diagram, one cell per check, cost, retries, review and Generate.
// Used by DiagramTable. To add a column: add a <td> here and a matching <th> in DiagramTable.

import type { AttemptLog, CheckResult, DiagramResult } from "@/lib/types";
import GenerateControls from "./GenerateControls";
import ReviewControls from "./ReviewControls";
import SvgPreview from "./SvgPreview";

export interface CheckColumn {
  id: CheckResult["id"];
  name: string;
}

interface DiagramRowProps {
  result: DiagramResult;
  checkColumns: CheckColumn[];
  isLive: boolean; // `result` came from a live Generate, not results.json
  liveError: string | undefined; // the last live Generate for this row failed
  isGenerating: boolean; // this row is generating now
  isBusy: boolean; // any row is generating now
  onGenerate: () => void;
}

// Shared cell style, so every column lines up the same way.
const CELL = "border-b border-gray-200 p-2 align-top";
const SMALL = "text-xs text-gray-500";

export default function DiagramRow(props: DiagramRowProps) {
  const { result, checkColumns, isLive, liveError } = props;
  const statusColour = result.status === "pass" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
  // A live failure is already shown in the Generate cell's red box; don't repeat it here.
  const showError = result.error !== undefined && liveError === undefined;

  return (
    <tr className="hover:bg-gray-50">
      {/* Pinned so the concept name stays in view while the wide table scrolls sideways on a phone. */}
      <td className={`${CELL} sticky left-0 z-10 bg-white`}>
        <div className="font-semibold">{result.concept}</div>
        <div className={SMALL}>{result.subject}</div>
        <div className={`mt-1 inline-block rounded px-1.5 text-xs font-semibold uppercase ${statusColour}`}>
          {result.status}
        </div>
        {isLive && (
          <div className="mt-1 ml-1 inline-block rounded bg-blue-100 px-1.5 text-xs font-semibold text-blue-800">
            Live result
          </div>
        )}
        {showError && <div className="mt-1 max-w-40 text-xs text-red-800">{result.error}</div>}
      </td>
      <td className={`${CELL} min-w-[336px]`}>
        <SvgPreview svg={result.svg} conceptName={result.concept}>
          <details>
            <summary className="cursor-pointer text-blue-600 hover:underline">View source</summary>
            <pre className="mt-1 max-h-60 w-[260px] overflow-auto bg-gray-50 p-2 text-[11px] break-all whitespace-pre-wrap">
              {result.svg}
            </pre>
          </details>
        </SvgPreview>
      </td>
      {checkColumns.map((column) => (
        <CheckCell key={column.id} check={result.checks.find((check) => check.id === column.id)} />
      ))}
      <td className={CELL} title={`Model: ${result.model} · reasoning tokens: ${formatCount(result.reasoningTokens)}`}>
        <CostCell result={result} />
      </td>
      <td className={CELL}>
        <RetriesCell result={result} checkColumns={checkColumns} />
      </td>
      <td className={CELL}>
        <ReviewControls conceptId={result.conceptId} />
      </td>
      <td className={CELL}>
        <GenerateControls
          isGenerating={props.isGenerating}
          isDisabled={props.isBusy}
          error={liveError}
          onGenerate={props.onGenerate}
        />
      </td>
    </tr>
  );
}

// `check` is undefined when the row has no result for this check (e.g. the API call failed).
function CheckCell({ check }: { check: CheckResult | undefined }) {
  if (check === undefined) {
    return <td className={`${CELL} text-center text-gray-400`}>–</td>;
  }

  // Passes stay quiet (detail in the tooltip). Failures also print the detail, because that
  // is what a reviewer needs to read, and tooltips don't work on phones.
  if (check.passed) {
    return (
      <td className={`${CELL} text-center`} title={check.detail}>
        <span className="inline-block rounded-full bg-green-100 px-2 font-semibold text-green-700">✓</span>
      </td>
    );
  }
  return (
    <td className={`${CELL} max-w-44`} title={check.detail}>
      <span className="inline-block rounded-full bg-red-100 px-2 font-semibold text-red-700">✗</span>
      <div className="mt-1 text-xs text-red-700">{check.detail}</div>
    </td>
  );
}

function CostCell({ result }: { result: DiagramResult }) {
  return (
    <>
      <div>${result.costUsd.toFixed(6)}</div>
      {result.actualCostUsd !== null && (
        <div className={SMALL}>OpenRouter ${result.actualCostUsd.toFixed(4)}</div>
      )}
      <div className={`${SMALL} whitespace-nowrap`}>
        {formatCount(result.inputTokens)} in · {formatCount(result.outputTokens)} out
      </div>
    </>
  );
}

// The retry count, plus which checks caused each retry. Passing attempts aren't listed.
function RetriesCell({ result, checkColumns }: { result: DiagramResult; checkColumns: CheckColumn[] }) {
  const failedAttempts = result.attempts.filter((attempt) => attempt.failedChecks.length > 0);
  return (
    <>
      <div className="font-semibold">{result.retries}</div>
      {failedAttempts.map((attempt) => (
        <div key={attempt.attempt} className={`${SMALL} max-w-36`}>
          {describeFailedAttempt(attempt, checkColumns)}
        </div>
      ))}
      {result.apiRetries > 0 && <div className={SMALL}>API retries: {result.apiRetries}</div>}
    </>
  );
}

function describeFailedAttempt(attempt: AttemptLog, checkColumns: CheckColumn[]): string {
  const failedNames = attempt.failedChecks.map(
    (id) => checkColumns.find((column) => column.id === id)?.name ?? id,
  );
  return `Try ${attempt.attempt} failed: ${failedNames.join(", ")}`;
}

// Fixed locale so the server and every browser print the same digits.
function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}
