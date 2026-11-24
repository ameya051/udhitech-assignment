import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runChecks } from "../lib/checks";
import { applyToPoint, parseTransform, pathPoints } from "../lib/checks/geometry";
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
    expect(results.map((result) => result.id)).toEqual(["parse", "bounds", "labels", "animation"]);
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
    // 15 chars x 40 x 0.6 = 360 wide, centred on 200 → 20..380: inside.
    expect(resultOf(runChecks(svg, concept), "bounds").passed).toBe(true);
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

  it("reads arc flags written without separators", () => {
    expect(pathPoints("M0 0 a5 5 0 0110 10")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
});
