// Check 2: nothing drawn outside the viewBox.
// drawn.ts estimates each shape's box (with transforms); here we add where <animateMotion>
// can move it and compare the result with the viewBox.

import { BOUNDS_TOLERANCE } from "../config";
import type { SvgCheck } from "../types";
import { describeElement, drawnElements, listWithOverflow } from "./drawn";
import { addBoxes, type Box } from "./geometry";
import { readViewBox, type ViewBox } from "./parse";

export const boundsCheck: SvgCheck = {
  id: "bounds",
  name: "Inside viewBox",
  run: ({ doc }) => {
    const root = doc.documentElement;
    const viewBox = root ? readViewBox(root) : null;
    if (!root || !viewBox) return { passed: false, detail: "Skipped: no usable viewBox" };

    const drawn = drawnElements(root, viewBox);
    const offenders = drawn
      .map((item) => ({ item, overflow: describeOverflow(addBoxes(item.ownBox, item.motion.offsets), viewBox) }))
      .filter(({ overflow }) => overflow !== null);

    if (offenders.length === 0) {
      return { passed: true, detail: `All ${drawn.length} drawn elements fit inside the viewBox` };
    }

    const lines = offenders.map(({ item, overflow }) => `${describeElement(item, item.motion.note)} extends ${overflow}`);
    return { passed: false, detail: `${offenders.length} element(s) outside the viewBox: ${listWithOverflow(lines)}` };
  },
};

// e.g. "past the right edge by 20 units and past the top edge by 4.5 units", or null if inside.
function describeOverflow(box: Box, viewBox: ViewBox): string | null {
  const overflows: [string, number][] = [
    ["left", viewBox.minX - box.minX],
    ["right", box.maxX - (viewBox.minX + viewBox.width)],
    ["top", viewBox.minY - box.minY],
    ["bottom", box.maxY - (viewBox.minY + viewBox.height)],
  ];
  const parts = overflows
    .filter(([, amount]) => amount > BOUNDS_TOLERANCE)
    .map(([edge, amount]) => `past the ${edge} edge by ${round(amount)} units`);
  return parts.length > 0 ? parts.join(" and ") : null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
