import { describe, expect, it } from "vitest";

import { querySummary } from "./query-summary.ts";

const result = (columns: string[], rows: number, rowCount: number | null) => ({
  columns,
  rows: Array.from({ length: rows }, () => columns.map(() => 1)),
  rowCount,
  truncated: false,
  durationMs: 1,
});

describe("querySummary", () => {
  it("counts returned rows", () => {
    expect(querySummary(result(["id"], 2, 2))).toBe("2 rows");
    expect(querySummary(result(["id"], 1, null))).toBe("1 row");
  });

  it("does not call an empty result a change", () => {
    expect(querySummary(result([], 0, 0))).toBe("0 rows");
  });

  it("counts changed rows, and says Done when the engine gives no count", () => {
    expect(querySummary(result([], 0, 3))).toBe("3 rows changed");
    expect(querySummary(result([], 0, null))).toBe("Done");
  });
});
