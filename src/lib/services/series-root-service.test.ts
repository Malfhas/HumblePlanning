import { describe, expect, it } from "bun:test";
import { planRootHandover } from "./series-root-service";

describe("planRootHandover", () => {
  it("leaves nothing to do when the root goes alone or with all its occurrences", () => {
    expect(planRootHandover([])).toEqual({ kind: "none" });
  });

  it("turns a lone occurrence left into a simple task", () => {
    expect(planRootHandover([{ id: "b", startDate: "2026-11-23" }])).toEqual({ kind: "single", taskId: "b" });
  });

  it("gives the series to the earliest occurrence left, whatever the order it comes in", () => {
    const plan = planRootHandover([
      { id: "c", startDate: "2026-11-30" },
      { id: "a", startDate: "2026-11-16" },
      { id: "b", startDate: "2026-11-23" },
    ]);
    expect(plan).toEqual({ kind: "root", rootId: "a", occurrenceIds: ["b", "c"] });
  });

  it("breaks a tie between occurrences of the same day by their id", () => {
    const plan = planRootHandover([
      { id: "y", startDate: "2026-11-16" },
      { id: "x", startDate: "2026-11-16" },
    ]);
    expect(plan).toEqual({ kind: "root", rootId: "x", occurrenceIds: ["y"] });
  });
});
