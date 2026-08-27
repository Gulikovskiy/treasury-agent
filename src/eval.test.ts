import { describe, expect, it } from "vitest";
import { scoreOracle, scoreRun, scoreTrajectory, type EvalQuestion } from "./eval.js";
import type { TraceStep } from "./groundedness.js";

const question: EvalQuestion = {
  id: "q-test",
  tier: "easy",
  category: "standard",
  question: "Test question",
  expected_tools: ["getPositions", "calculator"],
  expected_answer: "NAV is $36,659,437.35 and AAVE is 89.09% of NAV.",
  must_include: ["NAV $36,659,437.35", "AAVE concentration 89.09%"],
  must_not_include: ["investment recommendation"],
  max_steps: 2,
};

const steps: TraceStep[] = [
  {
    runId: "run",
    question: question.question,
    step: 0,
    toolCalls: [{ toolName: "getPositions" }],
    toolResults: [
      {
        toolName: "getPositions",
        output: { positions: [{ valueUsd: "32658754.64" }] },
      },
    ],
  },
  {
    runId: "run",
    question: question.question,
    step: 1,
    toolCalls: [{ toolName: "calculator" }],
    toolResults: [
      { toolName: "calculator", output: { result: "36659437.349999994" } },
      { toolName: "calculator", output: { result: "89.08689549213716" } },
    ],
  },
  {
    runId: "run",
    question: question.question,
    step: 2,
    toolCalls: [],
    toolResults: [],
    text: "NAV is $36.66M and AAVE is 89.09% of NAV.",
  },
];

describe("eval scoring", () => {
  it("scores expected tools and tool-step limits", () => {
    expect(scoreTrajectory(steps, question)).toMatchObject({
      passed: true,
      missingTools: [],
      unexpectedTools: [],
      toolSteps: 2,
      withinStepLimit: true,
    });
  });

  it("accepts answer precision when comparing values with the oracle", () => {
    expect(scoreOracle("NAV is $36.66M and AAVE is 89.09% of NAV.", question)).toMatchObject({
      passed: true,
      missingFigures: [],
    });
  });

  it("keeps the three mechanical score dimensions independent", () => {
    const result = scoreRun("run", steps, question);
    expect(result.trajectory.passed).toBe(true);
    expect(result.groundedness.passed).toBe(true);
    expect(result.oracle.passed).toBe(true);
    expect(result.semanticReview.automated).toBe(false);
  });
});
