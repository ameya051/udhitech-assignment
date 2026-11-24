// Check 4: the SVG animates, via a SMIL element or a CSS @keyframes rule that something actually uses.

import type { Document } from "@xmldom/xmldom";
import type { SvgCheck } from "../types";
import { SMIL_ELEMENTS, styleSheetText } from "./dom";

const KEYFRAMES_PATTERN = /@(?:-webkit-)?keyframes\s+([\w-]+)/g;
const ANIMATION_DECLARATION_PATTERN = /animation(?:-name)?\s*:\s*([^;}]+)/g;

export const animationCheck: SvgCheck = {
  id: "animation",
  name: "Animated",
  run: ({ doc }) => {
    const smilCounts = SMIL_ELEMENTS.map((tag) => ({ tag, count: doc.getElementsByTagName(tag).length })).filter(
      ({ count }) => count > 0,
    );
    if (smilCounts.length > 0) {
      return { passed: true, detail: `SMIL: ${smilCounts.map(({ tag, count }) => `${count} <${tag}>`).join(", ")}` };
    }

    const usedKeyframes = findUsedKeyframes(doc);
    if (usedKeyframes.length > 0) {
      return { passed: true, detail: `CSS @keyframes in use: ${usedKeyframes.join(", ")}` };
    }

    return { passed: false, detail: "No SMIL animation elements and no CSS @keyframes in use" };
  },
};

// A @keyframes block only animates something if an animation rule names it,
// either in a <style> block or in an element's inline style attribute.
function findUsedKeyframes(doc: Document): string[] {
  const styleText = styleSheetText(doc);
  const keyframeNames = Array.from(styleText.matchAll(KEYFRAMES_PATTERN), (match) => match[1]);
  if (keyframeNames.length === 0) return [];

  const inlineStyles = Array.from(doc.getElementsByTagName("*"))
    .map((element) => element.getAttribute("style") ?? "")
    .join(";");
  const referencedNames = new Set(
    Array.from(`${styleText}\n${inlineStyles}`.matchAll(ANIMATION_DECLARATION_PATTERN)).flatMap((match) =>
      match[1].split(/[\s,]+/),
    ),
  );
  return keyframeNames.filter((name) => referencedNames.has(name));
}
