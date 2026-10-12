import type { Cell, Column } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import { Checkbox } from "@evertap/ui/components/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@evertap/ui/components/tooltip";
import { cx } from "@evertap/ui/lib/cx";
import {
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  KeyIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { z } from "zod";

import type { ShownRow } from "../row-changes.ts";
import { CellValue, GRID_CELL, GRID_HEAD, GRID_SCROLL, cellText } from "./grid.tsx";

import styles from "./rows-grid.module.css";

export type Sort = { column: string; direction: "asc" | "desc" };

type Position = { row: number; col: number };

/** The cell being edited, by its row's primary key and column name, which survive a refetch. */
type Editing = { rowId: string; column: string };

const nextSort = (sort: Sort | undefined, column: string): Sort | undefined => {
  if (sort?.column !== column) return { column, direction: "asc" };
  return sort.direction === "asc" ? { column, direction: "desc" } : undefined;
};

const MIN_COLUMN_WIDTH = 64;
/** A column added after widths were saved; the checkbox column is `w-10`. */
const DEFAULT_COLUMN_WIDTH = 160;
const CHECKBOX_COLUMN_WIDTH = 40;
const RESIZE_STEP = 16;

/** A column header: name and type, each cut with "…" at the column's width; hovering a cut one shows both in full. */
const ColumnHeader = ({
  column,
  direction,
  fixed,
  onSort,
}: {
  column: Column;
  direction: "asc" | "desc" | undefined;
  fixed: boolean;
  onSort: () => void;
}) => {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const constraints = `${column.type}${column.nullable ? "" : " · not null"}`;
  const clipped = () =>
    [...(button.current?.querySelectorAll<HTMLElement>("[data-clip]") ?? [])].some(
      (text) => text.scrollWidth > text.clientWidth,
    );

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        setOpen(next && clipped());
      }}
    >
      <TooltipTrigger
        render={
          <button
            ref={button}
            type="button"
            onClick={onSort}
            className={cx(styles.sort, fixed ? styles.sortFixed : styles.sortAuto)}
          />
        }
      >
        <span className={styles.columnName}>
          {column.primaryKey ? (
            <KeyIcon aria-label="Primary key" className={styles.keyIcon} />
          ) : null}
          <span data-clip className={styles.clip}>
            {column.name}
          </span>
          {direction === "asc" ? (
            <CaretUpIcon aria-hidden className={styles.sortIcon} weight="bold" />
          ) : direction === "desc" ? (
            <CaretDownIcon aria-hidden className={styles.sortIcon} weight="bold" />
          ) : null}
        </span>
        <span data-clip className={styles.columnType}>
          {constraints}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className={styles.columnTip}>
        <span className={styles.columnTipName}>{column.name}</span>
        <span>{constraints}</span>
      </TooltipContent>
    </Tooltip>
  );
};

const widthsSchema = z.record(z.string(), z.number());

type Widths = Record<string, number>;

/** Widths the person dragged, remembered in this browser per table; null means automatic. */
const useColumnWidths = (storageKey: string) => {
  const key = `evertap:column-widths:${storageKey}`;
  const [widths, setWidths] = useState<Widths | null>(() => {
    try {
      const saved = widthsSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));
      return saved.success ? saved.data : null;
    } catch {
      return null;
    }
  });
  const persist = (next: Widths | null) => {
    setWidths(next);
    try {
      if (next) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
    } catch {
      // Storage can be blocked; the widths still hold until the page reloads.
    }
  };
  return { widths, setWidths, persist };
};

/**
 * Inline editor over one cell. Enter keeps the value, Shift+Enter breaks the line, Escape cancels.
 * Nothing is written: the value is staged until Save changes. `refocus` is true when the editor
 * ended from the keyboard, so focus returns to the cell instead of staying where a click sent it.
 */
