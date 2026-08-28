import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256, sweepId } from "./run-all.js";

describe("sweep metadata", () => {
  it("creates filesystem-safe UTC sweep IDs", () => {
    expect(sweepId(new Date("2026-08-28T14:22:01.987Z"))).toBe("2026-08-28T14-22-01Z");
  });

  it("hashes exact recorded inputs", () => {
    expect(sha256("prompt text")).toBe(
      createHash("sha256").update("prompt text").digest("hex"),
    );
  });
});
