import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { isMain } from "../lib/io.js";
import { SYSTEM_PROMPT, tools } from "./agent.js";
import { generateGroundedAnswer } from "./generate.js";
import {
  checkGroundedness,
  extractDollarFigures,
  extractPercentageFigures,
  groupTraceRuns,
  sourceNumbers,
  type Figure,
  type TraceStep,
} from "./groundedness.js";

export const EVAL_MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-5";

export interface EvalQuestion {
  id: string;
  tier: string;
  category: string;
  question: string;
  expected_tools: string[];
  expected_answer: string;
  must_include: string[];
  must_not_include: string[];
  max_steps?: number;
  context?: Record<string, unknown>;
}

interface TrajectoryScore {
  passed: boolean;
  expectedTools: string[];
  calledTools: string[];
  missingTools: string[];
  unexpectedTools: string[];
  unavailableExpectedTools: string[];
  toolSteps: number;
  maxSteps?: number;
  withinStepLimit: boolean;
}

interface CoverageScore {
  passed: boolean;
  requiredFigures: Figure[];
  matchedRequiredFigures: Figure[];
  missingRequiredFigures: Figure[];
  optionalFigures: Figure[];
  matchedOptionalFigures: Figure[];
}

interface ContradictionScore {
  passed: boolean;
  contradictions: Figure[];
}

interface OracleScore {
  coverage: CoverageScore;
  contradiction: ContradictionScore;
}

export interface EvalScore {
  id: string;
  runId: string;
  question: string;
  passed: boolean;
  answer: {
    passed: boolean;
    characterCount: number;
  };
  trajectory: TrajectoryScore;
  groundedness: ReturnType<typeof checkGroundedness>;
  oracle: OracleScore;
  semanticReview: {
    mustInclude: string[];
    mustNotInclude: string[];
    automated: false;
  };
}

interface CliOptions {
  scoreOnly?: string;
  questionIds?: Set<string>;
  questionsPath: string;
  tracesPath: string;
  resultsPath: string;
}

function figureTolerance(figure: Figure): number {
  return Math.max(0.01, figure.roundingUnit / 2);
}

function sameOracleValue(expected: Figure, actual: Figure): boolean {
  if (expected.kind !== actual.kind) return false;
  const tolerance = Math.max(figureTolerance(expected), figureTolerance(actual));
  // Oracle coverage compares magnitudes because expected prose commonly states
  // "$X of debt" while answers may render the accounting sign as "-$X".
  return Math.abs(Math.abs(expected.value) - Math.abs(actual.value)) <= tolerance;
}

function uniqueFigures(texts: string[]): Figure[] {
  const figures = texts.flatMap((text) => [
    ...extractDollarFigures(text),
    ...extractPercentageFigures(text),
  ]);
  return figures.filter(
    (figure, index) =>
      figures.findIndex(
        (candidate) =>
          candidate.kind === figure.kind &&
          Math.abs(candidate.value - figure.value) <=
            Math.max(figureTolerance(candidate), figureTolerance(figure)),
      ) === index,
  );
}

const EXPRESSION_NUMBER_RE = /(?<![\w.])(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi;
const CALCULATOR_OPERAND_FIELDS = new Set(["amount", "priceUsd", "valueUsd"]);

function collectCalculatorOperands(value: unknown, into: number[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectCalculatorOperands(item, into));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (CALCULATOR_OPERAND_FIELDS.has(key)) {
      const parsed = Number(child);
      if (Number.isFinite(parsed)) into.push(parsed);
    }
    collectCalculatorOperands(child, into);
  }
}

function calculatorLineageEvidence(steps: TraceStep[]): Array<{ value: number }> {
  const trusted = sourceNumbers(steps)
    .filter(({ toolName }) => toolName !== "calculator")
    .map(({ value }) => value);
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName !== "calculator") collectCalculatorOperands(result.output, trusted);
    }
  }
  const questionPercentages = uniqueFigures([steps[0]?.question ?? ""])
    .filter(({ kind }) => kind === "percentage")
    .map(({ value }) => Math.abs(value));
  const matchesTrusted = (literal: number) =>
    [0, 1, 100, ...trusted].some(
      (value) => Math.abs(Math.abs(value) - Math.abs(literal)) <= 0.01,
    ) ||
    questionPercentages.some(
      (percentage) =>
        Math.abs(literal - percentage / 100) <= 1e-12 ||
        Math.abs(literal - (100 - percentage) / 100) <= 1e-12,
    );
  const validated: Array<{ value: number }> = [];
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName !== "calculator") continue;
      const input = result.input as { expression?: unknown } | undefined;
      const output = result.output as { result?: unknown } | undefined;
      if (typeof input?.expression !== "string") continue;
      const value = Number(output?.result);
      if (!Number.isFinite(value)) continue;
      const literals = [...input.expression.matchAll(EXPRESSION_NUMBER_RE)].map((match) =>
        Number(match[0]),
      );
      if (literals.every(matchesTrusted)) {
        validated.push({ value });
        trusted.push(value);
      }
    }
  }
  return validated;
}

