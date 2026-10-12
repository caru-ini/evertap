import {
  type Cell,
  type Column,
  ROW_PAGE_MAX,
  type RowChanges,
  type RowKey,
  type RowValues,
} from "@evertap/api/schemas";

/**
 * Row edits waiting for Save. Existing rows are keyed by `rowId`, their primary-key identity, so
 * edits survive paging, sorting, and filtering.
 */
export type Staged = {
  /** Changed cells of existing rows: column → new value. */
  edits: ReadonlyMap<string, { key: RowKey; values: RowValues }>;
  deletes: ReadonlyMap<string, RowKey>;
  /** Newest first. A column left out keeps its default. */
  inserts: readonly { id: string; values: RowValues }[];
  /** Numbers new rows, which have no key until they are saved. */
  nextNew: number;
};

export const NO_CHANGES: Staged = { edits: new Map(), deletes: new Map(), inserts: [], nextNew: 1 };

/** A row as the grid shows it; `undefined` is a new row's column left to its default. */
export type ShownRow = {
  id: string;
  status: "existing" | "deleted" | "new";
  cells: (Cell | undefined)[];
  /** Per cell: changed and not saved yet. */
  edited: boolean[];
};

const sameValue = (value: string | null, original: Cell) =>
  value === null ? original === null : original !== null && String(original) === value;

/** Stages one cell of an existing row; typing the original value back unstages it. */
export const stageEdit = (
  staged: Staged,
  row: { id: string; key: RowKey; original: Cell },
  column: string,
  value: string | null,
): Staged => {
  const edits = new Map(staged.edits);
  const values = { ...edits.get(row.id)?.values };
  if (sameValue(value, row.original)) delete values[column];
  else values[column] = value;
  if (Object.keys(values).length === 0) edits.delete(row.id);
  else edits.set(row.id, { key: row.key, values });
  return { ...staged, edits };
};

export const addRow = (staged: Staged): Staged => ({
  ...staged,
  inserts: [{ id: `new:${staged.nextNew}`, values: {} }, ...staged.inserts],
  nextNew: staged.nextNew + 1,
});

export const stageNewValue = (
  staged: Staged,
  id: string,
  column: string,
  value: string | null,
): Staged => ({
  ...staged,
  inserts: staged.inserts.map((row) =>
    row.id === id ? { id, values: { ...row.values, [column]: value } } : row,
  ),
});

/** Marks existing rows for deletion; their staged edits go with them. */
export const markDeleted = (staged: Staged, rows: { id: string; key: RowKey }[]): Staged => {
  const edits = new Map(staged.edits);
  const deletes = new Map(staged.deletes);
  for (const row of rows) {
    edits.delete(row.id);
    deletes.set(row.id, row.key);
  }
  return { ...staged, edits, deletes };
};

/** Takes back a deletion, or drops a new row, which was never saved. */
export const undoRow = (staged: Staged, id: string): Staged => {
  const deletes = new Map(staged.deletes);
  deletes.delete(id);
  return { ...staged, deletes, inserts: staged.inserts.filter((row) => row.id !== id) };
};

/** Changed rows by kind; `total` is what the bar and the leave prompt count. */
export const countChanges = (staged: Staged) => {
  const edited = staged.edits.size;
  const deleted = staged.deletes.size;
  const added = staged.inserts.length;
  return { edited, deleted, added, total: edited + deleted + added };
};

const COUNT = new Intl.NumberFormat("en");

/** "1 edited · 2 deleted · 1 new", leaving out kinds with nothing staged. */
export const describeChanges = (staged: Staged): string => {
  const { edited, deleted, added } = countChanges(staged);
  return [
    edited > 0 ? `${COUNT.format(edited)} edited` : null,
    deleted > 0 ? `${COUNT.format(deleted)} deleted` : null,
    added > 0 ? `${COUNT.format(added)} new` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
};

/** The API takes up to `ROW_PAGE_MAX` rows of each kind per save; a sentence when over. */
export const changesTooLarge = (staged: Staged): string | null => {
  const { edited, deleted, added } = countChanges(staged);
  if (Math.max(edited, deleted, added) <= ROW_PAGE_MAX) return null;
  return `One save takes up to ${COUNT.format(ROW_PAGE_MAX)} edited, deleted, or new rows each. Undo some, save, then make the rest.`;
};

export const toRowChanges = (staged: Staged): RowChanges => ({
  updates: [...staged.edits.values()],
  deletes: [...staged.deletes.values()],
  inserts: staged.inserts.map((row) => row.values),
});

/** New rows first, then the page with staged edits applied and deletions marked. */
export const showRows = (
  staged: Staged,
  columns: Column[],
  rows: Cell[][],
  rowIds: string[],
): ShownRow[] => [
  ...staged.inserts.map((row): ShownRow => ({
    id: row.id,
    status: "new",
    cells: columns.map((column) =>
      Object.hasOwn(row.values, column.name) ? (row.values[column.name] ?? null) : undefined,
    ),
    edited: columns.map(() => false),
  })),
  ...rows.map((row, index): ShownRow => {
    const id = rowIds[index] ?? `row:${index}`;
    const values = staged.edits.get(id)?.values ?? {};
    return {
      id,
      status: staged.deletes.has(id) ? "deleted" : "existing",
      cells: row.map((cell, col) => {
        const name = columns[col]?.name;
        return name !== undefined && Object.hasOwn(values, name) ? (values[name] ?? null) : cell;
      }),
      edited: row.map((_, col) => {
        const name = columns[col]?.name;
        return name !== undefined && Object.hasOwn(values, name);
      }),
    };
  }),
];
