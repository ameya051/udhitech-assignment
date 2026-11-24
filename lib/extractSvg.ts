// Pulls the <svg>…</svg> block out of the model's reply. Called by the pipeline before the checks.
// Models often wrap the SVG in ```svg fences or add a sentence before/after it.

const CODE_FENCE = /```[a-z]*\s*/gi;
const SVG_TAG = /<svg\b[^>]*>|<\/svg\s*>/gi;

// Returns the LAST complete top-level <svg> block. A model sometimes sends a draft, then
// "Wait, let me fix that", then a corrected SVG: the final one is its answer. Counting depth
// keeps a nested <svg> element inside its parent instead of ending the block early.
export function extractSvg(modelText: string): string | null {
  const text = modelText.replace(CODE_FENCE, "");
  let depth = 0;
  let blockStart = 0;
  let lastBlock: string | null = null;

  for (const match of text.matchAll(SVG_TAG)) {
    const tag = match[0];
    const tagEnd = match.index + tag.length;

    if (tag.startsWith("</")) {
      if (depth === 0) continue; // a stray closing tag with no opening one
      depth--;
      if (depth === 0) lastBlock = text.slice(blockStart, tagEnd);
    } else if (tag.endsWith("/>")) {
      if (depth === 0) lastBlock = text.slice(match.index, tagEnd); // empty <svg/> on its own
    } else {
      if (depth === 0) blockStart = match.index;
      depth++;
    }
  }
  return lastBlock;
}
