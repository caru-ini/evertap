import { describe, expect, it } from "vitest";

import { formatTtl, fromDraft, isValueDirty, planSave, toDraft } from "./redis-draft.ts";

describe("fromDraft", () => {
  it("round-trips a sorted set, scores included", () => {
    const value = {
      type: "zset" as const,
      members: [
        { member: "a", score: 1.5 },
        { member: "b", score: -2 },
      ],
    };
    expect(fromDraft(toDraft(value))).toEqual({ ok: true, value });
  });

  it("refuses a score that is not a number", () => {
    const result = fromDraft({ type: "zset", members: [{ member: "a", score: "" }] });
    expect(result).toEqual({ ok: false, error: 'Give "a" a number as its score.' });
  });

  it("refuses duplicate hash fields and set members", () => {
    expect(
      fromDraft({
        type: "hash",
        entries: [
          { field: "x", value: "1" },
          { field: "x", value: "2" },
        ],
      }).ok,
    ).toBe(false);
    expect(fromDraft({ type: "set", members: ["a", "a"] }).ok).toBe(false);
  });

  it("refuses an empty collection, which Redis would delete", () => {
    expect(fromDraft({ type: "list", items: [] }).ok).toBe(false);
    expect(fromDraft({ type: "string", value: "" }).ok).toBe(true);
  });
});

describe("formatTtl", () => {
  it("picks one unit", () => {
    expect(formatTtl(400)).toBe("1 s");
    expect(formatTtl(90_000)).toBe("2 min");
    expect(formatTtl(3 * 60 * 60 * 1000)).toBe("3 h");
    expect(formatTtl(24 * 60 * 60 * 1000)).toBe("1 day");
  });
});

describe("isValueDirty", () => {
  it("compares saved values, not typed text", () => {
    const value = { type: "zset" as const, members: [{ member: "a", score: 1.5 }] };
    expect(isValueDirty(value, { type: "zset", members: [{ member: "a", score: "1.50" }] })).toBe(
      false,
    );
    expect(isValueDirty(value, { type: "zset", members: [{ member: "a", score: "2" }] })).toBe(
      true,
    );
  });

  it("counts a draft that cannot be saved as changed", () => {
    expect(isValueDirty({ type: "list", items: ["x"] }, { type: "list", items: [] })).toBe(true);
  });
});

describe("planSave", () => {
  const base = { value: { type: "string" as const, value: "v" }, ttlMs: 60_000, at: 1000 };
  const plan = (overrides: Partial<Parameters<typeof planSave>[0]>) =>
    planSave({
      base,
      draft: { type: "string", value: "v" },
      expiry: { mode: "after", seconds: "60" },
      expiryTouched: false,
      editable: true,
      now: 11_000,
      ...overrides,
    });

  it("sends nothing when nothing changed", () => {
    expect(plan({})).toBeNull();
  });

  it("changes only the expiry when the value is untouched", () => {
    expect(plan({ expiry: { mode: "after", seconds: "5" }, expiryTouched: true })).toEqual({
      kind: "expire",
      ttlMs: 5000,
    });
    expect(plan({ expiry: { mode: "never", seconds: "" }, expiryTouched: true })).toEqual({
      kind: "expire",
      ttlMs: null,
    });
  });

  it("changes the expiry of a value it cannot edit", () => {
    expect(
      plan({
        base: { ...base, value: null },
        draft: null,
        editable: false,
        expiry: { mode: "after", seconds: "5" },
        expiryTouched: true,
      }),
    ).toEqual({ kind: "expire", ttlMs: 5000 });
  });

  it("writes a changed value with the expiry still counting down", () => {
    expect(plan({ draft: { type: "string", value: "w" } })).toEqual({
      kind: "write",
      value: { type: "string", value: "w" },
      ttlMs: 50_000,
    });
  });

  it("never writes a value it cannot edit", () => {
    expect(plan({ draft: { type: "string", value: "w" }, editable: false })).toBeNull();
  });

  it("refuses an invalid expiry", () => {
    expect(plan({ expiry: { mode: "after", seconds: "1.5" }, expiryTouched: true })).toBeNull();
  });
});
