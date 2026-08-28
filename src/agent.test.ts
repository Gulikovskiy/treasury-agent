import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./agent.js";

describe("treasury agent policy", () => {
  it("requires tool-backed arithmetic for every presented derived figure", () => {
    expect(SYSTEM_PROMPT).toContain(
      "Every subtotal, ratio, percentage, and other derived figure in the final answer must be the result of a calculator call.",
    );
    expect(SYSTEM_PROMPT).toContain("If you did not obtain a derived figure as calculator output");
  });
});
