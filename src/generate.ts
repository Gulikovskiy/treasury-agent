import type { ModelMessage } from "ai";
import { checkGroundedness, type TraceStep } from "./groundedness.js";

export const GROUNDING_FALLBACK =
  "I couldn't produce an answer whose derived figures were fully supported by the available tool outputs.";

interface GenerationResult {
  text: string;
  steps: unknown[];
  responseMessages: ModelMessage[];
}

interface GenerateGroundedOptions {
  runId: string;
  question: string;
  messages: ModelMessage[];
  generate: (messages: ModelMessage[]) => Promise<GenerationResult>;
}

export interface GuardrailTraceStep extends TraceStep {
  guardrail?: {
    status: "repair_requested" | "repaired" | "rejected";
    unverified: string[];
    signMismatches: string[];
    missingAnswer: boolean;
  };
}

function traceRecords(
  runId: string,
  question: string,
  rawSteps: unknown[],
  offset = 0,
): GuardrailTraceStep[] {
  return rawSteps.map((rawStep, index) => {
    const value = rawStep as {
      toolCalls?: TraceStep["toolCalls"];
      toolResults?: TraceStep["toolResults"];
      text?: string;
    };
    return {
      runId,
      question,
      step: offset + index,
      toolCalls: value.toolCalls ?? [],
      toolResults: value.toolResults ?? [],
      text: value.text ?? "",
    };
  });
}

function issues(answer: string, steps: TraceStep[]) {
  const result = checkGroundedness(answer, steps);
  return {
    passed: answer.trim().length > 0 && result.passed,
    missingAnswer: answer.trim().length === 0,
    unverified: result.unverified.map(({ raw }) => raw),
    signMismatches: result.signMismatches.map(({ figure }) => figure.raw),
  };
}

function repairInstruction(problem: ReturnType<typeof issues>): string {
  const details = [
    problem.missingAnswer ? "No final answer was produced." : undefined,
    problem.unverified.length > 0
      ? `Unsupported figures: ${problem.unverified.join(", ")}.`
      : undefined,
    problem.signMismatches.length > 0
      ? `Sign mismatches: ${problem.signMismatches.join(", ")}.`
      : undefined,
  ].filter(Boolean);
  return [
    "Revise the answer before it is returned to the user.",
    ...details,
    "For every derived figure you keep, call the calculator and use its result; otherwise omit the figure.",
    "Return a complete final answer after any tool calls.",
  ].join(" ");
}

function guardrailMetadata(
  status: NonNullable<GuardrailTraceStep["guardrail"]>["status"],
  problem: ReturnType<typeof issues>,
): NonNullable<GuardrailTraceStep["guardrail"]> {
  return {
    status,
    unverified: problem.unverified,
    signMismatches: problem.signMismatches,
    missingAnswer: problem.missingAnswer,
  };
}

export async function generateGroundedAnswer({
  runId,
  question,
  messages,
  generate,
}: GenerateGroundedOptions): Promise<{ text: string; steps: GuardrailTraceStep[] }> {
  const initial = await generate(messages);
  const initialSteps = traceRecords(runId, question, initial.steps);
  const initialIssues = issues(initial.text, initialSteps);
  if (initialIssues.passed) return { text: initial.text, steps: initialSteps };

  if (initialSteps.length > 0) {
    initialSteps.at(-1)!.guardrail = guardrailMetadata("repair_requested", initialIssues);
  }
  const repaired = await generate([
    ...messages,
    ...initial.responseMessages,
    { role: "user", content: repairInstruction(initialIssues) },
  ]);
  const repairedSteps = traceRecords(runId, question, repaired.steps, initialSteps.length);
  const allSteps = [...initialSteps, ...repairedSteps];
  const repairedIssues = issues(repaired.text, allSteps);
  if (repairedIssues.passed) {
    if (repairedSteps.length > 0) {
      repairedSteps.at(-1)!.guardrail = guardrailMetadata("repaired", repairedIssues);
    }
    return { text: repaired.text, steps: allSteps };
  }

  if (repairedSteps.length > 0) {
    repairedSteps.at(-1)!.guardrail = guardrailMetadata("rejected", repairedIssues);
  }
  allSteps.push({
    runId,
    question,
    step: allSteps.length,
    toolCalls: [],
    toolResults: [],
    text: GROUNDING_FALLBACK,
    guardrail: guardrailMetadata("rejected", repairedIssues),
  });
  return { text: GROUNDING_FALLBACK, steps: allSteps };
}
