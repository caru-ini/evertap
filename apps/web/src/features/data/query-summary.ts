import type { QueryResult } from "@evertap/api/schemas";

const COUNT = new Intl.NumberFormat("en");

const plural = (count: number, noun: string) =>
  `${COUNT.format(count)} ${noun}${count === 1 ? "" : "s"}`;

/**
 * "12 rows", "3 rows changed", or "Done". Columns come from the first row, so an empty SELECT and
 * a change that matched nothing look alike; both read as "0 rows".
 */
export const querySummary = (result: QueryResult): string => {
  if (result.columns.length > 0) return plural(result.rowCount ?? result.rows.length, "row");
  if (result.rowCount === null) return "Done";
  return result.rowCount === 0 ? "0 rows" : `${plural(result.rowCount, "row")} changed`;
};