export function scoreOracle(answer: string, question: EvalQuestion): OracleScore {
  const questionFigures = uniqueFigures([question.question]);
  const requiredFigures = uniqueFigures(question.must_include).filter(
    (expected) => !questionFigures.some((supplied) => sameOracleValue(expected, supplied)),
  );
  const optionalFigures = uniqueFigures([question.expected_answer]).filter(
    (expected) =>
      !questionFigures.some((supplied) => sameOracleValue(expected, supplied)) &&
      !requiredFigures.some((required) => sameOracleValue(expected, required)),
  );
  const answerFigures = uniqueFigures([answer]);
  const matchedRequiredFigures = requiredFigures.filter((expected) =>
    answerFigures.some((actual) => sameOracleValue(expected, actual)),
  );
  const missingRequiredFigures = requiredFigures.filter(
    (expected) => !matchedRequiredFigures.includes(expected),
  );
  const matchedOptionalFigures = optionalFigures.filter((expected) =>
    answerFigures.some((actual) => sameOracleValue(expected, actual)),
  );
  return {
    coverage: {
      passed: missingRequiredFigures.length === 0,
      requiredFigures,
      matchedRequiredFigures,
      missingRequiredFigures,
      optionalFigures,
      matchedOptionalFigures,
    },
    contradiction: { passed: true, contradictions: [] },
  };
}

export function scoreContradictions(
  answer: string,
  steps: TraceStep[],
  question: EvalQuestion,
  oracle = scoreOracle(answer, question),
): ContradictionScore {
  const acceptedFigures = [
    ...oracle.coverage.requiredFigures,
    ...oracle.coverage.optionalFigures,
    ...uniqueFigures([question.question]),
  ];
  const trustedEvidence = sourceNumbers(steps).filter(({ toolName }) => toolName !== "calculator");
  const calculatorEvidence = calculatorLineageEvidence(steps);
  const contradictions = uniqueFigures([answer]).filter(
    (actual) =>
      !acceptedFigures.some((expected) => sameOracleValue(expected, actual)) &&
      !trustedEvidence.some(
        (evidence) =>
          evidence.kinds.includes(actual.kind) &&
          Math.abs(Math.abs(evidence.value) - Math.abs(actual.value)) <= figureTolerance(actual),
      ) &&
      !calculatorEvidence.some(
        ({ value }) =>
          Math.abs(Math.abs(value) - Math.abs(actual.value)) <= figureTolerance(actual),
      ),
  );
  return { passed: contradictions.length === 0, contradictions };
}

export function scoreTrajectory(steps: TraceStep[], question: EvalQuestion): TrajectoryScore {
  const calledTools = [
    ...new Set(
      steps.flatMap((step) =>
        (step.toolCalls ?? []).flatMap((call) =>
          typeof call.toolName === "string" ? [call.toolName] : [],
        ),
      ),
    ),
  ];
  const missingTools = question.expected_tools.filter(
    (toolName) => !calledTools.includes(toolName),
  );
  const unexpectedTools = calledTools.filter(
    (toolName) => !question.expected_tools.includes(toolName),
  );
  const availableTools = new Set(Object.keys(tools));
  const unavailableExpectedTools = question.expected_tools.filter(
    (toolName) => !availableTools.has(toolName),
  );
  const toolSteps = steps.filter((step) => (step.toolCalls?.length ?? 0) > 0).length;
  const withinStepLimit = question.max_steps == null || toolSteps <= question.max_steps;
  return {
    passed: missingTools.length === 0 && unexpectedTools.length === 0 && withinStepLimit,
    expectedTools: question.expected_tools,
    calledTools,
    missingTools,
    unexpectedTools,
    unavailableExpectedTools,
    toolSteps,
    maxSteps: question.max_steps,
    withinStepLimit,
  };
}

