// Small DOM helpers shared by the checks: walking elements, reading text, styles and hrefs.

import type { Document, Element } from "@xmldom/xmldom";

// The SMIL animation elements, in the order the animation check reports them.
export const SMIL_ELEMENTS = ["animate", "animateTransform", "animateMotion", "set"];

const ELEMENT_NODE = 1; // DOM nodeType for elements (text and comments are skipped)

export function childElements(parent: Element): Element[] {
  const elements: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index++) {
    const node = parent.childNodes[index];
    if (node.nodeType === ELEMENT_NODE) elements.push(node as Element);
  }
  return elements;
}

// null at the root, whose parent is the document.
export function parentElement(element: Element): Element | null {
  const parent = element.parentNode;
  return parent && parent.nodeType === ELEMENT_NODE ? (parent as Element) : null;
}

// textContent with whitespace runs collapsed; includes nested <tspan> text.
export function normalisedText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

// Every <style> block's text, joined.
export function styleSheetText(doc: Document): string {
  return Array.from(doc.getElementsByTagName("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

// The id an href="#id" (or xlink:href) points at, or null if it isn't a same-document reference.
export function hrefId(element: Element): string | null {
  const href = element.getAttribute("href") ?? element.getAttribute("xlink:href") ?? "";
  return href.startsWith("#") && href.length > 1 ? href.slice(1) : null;
}
