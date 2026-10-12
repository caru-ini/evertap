import type { Column } from "@evertap/api/schemas";
import { describe, expect, it } from "vitest";

import {
  NO_CHANGES,
  addRow,
  changesTooLarge,
  countChanges,
  describeChanges,
  markDeleted,
  showRows,
  stageEdit,
  stageNewValue,
  toRowChanges,
  undoRow,
} from "./row-changes.ts";

const column = (name: string, primaryKey = false): Column => ({
  name,
  type: "text",
  nullable: true,
  primaryKey,
  default: null,
});

const columns = [column("id", true), column("name"), column("age")];
const rows = [
  [1, "ada", 36],
  [2, "bob", null],
];
const rowIds = ["[1]", "[2]"];
const ada = { id: "[1]", key: { id: 1 } };

describe("stageEdit", () => {
  it("stages a changed cell and shows it in place", () => {
    const staged = stageEdit(NO_CHANGES, { ...ada, original: "ada" }, "name", "Ada");
    expect(showRows(staged, columns, rows, rowIds)[0]).toEqual({
      id: "[1]",
      status: "existing",
      cells: [1, "Ada", 36],
      edited: [false, true, false],
    });
  });

  it("unstages a cell edited back to its original value", () => {
    let staged = stageEdit(NO_CHANGES, { ...ada, original: 36 }, "age", "40");
    staged = stageEdit(staged, { ...ada, original: 36 }, "age", "36");
    expect(staged.edits.size).toBe(0);

    staged = stageEdit(NO_CHANGES, { id: "[2]", key: { id: 2 }, original: null }, "age", "1");
    staged = stageEdit(staged, { id: "[2]", key: { id: 2 }, original: null }, "age", null);
    expect(countChanges(staged).total).toBe(0);
  });

  it("keeps the last value for a cell edited twice", () => {
    let staged = stageEdit(NO_CHANGES, { ...ada, original: "ada" }, "name", "A");
    staged = stageEdit(staged, { ...ada, original: "ada" }, "name", null);
    expect(toRowChanges(staged).updates).toEqual([{ key: { id: 1 }, values: { name: null } }]);
  });
});

describe("new rows", () => {
  it("come first, with unset columns left to their defaults", () => {
    let staged = addRow(addRow(NO_CHANGES));
    const [newest] = staged.inserts;
    staged = stageNewValue(staged, newest?.id ?? "", "name", "cy");
    const shown = showRows(staged, columns, rows, rowIds);
    expect(shown.map((row) => row.status)).toEqual(["new", "new", "existing", "existing"]);
    expect(shown[0]?.cells).toEqual([undefined, "cy", undefined]);
    expect(toRowChanges(staged).inserts).toEqual([{ name: "cy" }, {}]);
  });

  it("are dropped by undo", () => {
    const staged = addRow(NO_CHANGES);
    expect(undoRow(staged, staged.inserts[0]?.id ?? "").inserts).toEqual([]);
  });
});

describe("markDeleted", () => {
  it("drops the row's staged edits and can be undone", () => {
    let staged = stageEdit(NO_CHANGES, { ...ada, original: "ada" }, "name", "Ada");
    staged = markDeleted(staged, [ada]);
    expect(staged.edits.size).toBe(0);
    expect(showRows(staged, columns, rows, rowIds)[0]).toMatchObject({
      status: "deleted",
      cells: [1, "ada", 36],
    });
    expect(undoRow(staged, "[1]").deletes.size).toBe(0);
  });
});

describe("toRowChanges", () => {
  it("keeps edits for rows that are not on the page", () => {
    const staged = stageEdit(
      NO_CHANGES,
      { id: "[9]", key: { id: 9 }, original: "zed" },
      "name",
      "Zed",
    );
    expect(showRows(staged, columns, rows, rowIds).some((row) => row.edited.some(Boolean))).toBe(
      false,
    );
    expect(toRowChanges(staged)).toEqual({
      updates: [{ key: { id: 9 }, values: { name: "Zed" } }],
      deletes: [],
      inserts: [],
    });
  });
});

describe("describeChanges", () => {
  it("counts rows by kind and leaves out empty kinds", () => {
    let staged = stageEdit(NO_CHANGES, { ...ada, original: "ada" }, "name", "Ada");
    staged = stageEdit(staged, { ...ada, original: 36 }, "age", "37");
    staged = addRow(staged);
    expect(countChanges(staged)).toEqual({ edited: 1, deleted: 0, added: 1, total: 2 });
    expect(describeChanges(staged)).toBe("1 edited · 1 new");
  });
});

describe("changesTooLarge", () => {
  it("refuses more rows of one kind than one save takes", () => {
    const many = Array.from({ length: 501 }, (_, index) => ({
      id: `[${index}]`,
      key: { id: index },
    }));
    expect(changesTooLarge(markDeleted(NO_CHANGES, many.slice(0, 500)))).toBeNull();
    expect(changesTooLarge(markDeleted(NO_CHANGES, many))).not.toBeNull();
  });
});