export function scoreRun(runId: string, steps: TraceStep[], question: EvalQuestion): EvalScore {
  const answer = [...steps].reverse().find((step) => step.text?.trim())?.text ?? "";
  const answerScore = { passed: answer.trim().length > 0, characterCount: answer.length };
  const trajectory = scoreTrajectory(steps, question);
  const groundedness = checkGroundedness(answer, steps);
  const oracle = scoreOracle(answer, question);
  oracle.contradiction = scoreContradictions(answer, steps, question, oracle);
  return {
    id: question.id,
    runId,
    question: question.question,
    passed:
      answerScore.passed && trajectory.passed && groundedness.passed && oracle.contradiction.passed,
    answer: answerScore,
    trajectory,
    groundedness,
    oracle,
    semanticReview: {
      mustInclude: question.must_include,
      mustNotInclude: question.must_not_include,
      automated: false,
    },
  };
}

async function readQuestions(path: string): Promise<EvalQuestion[]> {
  return (await readFile(path, "utf8"))
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as EvalQuestion);
}

export async function runQuestion(
  question: EvalQuestion,
): Promise<{ runId: string; steps: TraceStep[] }> {
  const runId = crypto.randomUUID();
  const content = question.context
    ? `${question.question}\n\nContext: ${JSON.stringify(question.context)}`
    : question.question;
  const messages = [{ role: "user" as const, content }];
  const result = await generateGroundedAnswer({
    runId,
    question: question.question,
    messages,
    generate: async (generationMessages) =>
      generateText({
        model: anthropic(EVAL_MODEL),
        tools,
        // Question max_steps is an evaluation constraint, not a generation cutoff.
        // Stopping on it can strand the model after tool results with no final text.
        stopWhen: stepCountIs(10),
        system: SYSTEM_PROMPT,
        messages: generationMessages,
      }),
  });
  return { runId, steps: result.steps };
}

function mark(value: boolean): string {
  return value ? "PASS" : "FAIL";
}

function printTable(scores: EvalScore[]): void {
  const rows = scores.map((score) => [
    score.id,
    mark(score.answer.passed),
    mark(score.trajectory.passed),
    mark(score.groundedness.passed),
    mark(score.oracle.contradiction.passed),
    mark(score.oracle.coverage.passed),
    mark(score.passed),
  ]);
  const headers = [
    "ID",
    "ANSWER",
    "TRAJECTORY",
    "GROUNDED",
    "CONTRADICTION",
    "COVERAGE",
    "OVERALL",
  ];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length)),
  );
  console.log(headers.map((header, index) => header.padEnd(widths[index]!)).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(row.map((cell, index) => cell.padEnd(widths[index]!)).join("  "));
  }
  console.log(`\n${scores.filter((score) => score.passed).length}/${scores.length} passed`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    questionsPath: "questions.jsonl",
    tracesPath: "eval-traces.jsonl",
    resultsPath: "eval-results.jsonl",
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const value = argv[index + 1];
    if (argument === "--score-only" && value) {
      options.scoreOnly = value;
      index++;
    } else if (argument === "--questions" && value) {
      options.questionIds = new Set(value.split(","));
      index++;
    } else if (argument === "--traces" && value) {
      options.tracesPath = value;
      index++;
    } else if (argument === "--results" && value) {
      options.resultsPath = value;
      index++;
    } else if (argument === "--questions-file" && value) {
      options.questionsPath = value;
      index++;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const allQuestions = await readQuestions(options.questionsPath);
  const questions = options.questionIds
    ? allQuestions.filter((question) => options.questionIds!.has(question.id))
    : allQuestions;
  const byText = new Map(allQuestions.map((question) => [question.question, question]));
  const scores: EvalScore[] = [];
  const traceLines: string[] = [];

  if (options.scoreOnly) {
    const runs = groupTraceRuns(await readFile(options.scoreOnly, "utf8"));
    for (const [runId, steps] of runs) {
      const question = byText.get(steps[0]?.question ?? "");
      if (!question || (options.questionIds && !options.questionIds.has(question.id))) continue;
      scores.push(scoreRun(runId, steps, question));
    }
  } else {
    for (const [index, question] of questions.entries()) {
      console.error(`[${index + 1}/${questions.length}] ${question.id}: ${question.question}`);
      const run = await runQuestion(question);
      for (const step of run.steps) traceLines.push(JSON.stringify(step));
      scores.push(scoreRun(run.runId, run.steps, question));
    }
    await writeFile(options.tracesPath, `${traceLines.join("\n")}\n`);
  }

  await writeFile(
    options.resultsPath,
    `${scores.map((score) => JSON.stringify(score)).join("\n")}\n`,
  );
  printTable(scores);
  if (scores.some((score) => !score.passed)) process.exitCode = 1;
}

if (isMain(import.meta.url)) await main();