const CellEditor = ({
  cell,
  column,
  onSave,
  onCancel,
}: {
  cell: Cell | undefined;
  column: Column;
  onSave: (value: string | null, refocus: boolean) => void;
  onCancel: (refocus: boolean) => void;
}) => {
  const [text, setText] = useState(() => cellText(cell));
  // Blur follows Enter and Escape as focus moves back to the cell; only the first ending counts.
  const done = useRef(false);

  const finish = (value: string | null, refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    // Unchanged text is a cancel; an emptied NULL or Default cell stays as it was rather than "".
    const unchanged = value === null ? cell === null : cellText(cell) === value;
    if (unchanged) onCancel(refocus);
    else onSave(value, refocus);
  };

  return (
    <div className={styles.editor}>
      <textarea
        autoFocus
        rows={1}
        value={text}
        aria-label={`Edit ${column.name}`}
        spellCheck={false}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={() => {
          finish(text, false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            finish(text, true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            done.current = true;
            onCancel(true);
          } else if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
            // Staged before the table view's shortcut saves, so the typed value is included.
            finish(text, true);
          }
        }}
        className={styles.editorText}
      />
      <div className={styles.editorFoot}>
        <p className={styles.editorHint}>Enter done · Shift+Enter new line · Esc cancels</p>
        {column.nullable && cell !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cx(styles.quiet, styles.setNull)}
            // Keeps focus in the text, so the blur does not stage what was typed first.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              finish(null, true);
            }}
          >
            Set NULL
          </Button>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Rows as an ARIA grid: one Tab stop, arrow keys move between cells, Enter or a double click
 * edits, Space selects the row from its checkbox cell (or undoes a new or deleted row there).
 * Edits are staged by the table view; this only shows them.
 */
