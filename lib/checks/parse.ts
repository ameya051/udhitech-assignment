// Check 1: the SVG is well-formed XML, its root is <svg> in the SVG namespace, and it has a viewBox.
// runChecks() calls parseSvg() once and hands the resulting document to every other check.

import { DOMParser, type Document, type Element } from "@xmldom/xmldom";

export const PARSE_CHECK_NAME = "Valid SVG";
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// An "&" that doesn't start an entity like &amp; &#176; or &#xB0;.
const BARE_AMPERSAND = /&(?![a-zA-Z][\w.-]*;|#\d+;|#x[0-9a-fA-F]+;)/;

export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface ParseOutcome {
  doc: Document | null; // null whenever the check failed
  detail: string;
}

export function parseSvg(svgText: string | null): ParseOutcome {
  if (svgText === null) return failure("Response did not contain an <svg> element");

  // xmldom tolerates a bare "&" (e.g. "Light & water"), but browsers reject the whole image.
  const bareAmpersand = BARE_AMPERSAND.exec(svgText);
  if (bareAmpersand) {
    return failure(`Invalid XML: unescaped "&" near "${svgText.slice(bareAmpersand.index, bareAmpersand.index + 20)}" (write &amp;)`);
  }

  const { doc, parserMessages } = parseXml(svgText);
  if (parserMessages.length > 0) {
    return failure(`Invalid XML: ${parserMessages.join("; ")}`);
  }

  const root = doc?.documentElement;
  if (!doc || !root) return failure("Invalid XML: no root element");
  if (root.localName !== "svg") return failure(`Root element is <${root.localName}>, expected <svg>`);
  // The attribute is checked too: the parser may assume the SVG namespace, but an <img> won't.
  if (root.namespaceURI !== SVG_NAMESPACE || root.getAttribute("xmlns") !== SVG_NAMESPACE) {
    return failure(`<svg> is missing xmlns="${SVG_NAMESPACE}" (browsers won't render it as an image)`);
  }

  const viewBox = readViewBox(root);
  if (!viewBox) {
    return failure(
      `<svg> needs a viewBox of 4 numbers with positive width and height, got "${root.getAttribute("viewBox") ?? ""}"`,
    );
  }

  return { doc, detail: `Parsed OK, viewBox ${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}` };
}

// Reads the root's viewBox, or null if it is missing or unusable.
export function readViewBox(root: Element): ViewBox | null {
  const numbers = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (numbers.length !== 4 || !numbers.every(Number.isFinite)) return null;

  const [minX, minY, width, height] = numbers;
  if (width <= 0 || height <= 0) return null;
  return { minX, minY, width, height };
}

// Every parser message counts, warnings included: browsers show a broken image for any XML error,
// so being stricter than xmldom's defaults matches what the viewer would actually see.
function parseXml(svgText: string): { doc: Document | null; parserMessages: string[] } {
  const parserMessages: string[] = [];
  const parser = new DOMParser({
    onError: (level, message) => parserMessages.push(`${level}: ${firstLine(message)}`),
  });

  try {
    return { doc: parser.parseFromString(svgText, "image/svg+xml"), parserMessages };
  } catch (error) {
    // xmldom throws a ParseError on fatal errors; its message has already been collected above.
    if (parserMessages.length === 0) parserMessages.push(error instanceof Error ? firstLine(error.message) : String(error));
    return { doc: null, parserMessages };
  }
}

// xmldom appends a multi-line locator block; the first line is the useful part.
function firstLine(message: string): string {
  return message.split("\n")[0].trim();
}

function failure(detail: string): ParseOutcome {
  return { doc: null, detail };
}
