import { describe, expect, it } from "vitest";
import { phases, progressLabel } from "./site";

describe("progressLabel", () => {
  it("counts completed phases", () => {
    expect(progressLabel([{ done: true }, { done: false }, { done: true }])).toBe(
      "2 of 3 phases complete",
    );
  });

  it("handles an empty list", () => {
    expect(progressLabel([])).toBe("0 of 0 phases complete");
  });

  it("lists phases 0 to 5 in order", () => {
    expect(phases.map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
