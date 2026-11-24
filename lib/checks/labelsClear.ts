// Check 5 (our own): no line or outline runs through a text label.
// A diagram can be valid, inside the viewBox and animated, and still be hard to read when a
// label sits on top of a line (e.g. "Radius" written across the circle's edge).
// Uses the same text box estimate as the bounds check (drawn.ts + textWidth.ts).

import type { Document, Element } from "@xmldom/xmldom";
import { LABEL_LINE_TOLERANCE, LINE_SAMPLE_STEP, MAX_REPORTED_OFFENDERS } from "../config";
import type { SvgCheck } from "../types";
import { childElements, describeElement, drawnElements, type DrawnElement } from "./drawn";
import { applyToPoint, invert, maxScale, type Box, type Matrix, type Point } from "./geometry";
import { readViewBox } from "./parse";

const SMIL_TAGS = ["animate", "set", "animateTransform", "animateMotion"];

export const labelsClearCheck: SvgCheck = {
  id: "labelsClear",
  name: "Labels clear of lines",
  run: ({ doc }) => {
    const root = doc.documentElement;
    const viewBox = root ? readViewBox(root) : null;
    if (!root || !viewBox) return { passed: false, detail: "Skipped: no usable viewBox" };

    const drawn = drawnElements(root, viewBox);
    const animated = animationTargets(doc);
    // Moving or fading things can't be judged from one static position, so they are left out.
    const isStill = (item: DrawnElement) => !isAnimated(item.element, animated) && !isMoving(item);

    const labels = drawn.filter((item) => item.element.localName === "text");
    const stillLabels = labels.filter(isStill);
    const lines = drawn.filter((item) => item.outline.length > 0 && isStill(item));

    const crossings: string[] = [];
    for (const label of stillLabels) {
      for (const line of lines) {
        const crossing = crossingPoint(line, label);
        if (crossing) crossings.push(describeCrossing(label, line, crossing));
      }
    }

    if (crossings.length === 0) {
      const skippedCount = labels.length - stillLabels.length;
      const skippedNote = skippedCount > 0 ? ` (${skippedCount} animated labels not checked)` : "";
      return { passed: true, detail: `${stillLabels.length} labels, no lines run through them${skippedNote}` };
    }

    const reported = crossings.slice(0, MAX_REPORTED_OFFENDERS);
    const hiddenCount = crossings.length - reported.length;
    if (hiddenCount > 0) reported.push(`and ${hiddenCount} more`);
    return {
      passed: false,
      detail: `${crossings.length} label(s) have a line through them: ${reported.join("; ")}. Move each label beside the line, not on it.`,
    };
  },
};

// Tells the model where the label is and where the line hits it, so a retry knows how far to move
// it. Without this the model can't know our width estimate and tends to nudge the label too little.
// e.g. <text x="296" y="300"> "Chlorophyll" is crossed by <path d="…"> near (335, 295);
// estimated label box x 296–384, y 287–303
function describeCrossing(label: DrawnElement, line: DrawnElement, crossing: Point): string {
  const { minX, maxX, minY, maxY } = label.localBox;
  const box = `estimated label box x ${Math.round(minX)}–${Math.round(maxX)}, y ${Math.round(minY)}–${Math.round(maxY)}`;
  // Both are in the label's own x/y units, the numbers the model edits, even if it is rotated.
  const frameNote = label.isTransformed ? " (in the label's own x/y units, before its transform)" : "";
  return `${describeElement(label)} is crossed by ${describeElement(line)} near (${Math.round(crossing.x)}, ${Math.round(crossing.y)}); ${box}${frameNote}`;
}

// Looks at the line from the label's own frame, where the label is an upright box even if it
// is rotated, and walks along every segment in small steps to find the first step inside it.
// Returns that point in the label's frame, or null if the line never enters the label.
function crossingPoint(line: DrawnElement, label: DrawnElement): Point | null {
  const toLabelFrame = invert(label.matrix);
  if (!toLabelFrame) return null; // a label scaled to nothing can't be crossed

  // The line's stroke reaches halfStroke beyond its centre line; grazing the edge doesn't count.
  const reach = line.halfStroke / maxScale(label.matrix) - LABEL_LINE_TOLERANCE;
  const hitBox = grow(label.localBox, reach);

  for (const polyline of line.outline) {
    for (let index = 1; index < polyline.length; index++) {
      const hit = firstPointInBox(polyline[index - 1], polyline[index], toLabelFrame, hitBox);
      if (hit) return hit;
    }
  }
  return null;
}

// `start` and `end` are screen points; each sample is moved into the label's frame before testing.
function firstPointInBox(start: Point, end: Point, toLabelFrame: Matrix, box: Box): Point | null {
  const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / LINE_SAMPLE_STEP));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const sample = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    const point = applyToPoint(toLabelFrame, sample);
    if (point.x > box.minX && point.x < box.maxX && point.y > box.minY && point.y < box.maxY) return point;
  }
  return null;
}

function grow(box: Box, amount: number): Box {
  return { minX: box.minX - amount, minY: box.minY - amount, maxX: box.maxX + amount, maxY: box.maxY + amount };
}

function isMoving({ motion }: DrawnElement): boolean {
  const { minX, minY, maxX, maxY } = motion.offsets;
  return minX !== 0 || minY !== 0 || maxX !== 0 || maxY !== 0;
}

interface AnimationTargets {
  classes: Set<string>; // classes used by a <style> rule that sets `animation`
  ids: Set<string>; // ids that a SMIL element points at with href="#id"
}

function animationTargets(doc: Document): AnimationTargets {
  const classes = new Set<string>();
  const styleText = Array.from(doc.getElementsByTagName("style")).map((style) => style.textContent ?? "").join("\n");
  // Innermost `selector { body }` pairs. Keyframe steps match too, but have no class names.
  for (const [, selector, body] of styleText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/animation/i.test(body)) continue;
    for (const [, className] of selector.matchAll(/\.([\w-]+)/g)) classes.add(className);
  }

  const ids = new Set<string>();
  for (const tag of SMIL_TAGS) {
    for (const animation of Array.from(doc.getElementsByTagName(tag))) {
      const href = animation.getAttribute("href") ?? animation.getAttribute("xlink:href") ?? "";
      if (href.startsWith("#") && href.length > 1) ids.add(href.slice(1));
    }
  }
  return { classes, ids };
}

// True if the element or any group around it is animated: a SMIL child, a targeted id,
// an inline CSS animation, or a class that a <style> rule animates.
function isAnimated(element: Element, targets: AnimationTargets): boolean {
  for (let current: Element | null = element; current; current = parentElement(current)) {
    if (childElements(current).some((child) => SMIL_TAGS.includes(child.localName ?? ""))) return true;
    if (targets.ids.has(current.getAttribute("id") ?? "")) return true;
    if (/animation/i.test(current.getAttribute("style") ?? "")) return true;
    const classNames = (current.getAttribute("class") ?? "").split(/\s+/);
    if (classNames.some((name) => targets.classes.has(name))) return true;
  }
  return false;
}

const ELEMENT_NODE = 1;

function parentElement(element: Element): Element | null {
  const parent = element.parentNode;
  return parent && parent.nodeType === ELEMENT_NODE ? (parent as Element) : null;
}
