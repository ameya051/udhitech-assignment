// Check 3: the SVG has a non-empty <title> and at least MIN_TEXT_LABELS non-empty <text> labels.

import type { Document } from "@xmldom/xmldom";
import { MIN_TEXT_LABELS } from "../config";
import type { SvgCheck } from "../types";

export const labelsCheck: SvgCheck = {
  id: "labels",
  name: "Title + labels",
  run: ({ doc }) => {
    const title = nonEmptyTexts(doc, "title")[0];
    const labels = nonEmptyTexts(doc, "text");
    const problems: string[] = [];

    // Any <title> counts; a direct child of <svg> is preferred but not required.
    if (!title) problems.push("Missing <title> (add a non-empty <title> as the first child of <svg>)");
    if (labels.length < MIN_TEXT_LABELS) {
      problems.push(`Found ${labels.length} non-empty <text> labels, need at least ${MIN_TEXT_LABELS}`);
    }

    if (problems.length > 0) return { passed: false, detail: problems.join("; ") };
    return { passed: true, detail: `Title "${title}", ${labels.length} text labels` };
  },
};

// Trimmed text of every <tagName>, dropping empty ones. textContent includes nested <tspan> text.
function nonEmptyTexts(doc: Document, tagName: string): string[] {
  return Array.from(doc.getElementsByTagName(tagName))
    .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0);
}
