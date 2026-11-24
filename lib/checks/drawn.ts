// Shared by the bounds and labels-clear checks: walks the SVG tree with a running transform and
// estimates the box of every drawn shape, its stroked outline, and how far <animateMotion> moves it.

import type { Element } from "@xmldom/xmldom";
import { DEFAULT_FONT_SIZE, MAX_REPORTED_OFFENDERS, OUTLINE_SAMPLES, TEXT_ASCENT_EM, TEXT_DESCENT_EM } from "../config";
import { childElements, normalisedText } from "./dom";
import {
  IDENTITY,
  applyToPoint,
  boxOfPoints,
  cornersOfBox,
  expandBox,
  isIdentity,
  maxScale,
  multiply,
  pairsToPoints,
  parseNumbers,
  parseTransform,
  pathPoints,
  pathPolylines,
  type Box,
  type Matrix,
  type Point,
} from "./geometry";
import { NO_MOTION, combineMotion, motionOf, type Motion } from "./motion";
import type { ViewBox } from "./parse";
import { textWidth } from "./textWidth";

// Never drawn directly (definitions, metadata, animation), so their children are ignored.
// <use> and <image> are skipped too: <use> would need reference resolution (README limitation).
const NOT_DRAWN = new Set([
  "defs", "clipPath", "mask", "marker", "symbol", "pattern", "linearGradient", "radialGradient",
  "filter", "style", "title", "desc", "metadata", "script", "foreignObject",
  "animate", "animateTransform", "animateMotion", "set", "use", "image",
]);

const SHAPES = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text"]);

// Presentation properties that children inherit from their parent group.
interface InheritedStyle {
  fontSize: number;
  isBold: boolean;
  stroke: string | null;
  strokeWidth: number;
  textAnchor: string;
}

// What a child inherits from the elements around it while we walk down the tree.
interface WalkState {
  matrix: Matrix; // all transforms from the root down to this element
  style: InheritedStyle;
  motion: Motion; // movement from this element's and its ancestors' <animateMotion>
}

export interface DrawnElement {
  element: Element;
  localBox: Box; // the shape's box in its own coordinates, before transforms and stroke
  ownBox: Box; // where it is drawn after transforms (incl. stroke), before any motion
  outline: Point[][]; // stroked lines as screen-space polylines; empty when there is no stroke
  halfStroke: number; // half the stroke width in screen units (0 when there is no stroke)
  matrix: Matrix;
  motion: Motion;
  isTransformed: boolean;
}

const ROOT_STYLE: InheritedStyle = { fontSize: DEFAULT_FONT_SIZE, isBold: false, stroke: null, strokeWidth: 1, textAnchor: "start" };

export function drawnElements(root: Element, viewBox: ViewBox): DrawnElement[] {
  const drawn: DrawnElement[] = [];
  const rootState: WalkState = { matrix: IDENTITY, style: inheritStyle(root, ROOT_STYLE), motion: NO_MOTION };
  collectBoxes(root, rootState, viewBox, drawn);
  return drawn;
}

function collectBoxes(parent: Element, parentState: WalkState, viewBox: ViewBox, drawn: DrawnElement[]) {
  for (const element of childElements(parent)) {
    const tag = element.localName ?? "";
    if (NOT_DRAWN.has(tag)) continue;

    const matrix = multiply(parentState.matrix, parseTransform(element.getAttribute("transform")));
    const motions = childElements(element).filter((child) => child.localName === "animateMotion");
    const state: WalkState = {
      matrix,
      style: inheritStyle(element, parentState.style),
      motion: combineMotion(parentState.motion, motionOf(motions, matrix)),
    };

    if (!SHAPES.has(tag)) {
      collectBoxes(element, state, viewBox, drawn); // <g>, <a>, nested <svg>, ...
      continue;
    }

    const points = shapePoints(element, state.style, viewBox);
    const localBox = boxOfPoints(points);
    const box = boxOfPoints(points.map((point) => applyToPoint(matrix, point)));
    if (!localBox || !box) continue;
    const halfStroke = halfStrokeWidth(state.style) * maxScale(matrix);
    const outline = halfStroke > 0 ? shapeOutline(element, viewBox) : [];
    drawn.push({
      element,
      localBox,
      ownBox: expandBox(box, halfStroke),
      outline: outline.map((polyline) => polyline.map((point) => applyToPoint(matrix, point))),
      halfStroke,
      matrix,
      motion: state.motion,
      isTransformed: !isIdentity(matrix),
    });
  }
}

