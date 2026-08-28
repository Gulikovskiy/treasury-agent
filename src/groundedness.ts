import { readFile } from "node:fs/promises";
import { isMain } from "../lib/io.js";

export interface TraceStep {
  runId: string;
  question?: string;
  step: number;
  toolCalls?: Array<{ toolName?: string; [key: string]: unknown }>;
  toolResults?: Array<{ toolName?: string; output?: unknown }>;
  text?: string;
  generation?: {
    attempt: "initial" | "repair";
    elapsedMs: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  guardrail?: {
    status: "repair_requested" | "repaired" | "rejected";
    unverified: string[];
    signMismatches: string[];
    missingAnswer: boolean;
  };
}

export type FigureKind = "dollar" | "percentage";
export interface Figure {
  kind: FigureKind;
  raw: string;
  value: number;
  roundingUnit: number;
  signExplicit: boolean;
}
export interface SignMismatch {
  figure: Figure;
  source: number;
}
export interface Evidence {
  kinds: FigureKind[];
  value: number;
  toolName: string;
  field: string;
  path: string;
  signSensitive?: boolean;
}
export interface VerifiedFigure {
  figure: Figure;
  evidence: Evidence;
}
export interface GroundednessResult {
  passed: boolean;
  figures: Figure[];
  verified: VerifiedFigure[];
  unverified: Figure[];
  signMismatches: SignMismatch[];
}

const SIGN = "[+\\-−‑]";
const NUMBER = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const DOLLAR_RE = new RegExp(
  `(?<accounting>\\()?\\s*(?<leadingSign>${SIGN})?\\s*\\$\\s*(?<trailingSign>${SIGN})?\\s*` +
    `(?<amount>${NUMBER})(?:\\s*(?<scale>k|m|b|thousand|million|billion)\\b)?\\s*(?<close>\\))?`,
  "gi",
);
const PERCENT_RE = new RegExp(
  `(?<sign>${SIGN})?\\s*(?<amount>${NUMBER})\\s*(?:%|percent\\b)`,
  "gi",
);
const NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const DOLLAR_FIELDS = new Set(["valueUsd", "priceUsd"]);
const PERCENT_FIELDS = new Set(["percent", "percentage", "percentOfNav"]);

function scaleFor(suffix: string | undefined): number {
  if (["k", "thousand"].includes(suffix?.toLowerCase() ?? "")) return 1_000;
  if (["m", "million"].includes(suffix?.toLowerCase() ?? "")) return 1_000_000;
  if (["b", "billion"].includes(suffix?.toLowerCase() ?? "")) return 1_000_000_000;
  return 1;
}

function displayedUnit(amount: string, scale: number): number {
  return 10 ** -(amount.split(".")[1]?.length ?? 0) * scale;
}

function isNegative(sign: string | undefined): boolean {
  return sign === "-" || sign === "−" || sign === "‑";
}

export function extractDollarFigures(text: string): Figure[] {
  return [...text.matchAll(DOLLAR_RE)].map((match) => {
    const groups = match.groups!;
    const scale = scaleFor(groups.scale);
    const sign = groups.leadingSign ?? groups.trailingSign;
    const negative = isNegative(sign);
    const magnitude = Number(groups.amount!.replaceAll(",", "")) * scale;
    return {
      kind: "dollar",
      raw: match[0].trim(),
      value: negative ? -magnitude : magnitude,
      roundingUnit: displayedUnit(groups.amount!, scale),
      signExplicit: sign !== undefined,
    };
  });
}

export function extractPercentageFigures(text: string): Figure[] {
  return [...text.matchAll(PERCENT_RE)].map((match) => {
    const groups = match.groups!;
    const previousCharacter = text.slice(0, match.index).trimEnd().at(-1);
    const binaryOperator = groups.sign !== undefined && /[\d%)]/.test(previousCharacter ?? "");
    const magnitude = Number(groups.amount!.replaceAll(",", ""));
    return {
      kind: "percentage",
      raw: match[0].trim(),
      value: isNegative(groups.sign) && !binaryOperator ? -magnitude : magnitude,
      roundingUnit: displayedUnit(groups.amount!, 1),
      signExplicit: groups.sign !== undefined && !binaryOperator,
    };
  });
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !NUMERIC_RE.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function collectFieldEvidence(
  value: unknown,
  toolName: string,
  into: Evidence[],
  path: string[] = [],
): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectFieldEvidence(item, toolName, into, [...path, String(index)]);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const parsed = parseNumeric(child);
    const childPath = [...path, key];
    if (parsed !== undefined && DOLLAR_FIELDS.has(key)) {
      into.push({
        kinds: ["dollar"],
        value: parsed,
        toolName,
        field: key,
        path: childPath.join("."),
      });
    }
    if (parsed !== undefined && PERCENT_FIELDS.has(key)) {
      into.push({
        kinds: ["percentage"],
        value: parsed,
        toolName,
        field: key,
        path: childPath.join("."),
      });
    }
    collectFieldEvidence(child, toolName, into, childPath);
  }
}

