import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runChecks } from "../lib/checks";
import { applyToPoint, invert, parseTransform, pathPoints, pathPolylines } from "../lib/checks/geometry";
import { CONCEPTS } from "../lib/concepts";
import { extractSvg } from "../lib/extractSvg";
import type { CheckId, CheckResult } from "../lib/types";

const concept = CONCEPTS[1]; // circle-parts

function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf8");
}

function resultOf(results: CheckResult[], id: CheckId): CheckResult {
  const result = results.find((check) => check.id === id);
  if (!result) throw new Error(`No result for check ${id}`);
  return result;
}

// Wraps drawing elements in an otherwise valid SVG, so a test can focus on the bounds check.
function svgWith(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><title>T</title>${body}</svg>`;
}

describe("extractSvg", () => {
  it("pulls the svg out of a fenced reply with prose around it", () => {
    const reply = 'Here you go:\n```svg\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n```\nEnjoy!';
    expect(extractSvg(reply)).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });

  it("returns null when there is no svg", () => {
    expect(extractSvg("Sorry, I can't draw that.")).toBeNull();
  });

  it("keeps only the last SVG when the model sends a draft and then a correction", () => {
    const reply = '<svg id="draft"></svg>\n\nWait: that is wrong, fixed below.\n\n<svg id="fixed"></svg>';
    expect(extractSvg(reply)).toBe('<svg id="fixed"></svg>');
  });

  it("keeps a nested <svg> element inside its parent", () => {
    const svg = '<svg id="outer"><svg id="inner"><rect /></svg><text>after</text></svg>';
    expect(extractSvg(`Here:\n${svg}`)).toBe(svg);
  });
});

describe("runChecks", () => {
  it("passes every check for a good SVG", () => {
    const results = runChecks(fixture("good.svg"), concept);
    for (const result of results) expect(result, result.detail).toMatchObject({ passed: true });
    expect(results.map((result) => result.id)).toEqual(["parse", "bounds", "labels", "animation", "labelsClear"]);
  });

  it("fails parse on malformed XML and skips the rest", () => {
    const results = runChecks(fixture("malformed.svg"), concept);
    expect(resultOf(results, "parse").passed).toBe(false);
    expect(resultOf(results, "parse").detail).toMatch(/^Invalid XML/);
    for (const result of results.slice(1)) {
      expect(result).toMatchObject({ passed: false, detail: "Skipped: SVG could not be parsed" });
    }
  });

  it("fails parse when the reply had no svg", () => {
    const parse = resultOf(runChecks(null, concept), "parse");
    expect(parse).toMatchObject({ passed: false, detail: "Response did not contain an <svg> element" });
  });
});

describe("parse check", () => {
  it("fails without the SVG xmlns", () => {
    const parse = resultOf(runChecks('<svg viewBox="0 0 10 10"></svg>', concept), "parse");
    expect(parse.passed).toBe(false);
    expect(parse.detail).toContain("xmlns");
  });

  it("fails without a usable viewBox", () => {
    const parse = resultOf(runChecks('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 10"></svg>', concept), "parse");
    expect(parse.passed).toBe(false);
    expect(parse.detail).toContain("viewBox");
  });

  it("fails on an unescaped ampersand", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>a & b</text></svg>';
    const parse = resultOf(runChecks(svg, concept), "parse");
    expect(parse.passed).toBe(false);
    expect(parse.detail).toContain("&amp;");
  });

  it("accepts escaped entities", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>a &amp; b, 90&#176;</text></svg>';
    expect(resultOf(runChecks(svg, concept), "parse").passed).toBe(true);
  });

  it("fails on an HTML-only entity like &nbsp;", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>a&nbsp;b</text></svg>';
    expect(resultOf(runChecks(svg, concept), "parse").passed).toBe(false);
  });
});

describe("bounds check", () => {
  it("fails a circle whose radius overflows the right edge, naming it", () => {
    const bounds = resultOf(runChecks(fixture("circle-overflow.svg"), concept), "bounds");
    expect(bounds.passed).toBe(false);
    expect(bounds.detail).toContain('<circle cx="390" cy="150" r="30">');
    expect(bounds.detail).toContain("past the right edge by 20 units");
  });

  it("fails a group translated off screen", () => {
    const bounds = resultOf(runChecks(fixture("translate-overflow.svg"), concept), "bounds");
    expect(bounds.passed).toBe(false);
    expect(bounds.detail).toContain("<rect");
    expect(bounds.detail).toContain("(after its transforms)");
  });

  it("passes end-anchored text near the right edge", () => {
    const svg = svgWith('<text x="398" y="150" text-anchor="end" font-size="20">Hypotenuse</text>');
    expect(resultOf(runChecks(svg, concept), "bounds").passed).toBe(true);
  });

  it("fails start-anchored text that runs off the right edge", () => {
    const svg = svgWith('<text x="350" y="150" font-size="20">Hypotenuse</text>');
    const bounds = resultOf(runChecks(svg, concept), "bounds");
    expect(bounds.passed).toBe(false);
    expect(bounds.detail).toContain('"Hypotenuse"');
  });

  it("inherits font size and anchor from a parent group", () => {
    const svg = svgWith('<g font-size="40" style="text-anchor: middle"><text x="200" y="150">Wide label here</text></g>');
    // Arial widths: 6.95em x 40 = 278 wide, centred on 200 → 61..339: inside.
    expect(resultOf(runChecks(svg, concept), "bounds").passed).toBe(true);
  });

  // From the series-circuit run: 0.6em per character put this 4 units past the left edge,
  // but in Arial it is 171 units wide and starts at x≈19.
  it("measures text with Arial widths, so a long end-anchored label near the edge passes", () => {
    const svg = svgWith('<text x="190" y="150" text-anchor="end" font-size="18">between components</text>');
    expect(resultOf(runChecks(svg, concept), "bounds").passed).toBe(true);
  });

  it("widens bold text", () => {
    // 171 units regular, 188 bold: only the bold one crosses the left edge from x=185.
    const label = (weight: string) => svgWith(`<text x="185" y="150" text-anchor="end" font-size="18" font-weight="${weight}">between components</text>`);
    expect(resultOf(runChecks(label("normal"), concept), "bounds").passed).toBe(true);
    expect(resultOf(runChecks(label("bold"), concept), "bounds").passed).toBe(false);
  });

  it("counts stroke width at the edge", () => {
    const svg = svgWith('<rect x="0" y="0" width="400" height="300" fill="none" stroke="black" stroke-width="10" />');
    expect(resultOf(runChecks(svg, concept), "bounds").passed).toBe(false);
  });

  it("ignores shapes inside defs", () => {
    const svg = svgWith('<defs><circle cx="1000" cy="1000" r="5" /></defs>');
    expect(resultOf(runChecks(svg, concept), "bounds").passed).toBe(true);
  });

  // From the first real run: particles drawn at (0,0) and placed only by their motion path.
  it("judges a circle at (0,0) by its animateMotion path, not its own position", () => {
    const svg = svgWith(
      '<circle cx="0" cy="0" r="10"><animateMotion dur="4s" repeatCount="indefinite" path="M60 200 L300 150" /></circle>',
    );
    expect(resultOf(runChecks(svg, concept), "bounds").passed).toBe(true);
  });

  it("still fails when a delayed begin leaves the circle at (0,0) until it moves", () => {
    const svg = svgWith(
      '<circle cx="0" cy="0" r="10"><animateMotion dur="4s" begin="2s" repeatCount="indefinite" path="M60 200 L300 150" /></circle>',
    );
    const bounds = resultOf(runChecks(svg, concept), "bounds");
    expect(bounds.passed).toBe(false);
    expect(bounds.detail).toContain("before a delayed begin");
  });

  it("fails when the motion path itself leaves the viewBox", () => {
    const svg = svgWith(
      '<circle cx="200" cy="150" r="10"><animateMotion dur="4s" repeatCount="indefinite" path="M0 0 L250 0" /></circle>',
    );
    const bounds = resultOf(runChecks(svg, concept), "bounds");
    expect(bounds.passed).toBe(false);
    expect(bounds.detail).toContain("(along its <animateMotion> path) extends past the right edge by 60 units");
  });

  it("follows <mpath> to a path defined elsewhere, inside a moved group", () => {
    const svg = svgWith(
      '<defs><path id="orbit" d="M0 0 L500 0" /></defs>' +
        '<g transform="translate(-100 0)"><circle cx="0" cy="150" r="5">' +
        '<animateMotion dur="4s" repeatCount="indefinite"><mpath href="#orbit" /></animateMotion></circle></g>',
    );
    // Moves from x=-100 to x=400 (500 along the path, minus the group's translate): off the left edge.
    const bounds = resultOf(runChecks(svg, concept), "bounds");
    expect(bounds.passed).toBe(false);
    expect(bounds.detail).toContain("past the left edge");
  });
});

describe("labels check", () => {
  it("fails with only 2 non-empty labels", () => {
    const labels = resultOf(runChecks(fixture("two-labels.svg"), concept), "labels");
    expect(labels).toMatchObject({ passed: false, detail: "Found 2 non-empty <text> labels, need at least 3" });
  });

  it("fails with no title", () => {
    const labels = resultOf(runChecks(fixture("no-title.svg"), concept), "labels");
    expect(labels.passed).toBe(false);
    expect(labels.detail).toContain("Missing <title>");
  });
});

describe("animation check", () => {
  it("fails with no animation (unused @keyframes doesn't count)", () => {
    const animation = resultOf(runChecks(fixture("no-animation.svg"), concept), "animation");
    expect(animation).toMatchObject({ passed: false, detail: "No SMIL animation elements and no CSS @keyframes in use" });
  });

  it("passes CSS @keyframes used by an animation rule", () => {
    expect(resultOf(runChecks(fixture("css-animation.svg"), concept), "animation").passed).toBe(true);
  });

  it("passes @keyframes used from an inline style attribute", () => {
    const svg = svgWith(
      '<style>@keyframes fade { to { opacity: 0 } }</style><circle cx="50" cy="50" r="5" style="animation-name: fade" />',
    );
    expect(resultOf(runChecks(svg, concept), "animation").passed).toBe(true);
  });
});

describe("labels clear check", () => {
  const clearOf = (body: string) => resultOf(runChecks(svgWith(body), concept), "labelsClear");
  // At font-size 16 and 0.5em per character, "Centre" at (100, 100) covers x 100-148, y 87-103.
  const centre = '<text x="100" y="100">Centre</text>';

  it("fails when a line runs through a label, naming both", () => {
    const result = clearOf(`${centre}<line x1="90" y1="95" x2="160" y2="95" stroke="#000" stroke-width="2" />`);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('"Centre" is crossed by <line');
  });

  it("says where the line hits the label and how big the label is estimated to be", () => {
    // The hit box is the label shrunk by the 2-unit tolerance (less 1 for the half stroke), so
    // walking the line from x=90 the first point inside is x=102.
    const result = clearOf(`${centre}<line x1="90" y1="95" x2="160" y2="95" stroke="#000" stroke-width="2" />`);
    expect(result.detail).toContain("near (102, 95); estimated label box x 100–148, y 87–103");
  });

  it("passes a label just above a line", () => {
    expect(clearOf(`${centre}<line x1="90" y1="110" x2="160" y2="110" stroke="#000" stroke-width="2" />`).passed).toBe(true);
  });

  it("passes a label inside a circle but fails one across its outline", () => {
    const circle = '<circle cx="200" cy="150" r="80" fill="#eef" stroke="#00f" stroke-width="4" />';
    expect(clearOf(`${circle}<text x="200" y="155" text-anchor="middle">Centre</text>`).passed).toBe(true);
    expect(clearOf(`${circle}<text x="270" y="155">Circumference</text>`).passed).toBe(false);
  });

  it("ignores filled shapes without a stroke", () => {
    expect(clearOf(`<rect x="50" y="50" width="200" height="100" fill="#cde" />${centre}`).passed).toBe(true);
  });

  it("checks rotated labels in their own frame", () => {
    // "Radius" written outward from the centre at 45°, through the circle's edge at r=40.
    const crossing = '<circle cx="200" cy="150" r="40" fill="none" stroke="#000" stroke-width="2" />' +
      '<text x="200" y="150" transform="rotate(45 200 150)">Radius</text>';
    const crossingResult = clearOf(crossing);
    expect(crossingResult.passed).toBe(false);
    expect(crossingResult.detail).toContain("(in the label's own x/y units, before its transform)");

    // Same angle, but sitting just above a 45° line instead of on it.
    const parallel = '<line x1="200" y1="150" x2="300" y2="250" stroke="#000" stroke-width="2" />' +
      '<text x="200" y="140" transform="rotate(45 200 150)">Radius</text>';
    expect(clearOf(parallel).passed).toBe(true);
  });

  it("follows curves, not just their end points", () => {
    // The ends are below the label; the middle of the curve passes through it at y=90.
    expect(clearOf(`${centre}<path d="M 80 140 Q 124 40 170 140" fill="none" stroke="#000" />`).passed).toBe(false);
  });

  it("skips animated labels and moving lines", () => {
    const line = '<line x1="90" y1="95" x2="160" y2="95" stroke="#000" stroke-width="2" />';
    const fadingLabel = '<text x="100" y="100">Centre<animate attributeName="opacity" values="1;0" dur="2s" repeatCount="indefinite" /></text>';
    expect(clearOf(`${fadingLabel}${line}`)).toMatchObject({ passed: true, detail: "0 labels, no lines run through them (1 animated labels not checked)" });

    const movingLine = '<line x1="90" y1="95" x2="160" y2="95" stroke="#000"><animateMotion path="M0,0 L0,40" dur="2s" repeatCount="indefinite" /></line>';
    expect(clearOf(`${centre}${movingLine}`).passed).toBe(true);
  });

  it("catches the real circle-parts diagram from the first run", () => {
    const result = resultOf(runChecks(fixture("circle-parts-crossing.svg"), concept), "labelsClear");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('"Centre" is crossed by <line');
    expect(result.detail).toContain('"Radius" (after its transforms) is crossed by <circle');
  });
});

describe("geometry", () => {
  it("applies rotate around a centre", () => {
    const point = applyToPoint(parseTransform("rotate(90 100 100)"), { x: 200, y: 100 });
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(200);
  });

  it("applies transform functions left to right", () => {
    // translate then scale: the point is scaled first, then moved.
    const point = applyToPoint(parseTransform("translate(10, 0) scale(2)"), { x: 5, y: 5 });
    expect(point).toEqual({ x: 20, y: 10 });
  });

  it("collects absolute and relative path points, including curve control points", () => {
    expect(pathPoints("M10 10 h20 v20 q 5 -30 10 0 Z")).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 35, y: 0 },
      { x: 40, y: 30 },
    ]);
  });

  it("inverts a transform so a point can be mapped back", () => {
    const matrix = parseTransform("rotate(45 500 340)");
    const inverse = invert(matrix);
    if (!inverse) throw new Error("rotation should be invertible");
    const back = applyToPoint(inverse, applyToPoint(matrix, { x: 520, y: 330 }));
    expect(back.x).toBeCloseTo(520);
    expect(back.y).toBeCloseTo(330);
    expect(invert([0, 0, 0, 0, 5, 5])).toBeNull();
  });

  it("splits path polylines per subpath and closes on Z", () => {
    expect(pathPolylines("M0 0 L10 0 L10 10 Z M20 20 h10")).toEqual([
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }],
      [{ x: 20, y: 20 }, { x: 30, y: 20 }],
    ]);
  });

  it("samples curves into polyline points that follow the curve", () => {
    const [polyline] = pathPolylines("M0 0 Q 5 10 10 0");
    expect(polyline).toHaveLength(17); // start + CURVE_SAMPLES steps
    expect(polyline[8]).toEqual({ x: 5, y: 5 }); // halfway along a quadratic: 2·0.5·0.5·10 = 5
    expect(polyline[16]).toEqual({ x: 10, y: 0 });
  });

  it("reads arc flags written without separators", () => {
    expect(pathPoints("M0 0 a5 5 0 0110 10")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
});
