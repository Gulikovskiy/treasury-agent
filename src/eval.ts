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

interface OracleScore {
  passed: boolean;
  expectedFigures: Figure[];
  matchedFigures: Figure[];
  missingFigures: Figure[];
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

export function scoreOracle(answer: string, question: EvalQuestion): OracleScore {
  const expectedFigures = uniqueFigures([question.expected_answer, ...question.must_include]);
  const answerFigures = uniqueFigures([answer]);
  const matchedFigures = expectedFigures.filter((expected) =>
    answerFigures.some((actual) => sameOracleValue(expected, actual)),
  );
  const missingFigures = expectedFigures.filter((expected) => !matchedFigures.includes(expected));
  return {
    passed: missingFigures.length === 0,
    expectedFigures,
    matchedFigures,
    missingFigures,
  };
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
  return {
    id: question.id,
    runId,
    question: question.question,
    passed: answerScore.passed && trajectory.passed && groundedness.passed && oracle.passed,
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
    mark(score.oracle.passed),
    mark(score.passed),
  ]);
  const headers = ["ID", "ANSWER", "TRAJECTORY", "GROUNDED", "ORACLE", "OVERALL"];
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