export function sourceNumbers(steps: TraceStep[]): Evidence[] {
  const evidence: Evidence[] = [];
  const question = steps.find(({ question: text }) => text)?.question ?? "";
  for (const figure of [...extractDollarFigures(question), ...extractPercentageFigures(question)]) {
    evidence.push({
      kinds: [figure.kind],
      value: figure.value,
      toolName: "user",
      field: "question",
      path: "question",
      signSensitive: false,
    });
  }
  for (const value of [0, 100]) {
    evidence.push({
      kinds: ["percentage"],
      value,
      toolName: "constant",
      field: "percentage",
      path: "percentage",
      signSensitive: false,
    });
  }
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      // Only tool output is evidence. Inputs and calculator expressions are not.
      if (result.toolName === "calculator") {
        const output = result.output as { result?: unknown } | undefined;
        const parsed = parseNumeric(output?.result);
        if (parsed !== undefined) {
          evidence.push({
            kinds: ["dollar", "percentage"],
            value: parsed,
            toolName: "calculator",
            field: "result",
            path: "result",
          });
        }
      } else {
        collectFieldEvidence(result.output, result.toolName ?? "unknown", evidence);
      }
    }
  }
  return evidence;
}

function toleranceFor(figure: Figure): number {
  // Respect the precision the answer actually displayed. This accepts cents,
  // whole-dollar rounding, and compact forms such as "$36.7 million" without
  // allowing a nearby token amount to verify an independently stated USD value.
  return Math.max(0.01, figure.roundingUnit / 2);
}

export function checkGroundedness(answer: string, steps: TraceStep[]): GroundednessResult {
  const figures = [...extractDollarFigures(answer), ...extractPercentageFigures(answer)];
  const evidence = sourceNumbers(steps);
  const verified: VerifiedFigure[] = [];
  const unverified: Figure[] = [];
  const signMismatches: SignMismatch[] = [];
  for (const figure of figures) {
    const candidates = evidence.filter((item) => item.kinds.includes(figure.kind));
    const tolerance = toleranceFor(figure);
    const match = candidates.find((item) =>
      figure.signExplicit && item.signSensitive !== false
        ? Math.abs(item.value - figure.value) <= tolerance
        : Math.abs(Math.abs(item.value) - figure.value) <= tolerance,
    );
    if (match) {
      verified.push({ figure, evidence: match });
      continue;
    }
    const opposite = figure.signExplicit
      ? candidates.find(
          (item) =>
            Math.sign(item.value) !== Math.sign(figure.value) &&
            Math.abs(Math.abs(item.value) - Math.abs(figure.value)) <= tolerance,
        )
      : undefined;
    if (opposite) signMismatches.push({ figure, source: opposite.value });
    else unverified.push(figure);
  }
  return {
    passed: unverified.length === 0 && signMismatches.length === 0,
    figures,
    verified,
    unverified,
    signMismatches,
  };
}

export const checkDollarGroundedness = checkGroundedness;

export function groupTraceRuns(lines: string): Map<string, TraceStep[]> {
  const runs = new Map<string, TraceStep[]>();
  for (const [index, line] of lines.split("\n").entries()) {
    if (!line.trim()) continue;
    const step = JSON.parse(line) as TraceStep;
    if (!step.runId || !Number.isInteger(step.step))
      throw new Error(`Invalid trace record on line ${index + 1}`);
    const run = runs.get(step.runId) ?? [];
    run.push(step);
    runs.set(step.runId, run);
  }
  for (const run of runs.values()) run.sort((a, b) => a.step - b.step);
  return runs;
}

async function main(): Promise<void> {
  const runs = groupTraceRuns(await readFile(process.argv[2] ?? "traces.jsonl", "utf8"));
  let failed = false;
  for (const [runId, steps] of runs) {
    const answer = [...steps].reverse().find((step) => step.text?.trim())?.text ?? "";
    const result = checkGroundedness(answer, steps);
    console.log(
      JSON.stringify({
        runId,
        question: steps[0]?.question,
        passed: result.passed,
        figures: result.figures.length,
        verified: result.verified,
        unverified: result.unverified,
        signMismatches: result.signMismatches,
      }),
    );
    failed ||= !result.passed;
  }
  if (failed) process.exitCode = 1;
}

if (isMain(import.meta.url)) await main();
