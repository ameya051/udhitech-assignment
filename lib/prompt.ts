// Builds the messages we send to the model: the system prompt, the first request, and the
// retry conversation that tells the model which checks failed. Called by lib/pipeline.ts.
// Pure functions only, so the exact prompts are easy to read and test.

import type { ChatMessage, CheckResult, Concept } from "./types";

// Each rule matches a check (or a browser behaviour) so the model knows what we will test.
export const SYSTEM_PROMPT = `You draw animated educational SVG diagrams for UK GCSE students.
Reply with ONE complete SVG document and nothing else: no markdown fences, no explanation.

Rules:
- Root element: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">. Use exactly this viewBox. Do not set width or height.
- The first child must be a <title> naming the concept.
- Include at least 3 <text> labels. Use the exact scientific terms from the description (UK spelling).
- Keep every shape and label fully inside the viewBox with at least 20 units of margin. Do not translate or scale content outside it. Leave room for long labels near the edges.
- Include at least one looping animation: SMIL (<animate>, <animateTransform>, <animateMotion>) with repeatCount="indefinite", or CSS @keyframes in a <style> element.
- The SVG must be valid XML: escape "&" as &amp; and "<" in text as &lt;.
- Never use <script>, on* event attributes, <foreignObject>, <image>, external links, or external fonts.
- Use font-family="Arial, Helvetica, sans-serif" and font-size of at least 16.
- The diagram must be scientifically accurate, clear, and high contrast on a white background.`;

export function firstUserMessage(concept: Concept): string {
  return `Concept: ${concept.name} (${concept.subject}).\nDescription: ${concept.text}`;
}

export function buildFirstAttempt(concept: Concept): ChatMessage[] {
  return [{ role: "user", content: firstUserMessage(concept) }];
}

// The model sees its own previous reply, then a list of exactly what our checks found wrong.
export function buildRetryConversation(
  concept: Concept,
  previousReply: string,
  checks: CheckResult[],
): ChatMessage[] {
  const failureLines = describeFailures(checks).map((check) => `- ${check.id}: ${check.detail}`);
  const fixRequest = [
    "Your SVG failed these checks:",
    ...failureLines,
    "Fix every problem and reply with the full corrected SVG only.",
  ].join("\n");

  return [
    { role: "user", content: firstUserMessage(concept) },
    { role: "assistant", content: previousReply },
    { role: "user", content: fixRequest },
  ];
}

// When parsing failed, every other check only says "Skipped", which tells the model nothing.
// In that case the parse error is the one thing worth fixing.
function describeFailures(checks: CheckResult[]): CheckResult[] {
  const failed = checks.filter((check) => !check.passed);
  const parseFailure = failed.find((check) => check.id === "parse");
  return parseFailure ? [parseFailure] : failed;
}