export const RowsGrid = ({
  columns,
  rows,
  editable,
  locked,
  busy,
  sort,
  onSortChange,
  selected,
  onSelectedChange,
  onEdit,
  onUndoRow,
  editRequest,
  widthsKey,
}: {
  columns: Column[];
  /** New rows first, then the page with staged edits applied. */
  rows: ShownRow[];
  editable: boolean;
  /** Saving: rows can be looked at but not changed. */
  locked: boolean;
  busy: boolean;
  sort: Sort | undefined;
  onSortChange: (sort: Sort | undefined) => void;
  selected: ReadonlySet<string>;
  onSelectedChange: (selected: ReadonlySet<string>) => void;
  onEdit: (row: ShownRow, column: Column, value: string | null) => void;
  /** Takes back a deletion or drops a new row. */
  onUndoRow: (row: ShownRow) => void;
  /** A cell to open the editor on, such as the first cell of a row just added. */
  editRequest: Editing | null;
  /** Which table's saved column widths to use. */
  widthsKey: string;
}) => {
  const body = useRef<HTMLTableSectionElement>(null);
  const header = useRef<HTMLTableRowElement>(null);
  const { widths, setWidths, persist } = useColumnWidths(widthsKey);
  // Automatic layout until the first resize; then every column gets a fixed width.
  const fixed = widths !== null;
  const widthOf = (name: string) => widths?.[name] ?? DEFAULT_COLUMN_WIDTH;
  const tableWidth =
    columns.reduce((sum, column) => sum + widthOf(column.name), 0) +
    (editable ? CHECKBOX_COLUMN_WIDTH : 0);

  // The first resize freezes the automatic widths so only the dragged column moves.
  const currentWidths = (): Widths =>
    widths ??
    Object.fromEntries(
      [...(header.current?.querySelectorAll<HTMLElement>("th[data-column]") ?? [])].map((th) => [
        th.dataset.column ?? "",
        th.getBoundingClientRect().width,
      ]),
    );

  const startResize = (event: React.PointerEvent<HTMLElement>, name: string) => {
    event.preventDefault();
    const base = currentWidths();
    const startX = event.clientX;
    const start = base[name] ?? DEFAULT_COLUMN_WIDTH;
    let latest = base;
    setWidths(base);
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      latest = {
        ...base,
        [name]: Math.max(MIN_COLUMN_WIDTH, Math.round(start + moveEvent.clientX - startX)),
      };
      setWidths(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      persist(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const nudge = (name: string, delta: number) => {
    const base = currentWidths();
    persist({
      ...base,
      [name]: Math.max(MIN_COLUMN_WIDTH, (base[name] ?? DEFAULT_COLUMN_WIDTH) + delta),
    });
  };
  const [active, setActive] = useState<Position>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [seenRequest, setSeenRequest] = useState(editRequest);
  if (editRequest !== seenRequest) {
    setSeenRequest(editRequest);
    if (editRequest) setEditing(editRequest);
  }
  const offset = editable ? 1 : 0;
  const width = columns.length + offset;
  // A shorter page after paging or saving must not leave the Tab stop on a missing cell.
  const current = {
    row: Math.min(active.row, Math.max(rows.length - 1, 0)),
    col: Math.min(active.col, width - 1),
  };
  // A refetch may reorder or drop rows; an edit whose row or column left, or was deleted, ends.
  if (
    editing &&
    (locked ||
      !rows.some((row) => row.id === editing.rowId && row.status !== "deleted") ||
      !columns.some((column) => column.name === editing.column))
  ) {
    setEditing(null);
  }
  const selectable = editable
    ? rows.flatMap((row) => (row.status === "existing" ? [row.id] : []))
    : [];
  const allSelected = selectable.length > 0 && selectable.every((rowId) => selected.has(rowId));
  const someSelected = selectable.some((rowId) => selected.has(rowId));
  const canEdit = (row: ShownRow) => editable && !locked && row.status !== "deleted";

  const focusCell = ({ row, col }: Position) => {
    setActive({ row, col });
    body.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)?.focus();
  };

  const toggle = (rowId: string) => {
    const next = new Set(selected);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    onSelectedChange(next);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (!(event.target instanceof HTMLTableCellElement) || editing) return;
    const { row, col } = current;
    const moves: Record<string, Position> = {
      ArrowUp: { row: Math.max(row - 1, 0), col },
      ArrowDown: { row: Math.min(row + 1, rows.length - 1), col },
      ArrowLeft: { row, col: Math.max(col - 1, 0) },
      ArrowRight: { row, col: Math.min(col + 1, width - 1) },
      Home: { row, col: 0 },
      End: { row, col: width - 1 },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      focusCell(move);
      return;
    }
    const shown = rows[row];
    const column = columns[col - offset];
    if (!editable || locked || shown === undefined) return;
    if (col === 0 && event.key === " ") {
      event.preventDefault();
      if (shown.status === "existing") toggle(shown.id);
      else onUndoRow(shown);
    } else if (column && canEdit(shown) && (event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      setEditing({ rowId: shown.id, column: column.name });
    }
  };

  return (
    <div className={cx(GRID_SCROLL, busy && styles.busy)} aria-busy={busy}>
      <table
        role="grid"
        aria-readonly={!editable || locked}
        style={fixed ? { width: tableWidth } : undefined}
        className={cx(styles.table, fixed ? styles.tableFixed : styles.tableAuto)}
      >
        <thead>
          <tr ref={header}>
            {editable ? (
              <th scope="col" className={cx(GRID_HEAD, styles.checkHead)}>
                <Checkbox
                  aria-label="Select all rows on this page"
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  disabled={locked || selectable.length === 0}
                  onCheckedChange={(checked) => {
                    onSelectedChange(checked ? new Set(selectable) : new Set());
                  }}
                  className={styles.checkbox}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const direction = sort?.column === column.name ? sort.direction : undefined;
              return (
                <th
                  key={column.name}
                  scope="col"
                  aria-sort={
                    direction === "asc"
                      ? "ascending"
                      : direction === "desc"
                        ? "descending"
                        : undefined
                  }
                  data-column={column.name}
                  style={fixed ? { width: widthOf(column.name) } : undefined}
                  className={cx(GRID_HEAD, styles.columnHead)}
                >
                  <ColumnHeader
                    column={column}
                    direction={direction}
                    fixed={fixed}
                    onSort={() => {
                      onSortChange(nextSort(sort, column.name));
                    }}
                  />
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${column.name}`}
                    aria-valuenow={Math.round(widths?.[column.name] ?? 0) || undefined}
                    tabIndex={0}
                    title="Drag to resize · double-click to reset all columns"
                    onPointerDown={(event) => {
                      startResize(event, column.name);
                    }}
                    onDoubleClick={() => {
                      persist(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        event.preventDefault();
                        nudge(column.name, event.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP);
                      }
                    }}
                    className={styles.resize}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={body} onKeyDown={onKeyDown}>
          {rows.map((row, rowIndex) => {
            const isSelected = row.status === "existing" && selected.has(row.id);
            const deleted = row.status === "deleted";
            return (
              <tr
                key={row.id}
                aria-selected={editable ? isSelected : undefined}
                className={cx(
                  styles.row,
                  isSelected && styles.selectedRow,
                  deleted && styles.deletedRow,
                )}
              >
                {editable ? (
                  <td
                    data-cell={`${rowIndex}:0`}
                    tabIndex={current.row === rowIndex && current.col === 0 ? 0 : -1}
                    onFocus={() => {
                      setActive({ row: rowIndex, col: 0 });
                    }}
                    className={cx(
                      GRID_CELL,
                      styles.checkCell,
                      row.status === "new" && styles.staged,
                    )}
                  >
                    {row.status === "existing" ? (
                      <Checkbox
                        tabIndex={-1}
                        aria-label={`Select row ${rowIndex + 1}`}
                        checked={isSelected}
                        disabled={locked}
                        onCheckedChange={() => {
                          toggle(row.id);
                        }}
                        className={styles.checkbox}
                      />
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        tabIndex={-1}
                        disabled={locked}
                        aria-label={
                          deleted ? `Undo delete of row ${rowIndex + 1}` : "Remove new row"
                        }
                        title={deleted ? "Undo delete" : "Remove new row"}
                        onClick={() => {
                          onUndoRow(row);
                        }}
                        className={cx(styles.quiet, styles.rowUndo)}
                      >
                        {deleted ? <ArrowCounterClockwiseIcon /> : <XIcon />}
                      </Button>
                    )}
                  </td>
                ) : null}
                {row.cells.map((cell, index) => {
                  const col = index + offset;
                  const column = columns[index];
                  const edited = row.edited[index] === true;
                  const isEditing = editing?.rowId === row.id && editing.column === column?.name;
                  return (
                    <td
                      // Cells follow `columns`, whose names are unique within a table.
                      key={column?.name ?? index}
                      data-cell={`${rowIndex}:${col}`}
                      tabIndex={current.row === rowIndex && current.col === col ? 0 : -1}
                      onFocus={(event) => {
                        if (event.target === event.currentTarget) {
                          setActive({ row: rowIndex, col });
                        }
                      }}
                      onDoubleClick={() => {
                        if (column && canEdit(row)) {
                          setEditing({ rowId: row.id, column: column.name });
                        }
                      }}
                      className={cx(
                        GRID_CELL,
                        styles.dataCell,
                        typeof cell === "number" && styles.number,
                        canEdit(row) && styles.editable,
                        (edited || row.status === "new") && styles.staged,
                        fixed && styles.fixedCell,
                      )}
                    >
                      <CellValue cell={cell} />
                      {edited ? <span className="sr-only"> (unsaved)</span> : null}
                      {isEditing && column ? (
                        <CellEditor
                          cell={cell}
                          column={column}
                          onSave={(value, refocus) => {
                            onEdit(row, column, value);
                            setEditing(null);
                            if (refocus) focusCell({ row: rowIndex, col });
                          }}
                          onCancel={(refocus) => {
                            setEditing(null);
                            if (refocus) focusCell({ row: rowIndex, col });
                          }}
                        />
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
