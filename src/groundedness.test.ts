import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  checkGroundedness,
  extractDollarFigures,
  extractPercentageFigures,
  groupTraceRuns,
} from "./groundedness.js";

const fixture = await readFile("fixtures/groundedness/synthetic-trace.jsonl", "utf8");
const steps = [...groupTraceRuns(fixture).values()][0]!;

describe("figure groundedness", () => {
  it("extracts signed, scaled dollar figures and percentages", () => {
    expect(extractDollarFigures("$1,000.20, -$4.50, $36.7 million").map((x) => x.value)).toEqual([
      1000.2, -4.5, 36_700_000,
    ]);
    expect(extractPercentageFigures("89.09% and -11.07 percent").map((x) => x.value)).toEqual([
      89.09, -11.07,
    ]);
  });

  it("accepts calculator float output and legitimate presentation rounding", () => {
    for (const answer of ["$36,659,437.35", "$36,659,437", "$36.7 million"]) {
      expect(checkGroundedness(answer, steps).passed).toBe(true);
    }
  });

  it("does not treat unrelated numeric output fields as dollar evidence", () => {
    for (const answer of ["We hold $2,244,000 of USDC.e."]) {
      expect(checkGroundedness(answer, steps).unverified).toHaveLength(1);
    }
  });

  it("verifies price quotes with field-level provenance", () => {
    const result = checkGroundedness("AAVE is trading at $135.79.", steps);
    expect(result.passed).toBe(true);
    expect(result.verified[0]?.evidence).toMatchObject({
      toolName: "getPositions",
      field: "priceUsd",
      path: "positions.1.priceUsd",
    });

    const semanticallyMisused = checkGroundedness("There is $1 unaccounted for.", steps);
    expect(semanticallyMisused.verified[0]?.evidence.field).toBe("priceUsd");
  });

  it("reports a matching magnitude with the wrong sign separately", () => {
    const result = checkGroundedness("We are owed +$4,068,892.66 by Aave.", steps);
    expect(result.unverified).toEqual([]);
    expect(result.signMismatches).toHaveLength(1);
    expect(result.signMismatches[0]?.source).toBe(-4068892.66);
  });

  it("checks percentages against calculator results", () => {
    const percentSteps = structuredClone(steps);
    percentSteps[1]!.toolResults![0]!.output = { result: "89.09" };
    expect(checkGroundedness("AAVE is 89.09% of NAV.", percentSteps).passed).toBe(true);
    expect(checkGroundedness("AAVE is 91.2% of NAV.", percentSteps).unverified).toHaveLength(1);
  });

  it("accepts user-supplied scenario figures and percentage constants", () => {
    const percentSteps = structuredClone(steps);
    percentSteps[1]!.toolResults![0]!.output = { result: "89.09" };
    const scenarioSteps = [
      {
        ...steps[0]!,
        question: "What happens if AAVE falls 20% or 50%?",
      },
    ];

    expect(checkGroundedness("Scenario: AAVE falls 20%.", scenarioSteps).passed).toBe(true);
    expect(checkGroundedness("Scenario: AAVE is −20%.", scenarioSteps).passed).toBe(true);
    expect(checkGroundedness("Remaining share: 100% − 89.09%.", percentSteps).passed).toBe(true);
  });

  it("still catches the fabricated q01 subtotal", () => {
    expect(
      checkGroundedness("The unsupported subtotal is ~$16,900.", steps).unverified,
    ).toHaveLength(1);
  });
});
