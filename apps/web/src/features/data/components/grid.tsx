import type { Cell } from "@evertap/api/schemas";

import styles from "./grid.module.css";

/** The text a cell edits as; NULL and a new row's default have none. */
export const cellText = (cell: Cell | undefined): string =>
  cell === null || cell === undefined ? "" : String(cell);

/**
 * One grid value in mono on one line. NULL is a Figtree tag, never the text "NULL"; so is Default,
 * a new row's column left for the database to fill (`undefined`).
 */
export const CellValue = ({ cell }: { cell: Cell | undefined }) =>
  cell === null ? (
    <span className={styles.tag}>NULL</span>
  ) : cell === undefined ? (
    <span className={styles.tag}>Default</span>
  ) : (
    <span title={String(cell)} className={styles.value}>
      {String(cell)}
    </span>
  );

// Shared by the rows grid and the SQL console's results so both read as one table.
export const GRID_SCROLL = styles.scroll;
export const GRID_HEAD = styles.head;
export const GRID_CELL = styles.cell;