// The points whose box covers the shape, in the shape's own coordinates (before transforms).
function shapePoints(element: Element, style: InheritedStyle, viewBox: ViewBox): Point[] {
  const read = (name: string, referenceSize: number) => resolveLength(element.getAttribute(name), referenceSize);
  const { width, height } = viewBox;
  // SVG resolves a percentage radius against the normalised diagonal.
  const diagonal = Math.sqrt((width * width + height * height) / 2);

  switch (element.localName) {
    case "rect": {
      const x = read("x", width);
      const y = read("y", height);
      return cornersOfBox({ minX: x, minY: y, maxX: x + read("width", width), maxY: y + read("height", height) });
    }
    case "circle":
      return ellipseCorners(read("cx", width), read("cy", height), read("r", diagonal), read("r", diagonal));
    case "ellipse":
      return ellipseCorners(read("cx", width), read("cy", height), read("rx", width), read("ry", height));
    case "line":
      return [
        { x: read("x1", width), y: read("y1", height) },
        { x: read("x2", width), y: read("y2", height) },
      ];
    case "polyline":
    case "polygon":
      return pairsToPoints(parseNumbers(element.getAttribute("points") ?? ""));
    case "path":
      return pathPoints(element.getAttribute("d") ?? "");
    case "text":
      return textCorners(element, style);
    default:
      return [];
  }
}

// The lines a stroke follows, in the shape's own coordinates. Closed shapes repeat their first
// point at the end. Rounded rect corners (rx/ry) are drawn square (README limitation).
function shapeOutline(element: Element, viewBox: ViewBox): Point[][] {
  const read = (name: string, referenceSize: number) => resolveLength(element.getAttribute(name), referenceSize);
  const { width, height } = viewBox;
  const diagonal = Math.sqrt((width * width + height * height) / 2);
  const closed = (points: Point[]) => (points.length > 0 ? [[...points, points[0]]] : []);

  switch (element.localName) {
    case "rect": {
      const x = read("x", width);
      const y = read("y", height);
      return closed(cornersOfBox({ minX: x, minY: y, maxX: x + read("width", width), maxY: y + read("height", height) }));
    }
    case "circle":
      return closed(ellipsePoints(read("cx", width), read("cy", height), read("r", diagonal), read("r", diagonal)));
    case "ellipse":
      return closed(ellipsePoints(read("cx", width), read("cy", height), read("rx", width), read("ry", height)));
    case "line":
      return [[
        { x: read("x1", width), y: read("y1", height) },
        { x: read("x2", width), y: read("y2", height) },
      ]];
    case "polyline":
      return [pairsToPoints(parseNumbers(element.getAttribute("points") ?? ""))];
    case "polygon":
      return closed(pairsToPoints(parseNumbers(element.getAttribute("points") ?? "")));
    case "path":
      return pathPolylines(element.getAttribute("d") ?? "");
    default:
      return []; // text has no outline to cross other labels
  }
}

// OUTLINE_SAMPLES evenly spaced points around an ellipse.
function ellipsePoints(centerX: number, centerY: number, radiusX: number, radiusY: number): Point[] {
  const points: Point[] = [];
  for (let step = 0; step < OUTLINE_SAMPLES; step++) {
    const angle = (2 * Math.PI * step) / OUTLINE_SAMPLES;
    points.push({ x: centerX + radiusX * Math.cos(angle), y: centerY + radiusY * Math.sin(angle) });
  }
  return points;
}

function ellipseCorners(centerX: number, centerY: number, radiusX: number, radiusY: number): Point[] {
  return cornersOfBox({ minX: centerX - radiusX, minY: centerY - radiusY, maxX: centerX + radiusX, maxY: centerY + radiusY });
}

// No font metrics on the server, so the box is an estimate (see the TEXT_* constants).
// Tspans count toward the character total but their own x/y/dy are not followed (README limitation).
function textCorners(element: Element, style: InheritedStyle): Point[] {
  const text = normalisedText(element);
  if (text.length === 0) return [];

  const fontSize = style.fontSize;
  const x = firstNumber(element.getAttribute("x")) + resolveFontRelative(element.getAttribute("dx"), fontSize);
  const y = firstNumber(element.getAttribute("y")) + resolveFontRelative(element.getAttribute("dy"), fontSize);
  const width = textWidth(text, fontSize, style.isBold);
  const anchorShift = style.textAnchor === "middle" ? width / 2 : style.textAnchor === "end" ? width : 0;

  return cornersOfBox({
    minX: x - anchorShift,
    maxX: x - anchorShift + width,
    minY: y - fontSize * TEXT_ASCENT_EM,
    maxY: y + fontSize * TEXT_DESCENT_EM,
  });
}

