import { describe, expect, it } from "vitest";
import {
  scoreContradictions,
  scoreOracle,
  scoreRun,
  scoreTrajectory,
  type EvalQuestion,
} from "./eval.js";
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
      coverage: { passed: true, missingRequiredFigures: [] },
    });
  });

  it("treats expected-answer details as optional rather than required", () => {
    expect(scoreOracle("NAV is $36.66M.", question)).toMatchObject({
      coverage: {
        passed: false,
        missingRequiredFigures: [expect.objectContaining({ value: 89.09 })],
      },
    });
    const conciseQuestion = {
      ...question,
      must_include: ["NAV $36,659,437.35"],
    };
    expect(scoreOracle("NAV is $36.66M.", conciseQuestion).coverage.passed).toBe(true);
  });

  it("does not let optional coverage gate the overall score", () => {
    const conciseQuestion = {
      ...question,
      expected_answer: "NAV is $36,659,437.35 and AAVE is 89.09% of NAV.",
      must_include: ["NAV $36,659,437.35"],
    };
    const conciseSteps = steps.map((step, index) => ({
      ...step,
      text: index === steps.length - 1 ? "NAV is $36.66M." : "",
    }));
    const result = scoreRun("run", conciseSteps, conciseQuestion);
    expect(result.oracle.coverage.passed).toBe(true);
    expect(result.oracle.coverage.matchedOptionalFigures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("does not require question-supplied scenario parameters for coverage", () => {
    const scenario = {
      ...question,
      question: "What if AAVE falls 20%?",
      expected_answer: "A 20% fall reduces NAV by $6,531,750.93.",
      must_include: ["20% shock", "loss $6,531,750.93"],
    };
    expect(scoreOracle("The loss is $6,531,750.93.", scenario)).toMatchObject({
      coverage: { passed: true, requiredFigures: [expect.objectContaining({ value: 6531750.93 })] },
    });
    expect(scoreContradictions("The scenario uses a 20% fall.", [], scenario).passed).toBe(true);
  });

  it("hard-fails a calculator-backed figure that contradicts the oracle", () => {
    const contradictionSteps: TraceStep[] = [
      {
        runId: "run",
        question: question.question,
        step: 0,
        toolCalls: [{ toolName: "calculator" }],
        toolResults: [
          {
            toolName: "calculator",
            input: { expression: "8870000" },
            output: { result: "8870000" },
          },
        ],
        text: "Stablecoins total $8.87M.",
      },
    ];
    expect(
      scoreContradictions("Stablecoins total $8.87M.", contradictionSteps, question),
    ).toMatchObject({
      passed: false,
      contradictions: [expect.objectContaining({ value: 8_870_000 })],
    });
  });

  it("accepts novel calculations whose operands have trusted lineage", () => {
    const derivedSteps: TraceStep[] = [
      {
        runId: "run",
        question: question.question,
        step: 0,
        toolCalls: [{ toolName: "getPositions" }, { toolName: "calculator" }],
        toolResults: [
          {
            toolName: "getPositions",
            output: { positions: [{ valueUsd: "100" }, { valueUsd: "50" }] },
          },
          {
            toolName: "calculator",
            input: { expression: "100 + 50" },
            output: { result: "150" },
          },
        ],
        text: "The derived subtotal is $150.",
      },
    ];
    expect(
      scoreContradictions("The derived subtotal is $150.", derivedSteps, question).passed,
    ).toBe(true);
  });

  it("allows token amounts as calculator operands without treating them as dollar evidence", () => {
    const depegQuestion = {
      ...question,
      question: "What if USDC depegged to $0.95?",
      expected_answer: "The marked value changes.",
      must_include: [],
    };
    const depegSteps: TraceStep[] = [
      {
        runId: "run",
        question: depegQuestion.question,
        step: 0,
        toolCalls: [{ toolName: "getPositions" }, { toolName: "calculator" }],
        toolResults: [
          { toolName: "getPositions", output: { positions: [{ amount: "100" }] } },
          {
            toolName: "calculator",
            input: { expression: "100 * 0.95" },
            output: { result: "95" },
          },
        ],
        text: "The stressed value is $95.",
      },
    ];
    expect(
      scoreContradictions("The stressed value is $95.", depegSteps, depegQuestion).passed,
    ).toBe(true);
  });

  it("keeps the three mechanical score dimensions independent", () => {
    const result = scoreRun("run", steps, question);
    expect(result.trajectory.passed).toBe(true);
    expect(result.answer.passed).toBe(true);
    expect(result.groundedness.passed).toBe(true);
    expect(result.oracle.contradiction.passed).toBe(true);
    expect(result.oracle.coverage.passed).toBe(true);
    expect(result.semanticReview.automated).toBe(false);
  });

  it("distinguishes a missing final answer from an incorrect answer", () => {
    const withoutAnswer = steps.map((step) => ({ ...step, text: "" }));
    const result = scoreRun("run", withoutAnswer, question);
    expect(result.answer).toEqual({ passed: false, characterCount: 0 });
    expect(result.oracle.coverage.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
});
