// Helper for bounds.ts: how far <animateMotion> can move an element.
// Moving particles are often drawn at cx="0" cy="0" and placed entirely by their motion path,
// so judging them by their own position alone flags diagrams that look fine in a browser.

import type { Element } from "@xmldom/xmldom";
import { hrefId } from "./dom";
import { addBoxes, applyLinear, boxOfPoints, pairsToPoints, parseNumbers, pathPoints, type Box, type Matrix, type Point } from "./geometry";

export interface Motion {
  offsets: Box; // range of screen-space offsets added to the element's own position
  note: string; // appended to a bounds failure so the model knows the motion was counted
}

const ORIGIN: Point = { x: 0, y: 0 };

export const NO_MOTION: Motion = { offsets: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, note: "" };

const PATH_ONLY_NOTE = " (along its <animateMotion> path)";
const WITH_START_NOTE =
  " (along its <animateMotion> path, or at its own position while the motion is not running, e.g. before a delayed begin)";

// `motions` are the element's <animateMotion> children; `matrix` includes the element's own transform.
// The SVG spec applies motion after that transform, so offsets are scaled/rotated by it but not moved.
export function motionOf(motions: Element[], matrix: Matrix): Motion {
  const offsets = motions.flatMap(motionOffsets);
  if (offsets.length === 0) return NO_MOTION;

  const showsStart = motions.every(showsStartPosition);
  const allOffsets = showsStart ? [...offsets, ORIGIN] : offsets;
  const box = boxOfPoints(allOffsets.map((offset) => applyLinear(matrix, offset)));
  if (!box) return NO_MOTION;
  return { offsets: box, note: showsStart ? WITH_START_NOTE : PATH_ONLY_NOTE };
}

// A moving group moves everything inside it, on top of any motion of its own children.
export function combineMotion(outer: Motion, inner: Motion): Motion {
  return { offsets: addBoxes(outer.offsets, inner.offsets), note: inner.note || outer.note };
}

// The points the motion passes through, relative to the element's own position.
// Same precedence as the SVG spec: <mpath>, then `path`, then `values`, then from/to/by.
// Curve control points and arc endpoints come from pathPoints (arc bulges are approximated there).
function motionOffsets(motion: Element): Point[] {
  const mpath = motion.getElementsByTagName("mpath")[0];
  if (mpath) return pathPoints(referencedPathData(mpath));

  const path = motion.getAttribute("path");
  if (path) return pathPoints(path);

  const values = motion.getAttribute("values");
  if (values) return pairsToPoints(parseNumbers(values));

  return fromToByOffsets(motion);
}

// <mpath href="#orbit"/> borrows the `d` of another element, usually a <path> inside <defs>.
function referencedPathData(mpath: Element): string {
  const id = hrefId(mpath);
  const target = id ? mpath.ownerDocument?.getElementById(id) : null;
  return target?.getAttribute("d") ?? "";
}

// from/to/by describe a straight move; a missing `from` starts at the element's own position.
function fromToByOffsets(motion: Element): Point[] {
  const readPoint = (name: string) => pairsToPoints(parseNumbers(motion.getAttribute(name) ?? ""))[0];
  const from = readPoint("from") ?? ORIGIN;
  const to = readPoint("to");
  const by = readPoint("by");
  if (to) return [from, to];
  if (by) return [from, { x: from.x + by.x, y: from.y + by.y }];
  return [];
}

// While the motion isn't running, the element is drawn at its own position: before a delayed
// begin (e.g. begin="2s") and after a finite animation ends without fill="freeze".
function showsStartPosition(motion: Element): boolean {
  const neverEnds =
    motion.getAttribute("repeatCount") === "indefinite" || motion.getAttribute("repeatDur") === "indefinite";
  const holdsLastFrame = motion.getAttribute("fill") === "freeze";
  return !beginsImmediately(motion.getAttribute("begin")) || !(neverEnds || holdsLastFrame);
}

const SINGLE_CLOCK_VALUE = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)?$/;

// No begin, "0s", or a negative offset like "-3s" all start moving on load. Anything else
// (a delay, "click", a list of times) counts as delayed, so the check errs on the side of flagging.
function beginsImmediately(begin: string | null): boolean {
  const value = (begin ?? "").trim();
  if (value === "") return true;
  const match = SINGLE_CLOCK_VALUE.exec(value);
  return match !== null && Number(match[1]) <= 0;
}