function inheritStyle(element: Element, parent: InheritedStyle): InheritedStyle {
  const fontSize = resolveFontSize(readProperty(element, "font-size"), parent.fontSize);
  const strokeWidth = Number.parseFloat(readProperty(element, "stroke-width") ?? "");
  return {
    fontSize,
    isBold: resolveBold(readProperty(element, "font-weight"), parent.isBold),
    stroke: readProperty(element, "stroke") ?? parent.stroke,
    strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : parent.strokeWidth,
    textAnchor: readProperty(element, "text-anchor") ?? parent.textAnchor,
  };
}

// An inline `style` declaration wins over the presentation attribute, as in a browser.
// Rules in <style> blocks (class selectors) are not applied (README limitation).
function readProperty(element: Element, name: string): string | null {
  const declaration = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(element.getAttribute("style") ?? "");
  const value = declaration ? declaration[1] : element.getAttribute(name);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function halfStrokeWidth(style: InheritedStyle): number {
  const hasStroke = style.stroke !== null && style.stroke !== "none";
  return hasStroke ? style.strokeWidth / 2 : 0;
}

function resolveFontSize(value: string | null, parentFontSize: number): number {
  if (value === null) return parentFontSize;
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return parentFontSize; // keywords like "large" keep the parent size
  if (value.endsWith("%")) return (parentFontSize * number) / 100;
  if (value.endsWith("em")) return parentFontSize * number;
  return number;
}

// "bold", "bolder" and 600-900 draw bold; "normal", "lighter" and 100-500 don't; anything else inherits.
function resolveBold(value: string | null, parentIsBold: boolean): boolean {
  if (value === null) return parentIsBold;
  if (value === "bold" || value === "bolder") return true;
  if (value === "normal" || value === "lighter") return false;
  const weight = Number(value);
  return Number.isFinite(weight) ? weight >= 600 : parentIsBold;
}

// dx/dy on text are often written in em (e.g. dy="0.35em" to centre vertically).
function resolveFontRelative(value: string | null, fontSize: number): number {
  const number = firstNumber(value);
  return value?.trim().endsWith("em") ? number * fontSize : number;
}

function resolveLength(value: string | null, referenceSize: number): number {
  const number = Number.parseFloat(value ?? "");
  if (!Number.isFinite(number)) return 0; // SVG treats a missing coordinate as 0
  return value?.trim().endsWith("%") ? (number * referenceSize) / 100 : number;
}

// x and y on <text> may be a list (one per character); the first value positions the text.
function firstNumber(value: string | null): number {
  return parseNumbers(value ?? "")[0] ?? 0;
}

// Identifying attributes per shape, so the model can find the exact element on retry.
const KEY_ATTRIBUTES: Record<string, string[]> = {
  rect: ["x", "y", "width", "height"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
  polyline: ["points"],
  polygon: ["points"],
  path: ["d"],
  text: ["x", "y"],
};

const MAX_ATTRIBUTE_PREVIEW_CHARS = 40;

// e.g. <text x="10" y="20"> "Label" (after its transforms). `note` is appended as-is.
export function describeElement({ element, isTransformed }: DrawnElement, note = ""): string {
  const tag = element.localName ?? "element";
  const names = element.getAttribute("id") ? ["id", ...KEY_ATTRIBUTES[tag]] : KEY_ATTRIBUTES[tag];
  const attributes = names
    .filter((name) => element.hasAttribute(name))
    .map((name) => `${name}="${preview(element.getAttribute(name) ?? "")}"`);
  const label = tag === "text" ? ` "${preview(normalisedText(element))}"` : "";
  const transformNote = isTransformed ? " (after its transforms)" : "";
  return `<${[tag, ...attributes].join(" ")}>${label}${transformNote}${note}`;
}

function preview(value: string): string {
  return value.length > MAX_ATTRIBUTE_PREVIEW_CHARS ? `${value.slice(0, MAX_ATTRIBUTE_PREVIEW_CHARS)}…` : value;
}

// The first MAX_REPORTED_OFFENDERS lines plus "and N more", so the retry prompt stays short.
export function listWithOverflow(lines: string[]): string {
  const reported = lines.slice(0, MAX_REPORTED_OFFENDERS);
  const hiddenCount = lines.length - reported.length;
  if (hiddenCount > 0) reported.push(`and ${hiddenCount} more`);
  return reported.join("; ");
}
