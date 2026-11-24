// Geometry helpers for the bounds check: 2D transforms, path points and bounding boxes.
// Everything here is pure maths on numbers and strings, with no DOM access.

import { CURVE_SAMPLES } from "../config";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// SVG affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function isIdentity(matrix: Matrix): boolean {
  return matrix.every((value, index) => value === IDENTITY[index]);
}

const NUMBER_PATTERN = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

export function parseNumbers(text: string): number[] {
  return (text.match(NUMBER_PATTERN) ?? []).map(Number);
}

// Returns outer · inner: apply `inner` first, then `outer`.
export function multiply(outer: Matrix, inner: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyToPoint(matrix: Matrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

// Applies only the scale/rotate/skew part of the matrix. Used for offsets (how far something
// moves), which the translation part must not shift.
export function applyLinear(matrix: Matrix, offset: Point): Point {
  const [a, b, c, d] = matrix;
  return { x: a * offset.x + c * offset.y, y: b * offset.x + d * offset.y };
}

// The matrix that undoes `matrix`, or null if it squashes everything onto a line (determinant 0).
// Used to view the drawing from a rotated label's own frame.
export function invert(matrix: Matrix): Matrix | null {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (determinant === 0) return null;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

// The largest factor by which the matrix can stretch a length, used to scale stroke widths.
export function maxScale(matrix: Matrix): number {
  const [a, b, c, d] = matrix;
  return Math.max(Math.hypot(a, b), Math.hypot(c, d));
}

const TRANSFORM_PATTERN = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;

// Parses a transform attribute like "translate(10 20) rotate(45 50 50)" into one matrix.
// Functions apply left to right as written, so each one multiplies onto the right.
export function parseTransform(transform: string | null): Matrix {
  let result = IDENTITY;
  for (const [, name, args] of (transform ?? "").matchAll(TRANSFORM_PATTERN)) {
    result = multiply(result, transformFunction(name, parseNumbers(args)));
  }
  return result;
}

function transformFunction(name: string, args: number[]): Matrix {
  const radians = ((args[0] ?? 0) * Math.PI) / 180;
  switch (name) {
    case "matrix":
      return args.length === 6 ? (args as Matrix) : IDENTITY;
    case "translate":
      return [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
    case "scale":
      return [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
    case "rotate":
      return rotateAround(radians, args[1] ?? 0, args[2] ?? 0);
    case "skewX":
      return [1, 0, Math.tan(radians), 1, 0, 0];
    case "skewY":
      return [1, Math.tan(radians), 0, 1, 0, 0];
    default:
      return IDENTITY;
  }
}

// rotate(a cx cy) = translate(cx cy) · rotate(a) · translate(-cx -cy)
function rotateAround(radians: number, centerX: number, centerY: number): Matrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
  return multiply(multiply([1, 0, 0, 1, centerX, centerY], rotation), [1, 0, 0, 1, -centerX, -centerY]);
}

export function boxOfPoints(points: Point[]): Box | null {
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

// Every point of `box` moved by every offset in `offsets`: the area a moving shape can cover.
export function addBoxes(box: Box, offsets: Box): Box {
  return {
    minX: box.minX + offsets.minX,
    minY: box.minY + offsets.minY,
    maxX: box.maxX + offsets.maxX,
    maxY: box.maxY + offsets.maxY,
  };
}

// "10,20 30,40" style number lists (polygon points, animateMotion values) → points.
export function pairsToPoints(numbers: number[]): Point[] {
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

export function cornersOfBox(box: Box): Point[] {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}

// How many numbers each path command takes per segment.
const PATH_ARGUMENT_COUNTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

const PATH_COMMAND_PATTERN = /([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi;

// Every endpoint and control point in a path's `d`, in absolute user units.
// Control points bound a bezier curve, so including them is a safe overestimate.
// Arcs only contribute their endpoint, so an arc's bulge is approximated (README limitation).
export function pathPoints(pathData: string): Point[] {
  const points: Point[] = [];
  forEachPathSegment(pathData, (_command, _origin, segment) => points.push(...segment.all));
  return points;
}

// The path as the lines a browser would draw: one polyline per subpath, curves sampled into
// CURVE_SAMPLES straight steps. Arcs become a straight chord (same limitation as pathPoints).
export function pathPolylines(pathData: string): Point[][] {
  const polylines: Point[][] = [];
  forEachPathSegment(pathData, (command, origin, segment) => {
    if (command === "M" || polylines.length === 0) {
      polylines.push([segment.end]);
      return;
    }
    const polyline = polylines[polylines.length - 1];
    if ((command === "C" || command === "S") && segment.all.length === 3) {
      const [first, second, end] = segment.all;
      polyline.push(...sampleCurve((t) => cubicPoint(origin, first, second, end, t)));
    } else if ((command === "Q" || command === "T") && segment.all.length === 2) {
      const [control, end] = segment.all;
      polyline.push(...sampleCurve((t) => quadraticPoint(origin, control, end, t)));
    } else {
      polyline.push(segment.end); // L, H, V, Z and arcs
    }
  });
  return polylines;
}

// Calls `visit` once per segment with its absolute points. Z is reported too, ending at the
// start of its subpath, so callers can draw the closing line.
function forEachPathSegment(
  pathData: string,
  visit: (command: string, origin: Point, segment: SegmentPoints) => void,
) {
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = current;
  let lastControl: Point | null = null; // for reflecting S/T control points
  let previousCommand = "";

  for (const [, letter, argText] of pathData.matchAll(PATH_COMMAND_PATTERN)) {
    const command = letter.toUpperCase();
    const isRelative = letter !== command;
    const args = command === "A" ? parseArcArguments(argText) : parseNumbers(argText);
    const argumentCount = PATH_ARGUMENT_COUNTS[command];

    if (command === "Z") {
      visit(command, current, { all: [], end: subpathStart, control: null });
      current = subpathStart;
      lastControl = null;
      previousCommand = command;
      continue;
    }

    for (let index = 0; index + argumentCount <= args.length; index += argumentCount) {
      const segment = args.slice(index, index + argumentCount);
      // After the first pair, extra M coordinates are implicit L commands.
      const segmentCommand = command === "M" && index > 0 ? "L" : command;
      const origin = current;
      const at = (dx: number, dy: number): Point =>
        isRelative ? { x: origin.x + dx, y: origin.y + dy } : { x: dx, y: dy };

      const reflected = reflect(origin, lastControl, previousCommand, segmentCommand);
      const segmentPoints = segmentToPoints(segmentCommand, segment, origin, at, reflected);
      visit(segmentCommand, origin, segmentPoints);
      current = segmentPoints.end;
      lastControl = segmentPoints.control;
      if (segmentCommand === "M") subpathStart = current;
      previousCommand = segmentCommand;
    }
  }
}

// Points at t = 1/n, 2/n, ..., 1 along a curve (t = 0 is the point already in the polyline).
function sampleCurve(pointAt: (t: number) => Point): Point[] {
  const points: Point[] = [];
  for (let step = 1; step <= CURVE_SAMPLES; step++) points.push(pointAt(step / CURVE_SAMPLES));
  return points;
}

// Standard Bezier formulas: a weighted mix of the start, control and end points.
function cubicPoint(start: Point, first: Point, second: Point, end: Point, t: number): Point {
  const u = 1 - t;
  const mix = (a: number, b: number, c: number, d: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  return { x: mix(start.x, first.x, second.x, end.x), y: mix(start.y, first.y, second.y, end.y) };
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const u = 1 - t;
  const mix = (a: number, b: number, c: number) => u * u * a + 2 * u * t * b + t * t * c;
  return { x: mix(start.x, control.x, end.x), y: mix(start.y, control.y, end.y) };
}

interface SegmentPoints {
  all: Point[];
  end: Point;
  control: Point | null; // last control point, needed if the next command is S or T
}

function segmentToPoints(
  command: string,
  args: number[],
  origin: Point,
  at: (dx: number, dy: number) => Point,
  reflected: Point,
): SegmentPoints {
  switch (command) {
    case "H": {
      const end = { x: at(args[0], 0).x, y: origin.y };
      return { all: [end], end, control: null };
    }
    case "V": {
      const end = { x: origin.x, y: at(0, args[0]).y };
      return { all: [end], end, control: null };
    }
    case "C": {
      const [first, second, end] = [at(args[0], args[1]), at(args[2], args[3]), at(args[4], args[5])];
      return { all: [first, second, end], end, control: second };
    }
    case "S": {
      const [second, end] = [at(args[0], args[1]), at(args[2], args[3])];
      return { all: [reflected, second, end], end, control: second };
    }
    case "Q": {
      const [control, end] = [at(args[0], args[1]), at(args[2], args[3])];
      return { all: [control, end], end, control };
    }
    case "T": {
      const end = at(args[0], args[1]);
      return { all: [reflected, end], end, control: reflected };
    }
    case "A": {
      const end = at(args[5], args[6]);
      return { all: [end], end, control: null };
    }
    default: {
      // M and L
      const end = at(args[0], args[1]);
      return { all: [end], end, control: null };
    }
  }
}

// S and T reuse the previous curve's control point mirrored through the current point.
function reflect(current: Point, lastControl: Point | null, previousCommand: string, command: string): Point {
  const followsCubic = command === "S" && (previousCommand === "C" || previousCommand === "S");
  const followsQuadratic = command === "T" && (previousCommand === "Q" || previousCommand === "T");
  if (!lastControl || !(followsCubic || followsQuadratic)) return current;
  return { x: 2 * current.x - lastControl.x, y: 2 * current.y - lastControl.y };
}

// Arc flags are single digits that may be written with no separator ("a5 5 0 0110 10"),
// so they can't be split with the normal number pattern.
function parseArcArguments(argText: string): number[] {
  const numberToken = /[\s,]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;
  const flagToken = /[\s,]*([01])/y;
  const numbers: number[] = [];
  let position = 0;

  while (true) {
    // Arguments 4 and 5 of every 7 (large-arc and sweep) are flags.
    const isFlag = numbers.length % 7 === 3 || numbers.length % 7 === 4;
    const token = isFlag ? flagToken : numberToken;
    token.lastIndex = position;
    const match = token.exec(argText);
    if (!match) return numbers;
    numbers.push(Number(match[1]));
    position = token.lastIndex;
  }
}
