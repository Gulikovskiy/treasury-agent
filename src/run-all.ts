import "dotenv/config";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { FIXTURE_DIR } from "../config.js";
import { isMain } from "../lib/io.js";
import { POSITION_FIELDS } from "../tools/treasury.js";
import { SYSTEM_PROMPT } from "./agent.js";
import { groupTraceRuns } from "./groundedness.js";
import { EVAL_MODEL, runQuestion, scoreRun, type EvalQuestion } from "./eval.js";

const execFileAsync = promisify(execFile);

interface Options {
  questionsPath: string;
  runsDir: string;
  samplesPerQuestion: number;
}

interface SweepManifest {
  sweepId: string;
  createdAt: string;
  completedAt?: string;
  status: "running" | "complete" | "complete_with_errors";
  gitSha: string;
  gitDirty: boolean;
  gitDiffSha256: string;
  model: string;
  systemPromptSha256: string;
  systemPrompt: string;
  toolFields: readonly string[];
  fixtureId: string;
  questionSetSha256: string;
  questionIds: string[];
  questionCount: number;
  samplesPerQuestion: number;
  requestedSamples: number;
}

interface FailedSample {
  id: string;
  sample: number;
  error: string;
}

interface ScoredSample {
  id: string;
  sample: number;
  runId: string;
  passed: boolean;
  answer: {
    passed: boolean;
    characterCount: number;
  };
  trajectory: {
    passed: boolean;
    missingTools: string[];
    unexpectedTools: string[];
    unavailableExpectedTools: string[];
    toolSteps: number;
    maxSteps?: number;
  };
  groundedness: {
    passed: boolean;
    figureCount: number;
    unverified: Array<{ raw: string; kind: string; value: number }>;
    signMismatches: Array<{ raw: string; source: number }>;
  };
  oracle: {
    passed: boolean;
    expectedFigureCount: number;
    missingFigures: Array<{ raw: string; kind: string; value: number }>;
  };
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    questionsPath: "questions.jsonl",
    runsDir: "runs",
    samplesPerQuestion: 1,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const value = argv[index + 1];
    if (argument === "--questions-file" && value) {
      options.questionsPath = value;
      index++;
    } else if (argument === "--runs-dir" && value) {
      options.runsDir = value;
      index++;
    } else if (argument === "--samples" && value) {
      options.samplesPerQuestion = Number(value);
      index++;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (!Number.isInteger(options.samplesPerQuestion) || options.samplesPerQuestion < 1) {
    throw new Error("--samples must be a positive integer");
  }
  return options;
}

export function sweepId(date = new Date()): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function gitMetadata(): Promise<{
  gitSha: string;
  gitDirty: boolean;
  gitDiffSha256: string;
}> {
  try {
    const [{ stdout: sha }, { stdout: status }, { stdout: diff }, { stdout: untracked }] =
      await Promise.all([
        execFileAsync("git", ["rev-parse", "--short", "HEAD"]),
        execFileAsync("git", ["status", "--porcelain"]),
        execFileAsync("git", ["diff", "--binary", "HEAD", "--", ".", ":(exclude)runs"]),
        execFileAsync("git", [
          "ls-files",
          "--others",
          "--exclude-standard",
          "--",
          ".",
          ":(exclude)runs",
        ]),
      ]);
    const hash = createHash("sha256").update(diff);
    const untrackedPaths = untracked.split("\n").filter(Boolean).sort();
    for (const path of untrackedPaths) {
      hash.update(`\0${path}\0`);
      hash.update(await readFile(path));
    }
    return {
      gitSha: sha.trim(),
      gitDirty: status.trim().length > 0,
      gitDiffSha256: hash.digest("hex"),
    };
  } catch {
    return { gitSha: "unknown", gitDirty: true, gitDiffSha256: "unknown" };
  }
}

function parseQuestions(contents: string): EvalQuestion[] {
  return contents
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as EvalQuestion);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function compactScore(
  id: string,
  sample: number,
  score: ReturnType<typeof scoreRun>,
): ScoredSample {
  return {
    id,
    sample,
    runId: score.runId,
    passed: score.passed,
    answer: score.answer,
    trajectory: {
      passed: score.trajectory.passed,
      missingTools: score.trajectory.missingTools,
      unexpectedTools: score.trajectory.unexpectedTools,
      unavailableExpectedTools: score.trajectory.unavailableExpectedTools,
      toolSteps: score.trajectory.toolSteps,
      maxSteps: score.trajectory.maxSteps,
    },
    groundedness: {
      passed: score.groundedness.passed,
      figureCount: score.groundedness.figures.length,
      unverified: score.groundedness.unverified.map(({ raw, kind, value }) => ({
        raw,
        kind,
        value,
      })),
      signMismatches: score.groundedness.signMismatches.map(({ figure, source }) => ({
        raw: figure.raw,
        source,
      })),
    },
    oracle: {
      passed: score.oracle.passed,
      expectedFigureCount: score.oracle.expectedFigures.length,
      missingFigures: score.oracle.missingFigures.map(({ raw, kind, value }) => ({
        raw,
        kind,
        value,
      })),
    },
  };
}

export async function runAll(options: Options): Promise<string> {
  const questionContents = await readFile(options.questionsPath, "utf8");
  const questions = parseQuestions(questionContents);
  const id = sweepId();
  const runDir = resolve(options.runsDir, id);
  await mkdir(resolve(options.runsDir), { recursive: true });
  await mkdir(runDir, { recursive: false });

  const manifestPath = join(runDir, "manifest.json");
  const tracesPath = join(runDir, "traces.jsonl");
  const scoresPath = join(runDir, "scores.json");
  const git = await gitMetadata();
  const manifest: SweepManifest = {
    sweepId: id,
    createdAt: new Date().toISOString(),
    status: "running",
    ...git,
    model: EVAL_MODEL,
    systemPromptSha256: sha256(SYSTEM_PROMPT),
    systemPrompt: SYSTEM_PROMPT,
    toolFields: POSITION_FIELDS,
    fixtureId: basename(resolve(FIXTURE_DIR)),
    questionSetSha256: sha256(questionContents),
    questionIds: questions.map(({ id: questionId }) => questionId),
    questionCount: questions.length,
    samplesPerQuestion: options.samplesPerQuestion,
    requestedSamples: questions.length * options.samplesPerQuestion,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(tracesPath, "", { flag: "wx" });

  const scored: ScoredSample[] = [];
  const failed: FailedSample[] = [];
  const total = questions.length * options.samplesPerQuestion;
  let current = 0;
  for (const question of questions) {
    for (let sample = 1; sample <= options.samplesPerQuestion; sample++) {
      current++;
      console.error(`[${current}/${total}] ${question.id} sample ${sample}`);
      try {
        const { runId, steps } = await runQuestion(question);
        await appendFile(tracesPath, `${steps.map((step) => JSON.stringify(step)).join("\n")}\n`);
        scored.push(compactScore(question.id, sample, scoreRun(runId, steps, question)));
        console.error(`saved ${question.id} sample ${sample} (${runId})`);
      } catch (error) {
        const message = errorMessage(error);
        failed.push({ id: question.id, sample, error: message });
        console.error(`failed ${question.id} sample ${sample}: ${message}`);
      }
    }
  }

  const passed = scored.filter(({ passed: samplePassed }) => samplePassed).length;
  const traceRuns = groupTraceRuns(await readFile(tracesPath, "utf8"));
  const scoredRunIds = new Set(scored.map(({ runId }) => runId));
  const unexpectedRunIds = [...traceRuns.keys()].filter((runId) => !scoredRunIds.has(runId));
  const missingRunIds = [...scoredRunIds].filter((runId) => !traceRuns.has(runId));
  if (unexpectedRunIds.length > 0 || missingRunIds.length > 0) {
    throw new Error(
      `Sweep trace integrity failure: unexpected=${unexpectedRunIds.join(",") || "none"}; ` +
        `missing=${missingRunIds.join(",") || "none"}`,
    );
  }
  const scores = {
    sweepId: id,
    summary: {
      requestedSamples: total,
      completedSamples: scored.length,
      failedSamples: failed.length,
      passedSamples: passed,
      passRate: scored.length === 0 ? null : passed / scored.length,
      trajectoryPassed: scored.filter(({ trajectory }) => trajectory.passed).length,
      answerPresent: scored.filter(({ answer }) => answer.passed).length,
      groundednessPassed: scored.filter(({ groundedness }) => groundedness.passed).length,
      oraclePassed: scored.filter(({ oracle }) => oracle.passed).length,
    },
    samples: scored,
    errors: failed,
  };
  await writeFile(scoresPath, `${JSON.stringify(scores, null, 2)}\n`);
  manifest.completedAt = new Date().toISOString();
  manifest.status = failed.length === 0 ? "complete" : "complete_with_errors";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${passed}/${scored.length} completed samples passed`);
  console.log(runDir);
  return runDir;
}

if (isMain(import.meta.url)) await runAll(parseArgs(process.argv.slice(2)));
