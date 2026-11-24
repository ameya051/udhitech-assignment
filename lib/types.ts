// Shared types for the whole app. Every other file imports its shapes from here.

import type { Document } from "@xmldom/xmldom";

export type ConceptId =
  | "pythagoras"
  | "circle-parts"
  | "series-circuit"
  | "photosynthesis"
  | "states-of-matter";

export interface Concept {
  id: ConceptId;
  name: string;
  subject: "Maths" | "Physics" | "Biology" | "Chemistry";
  text: string; // exact text from the brief, sent to the model as-is
  keyTerms: string[][]; // each inner array = one required term + its accepted spellings
}

export type CheckId = "parse" | "bounds" | "labels" | "animation";

export interface CheckResult {
  id: CheckId;
  name: string; // human label shown in the table
  passed: boolean;
  detail: string; // why it failed (sent back to the model on retry), or a short OK note
}

// What every check after `parse` receives. `doc` is always a parsed <svg> with a valid viewBox.
export interface CheckContext {
  doc: Document;
  svgText: string;
  concept: Concept;
}

// One entry in the CHECKS list (lib/checks/index.ts). `run` is a pure function.
export interface SvgCheck {
  id: CheckId;
  name: string;
  run: (context: CheckContext) => { passed: boolean; detail: string };
}

// One turn of the conversation we send to the model. The system prompt is passed separately.
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AttemptLog {
  attempt: number; // 1 or 2
  inputTokens: number;
  outputTokens: number; // includes reasoning tokens
  apiRetries: number; // 429/503 retries during this attempt
  failedChecks: CheckId[];
}

export interface DiagramResult {
  conceptId: ConceptId;
  concept: string;
  subject: string;
  model: string;
  status: "pass" | "fail" | "error";
  svg: string | null;
  checks: CheckResult[];
  retries: number; // check-failure retries: 0 or 1
  apiRetries: number; // total 429/503 retries across attempts
  inputTokens: number; // summed across attempts
  outputTokens: number; // summed across attempts, includes reasoning
  reasoningTokens: number; // summed, shown separately for honesty
  costUsd: number; // estimated from tokens x list price, see cost.ts
  actualCostUsd: number | null; // summed usage.cost reported by OpenRouter (null if missing)
  durationMs: number;
  generatedAt: string; // ISO timestamp
  attempts: AttemptLog[];
  error?: string; // only when status === "error"
}

export interface ResultsFile {
  generatedAt: string;
  results: DiagramResult[];
}
