import { describe, expect, it, vi } from "vitest";
import { GROUNDING_FALLBACK, generateGroundedAnswer } from "./generate.js";

function result(text: string, toolResult?: string) {
  return {
    text,
    responseMessages: [],
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    steps: [
      {
        text,
        toolCalls: toolResult ? [{ toolName: "calculator" }] : [],
        toolResults: toolResult ? [{ toolName: "calculator", output: { result: toolResult } }] : [],
      },
    ],
  };
}

describe("grounded generation guardrail", () => {
  it("returns an initially grounded answer without another model call", async () => {
    const generate = vi.fn().mockResolvedValue(result("The position is $100.", "100"));

    const output = await generateGroundedAnswer({
      runId: "run-1",
      question: "Value?",
      messages: [{ role: "user", content: "Value?" }],
      generate,
    });

    expect(output.text).toBe("The position is $100.");
    expect(generate).toHaveBeenCalledOnce();
    expect(output.steps.at(-1)?.guardrail).toBeUndefined();
    expect(output.steps.at(-1)?.generation).toMatchObject({
      attempt: "initial",
      totalTokens: 120,
    });
  });

  it("repairs an unsupported figure using new calculator evidence", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(result("Others total $16,900."))
      .mockResolvedValueOnce(result("Others total $11,310.32.", "11310.32"));

    const output = await generateGroundedAnswer({
      runId: "run-2",
      question: "Value?",
      messages: [{ role: "user", content: "Value?" }],
      generate,
    });

    expect(output.text).toBe("Others total $11,310.32.");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(output.steps[0]?.guardrail?.status).toBe("repair_requested");
    expect(output.steps.at(-1)?.guardrail?.status).toBe("repaired");
    expect(output.steps.at(-1)?.generation).toMatchObject({
      attempt: "repair",
      totalTokens: 120,
    });
  });

  it("fails closed when the repaired answer is still unsupported", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(result("Others total $16,900."))
      .mockResolvedValueOnce(result("Others total $15,000."));

    const output = await generateGroundedAnswer({
      runId: "run-3",
      question: "Value?",
      messages: [{ role: "user", content: "Value?" }],
      generate,
    });

    expect(output.text).toBe(GROUNDING_FALLBACK);
    expect(output.steps.at(-1)?.guardrail?.status).toBe("rejected");
    expect(output.steps.at(-1)?.guardrail?.unverified).toEqual(["$15,000"]);
  });
});
