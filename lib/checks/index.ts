// Runs every check on one SVG. Called by the pipeline after each model response.
// To add a check: write a new SvgCheck in this folder, add its id to CheckId, and add it to CHECKS.

import type { CheckResult, Concept, SvgCheck } from "../types";
import { animationCheck } from "./animation";
import { boundsCheck } from "./bounds";
import { labelsCheck } from "./labels";
import { PARSE_CHECK_NAME, parseSvg } from "./parse";

// Run in this order after `parse`; the table shows one column per check in the same order.
export const CHECKS: SvgCheck[] = [boundsCheck, labelsCheck, animationCheck];

// `svgText` is null when the model's reply had no <svg> block at all (see extractSvg).
export function runChecks(svgText: string | null, concept: Concept): CheckResult[] {
  const parsed = parseSvg(svgText);
  const parseResult: CheckResult = { id: "parse", name: PARSE_CHECK_NAME, passed: parsed.doc !== null, detail: parsed.detail };

  // Every other check needs a parsed document, so without one they are reported as skipped.
  if (parsed.doc === null || svgText === null) {
    const skipped = CHECKS.map((check) => ({ id: check.id, name: check.name, passed: false, detail: "Skipped: SVG could not be parsed" }));
    return [parseResult, ...skipped];
  }

  const context = { doc: parsed.doc, svgText, concept };
  return [parseResult, ...CHECKS.map((check) => ({ id: check.id, name: check.name, ...check.run(context) }))];
}
