// Pulls the <svg>…</svg> block out of the model's reply. Called by the pipeline before the checks.
// Models often wrap the SVG in ```svg fences or add a sentence before/after it.

const CODE_FENCE = /```[a-z]*\s*/gi;

export function extractSvg(modelText: string): string | null {
  const withoutFences = modelText.replace(CODE_FENCE, "");
  const start = withoutFences.indexOf("<svg");
  const closingTag = "</svg>";
  const end = withoutFences.lastIndexOf(closingTag);

  if (start === -1 || end === -1 || end < start) return null;
  return withoutFences.slice(start, end + closingTag.length);
}
