// Check 2: nothing drawn outside the viewBox.
// Walks the SVG tree with a running transform, estimates each shape's box, and compares it to the viewBox.

import type { Element } from "@xmldom/xmldom";
import {
  BOUNDS_TOLERANCE,
  DEFAULT_FONT_SIZE,
  MAX_REPORTED_OFFENDERS,
  TEXT_ASCENT_EM,
  TEXT_CHAR_WIDTH_EM,
  TEXT_DESCENT_EM,
} from "../config";
import type { SvgCheck } from "../types";
import {
  IDENTITY,
  applyToPoint,
  boxOfPoints,
  cornersOfBox,
  isIdentity,
  maxScale,
  multiply,
  parseNumbers,
  parseTransform,
  pathPoints,
  type Box,
  type Matrix,
  type Point,
} from "./geometry";
import { readViewBox, type ViewBox } from "./parse";

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
  stroke: string | null;
  strokeWidth: number;
  textAnchor: string;
}

interface DrawnBox {
  element: Element;
  box: Box;
  isTransformed: boolean;
}

const ROOT_STYLE: InheritedStyle = { fontSize: DEFAULT_FONT_SIZE, stroke: null, strokeWidth: 1, textAnchor: "start" };

export const boundsCheck: SvgCheck = {
  id: "bounds",
  name: "Inside viewBox",
  run: ({ doc }) => {
    const root = doc.documentElement;
    const viewBox = root ? readViewBox(root) : null;
    if (!root || !viewBox) return { passed: false, detail: "Skipped: no usable viewBox" };

    const drawn: DrawnBox[] = [];
    collectBoxes(root, IDENTITY, inheritStyle(root, ROOT_STYLE), viewBox, drawn);

    const offenders = drawn
      .map((item) => ({ item, overflow: describeOverflow(item.box, viewBox) }))
      .filter(({ overflow }) => overflow !== null);

    if (offenders.length === 0) {
      return { passed: true, detail: `All ${drawn.length} drawn elements fit inside the viewBox` };
    }

    const lines = offenders
      .slice(0, MAX_REPORTED_OFFENDERS)
      .map(({ item, overflow }) => `${describeElement(item)} extends ${overflow}`);
    const hiddenCount = offenders.length - lines.length;
    if (hiddenCount > 0) lines.push(`and ${hiddenCount} more`);
    return { passed: false, detail: `${offenders.length} element(s) outside the viewBox: ${lines.join("; ")}` };
  },
};

function collectBoxes(parent: Element, parentMatrix: Matrix, parentStyle: InheritedStyle, viewBox: ViewBox, drawn: DrawnBox[]) {
  for (const element of childElements(parent)) {
    const tag = element.localName ?? "";
    if (NOT_DRAWN.has(tag)) continue;

    const matrix = multiply(parentMatrix, parseTransform(element.getAttribute("transform")));
    const style = inheritStyle(element, parentStyle);

    if (!SHAPES.has(tag)) {
      collectBoxes(element, matrix, style, viewBox, drawn); // <g>, <a>, nested <svg>, ...
      continue;
    }

    const box = boxOfPoints(shapePoints(element, style, viewBox).map((point) => applyToPoint(matrix, point)));
    if (!box) continue;
    const strokeAllowance = halfStrokeWidth(style) * maxScale(matrix);
    drawn.push({ element, box: expand(box, strokeAllowance), isTransformed: !isIdentity(matrix) });
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

function ellipseCorners(centerX: number, centerY: number, radiusX: number, radiusY: number): Point[] {
  return cornersOfBox({ minX: centerX - radiusX, minY: centerY - radiusY, maxX: centerX + radiusX, maxY: centerY + radiusY });
}

function pairsToPoints(numbers: number[]): Point[] {
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

// No font metrics on the server, so the box is an estimate (see the TEXT_* constants).
// Tspans count toward the character total but their own x/y/dy are not followed (README limitation).
function textCorners(element: Element, style: InheritedStyle): Point[] {
  const text = normalisedText(element);
  if (text.length === 0) return [];

  const fontSize = style.fontSize;
  const x = firstNumber(element.getAttribute("x")) + resolveFontRelative(element.getAttribute("dx"), fontSize);
  const y = firstNumber(element.getAttribute("y")) + resolveFontRelative(element.getAttribute("dy"), fontSize);
  const textWidth = text.length * fontSize * TEXT_CHAR_WIDTH_EM;
  const anchorShift = style.textAnchor === "middle" ? textWidth / 2 : style.textAnchor === "end" ? textWidth : 0;

  return cornersOfBox({
    minX: x - anchorShift,
    maxX: x - anchorShift + textWidth,
    minY: y - fontSize * TEXT_ASCENT_EM,
    maxY: y + fontSize * TEXT_DESCENT_EM,
  });
}

function inheritStyle(element: Element, parent: InheritedStyle): InheritedStyle {
  const fontSize = resolveFontSize(readProperty(element, "font-size"), parent.fontSize);
  const strokeWidth = Number.parseFloat(readProperty(element, "stroke-width") ?? "");
  return {
    fontSize,
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

function expand(box: Box, amount: number): Box {
  return { minX: box.minX - amount, minY: box.minY - amount, maxX: box.maxX + amount, maxY: box.maxY + amount };
}

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

function describeElement({ element, isTransformed }: DrawnBox): string {
  const tag = element.localName ?? "element";
  const names = element.getAttribute("id") ? ["id", ...KEY_ATTRIBUTES[tag]] : KEY_ATTRIBUTES[tag];
  const attributes = names
    .filter((name) => element.hasAttribute(name))
    .map((name) => `${name}="${preview(element.getAttribute(name) ?? "")}"`);
  const label = tag === "text" ? ` "${preview(normalisedText(element))}"` : "";
  const transformNote = isTransformed ? " (after its transforms)" : "";
  return `<${[tag, ...attributes].join(" ")}>${label}${transformNote}`;
}

function preview(value: string): string {
  return value.length > MAX_ATTRIBUTE_PREVIEW_CHARS ? `${value.slice(0, MAX_ATTRIBUTE_PREVIEW_CHARS)}…` : value;
}

function normalisedText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

const ELEMENT_NODE = 1; // DOM nodeType for elements (text and comments are skipped)

function childElements(parent: Element): Element[] {
  const elements: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index++) {
    const node = parent.childNodes[index];
    if (node.nodeType === ELEMENT_NODE) elements.push(node as Element);
  }
  return elements;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
