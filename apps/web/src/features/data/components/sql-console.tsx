import { READ_ONLY_REFUSED } from "@evertap/api/rules";
import { QUERY_ROWS_MAX, type QueryResult } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import { Kbd } from "@evertap/ui/components/kbd";
import { Spinner } from "@evertap/ui/components/spinner";
import { Switch } from "@evertap/ui/components/switch";
import { Textarea } from "@evertap/ui/components/textarea";
import { cx } from "@evertap/ui/lib/cx";
import { PlayIcon } from "@phosphor-icons/react";
import { useId } from "react";

import { IS_MAC } from "@/lib/is-mac.ts";

import { errorMessage } from "../error-message.ts";
import { querySummary } from "../query-summary.ts";
import { CellValue, GRID_CELL, GRID_HEAD, GRID_SCROLL } from "./grid.tsx";

import styles from "./sql-console.module.css";

const COUNT = new Intl.NumberFormat("en");

const Results = ({ result }: { result: QueryResult }) => {
  const summary = querySummary(result);

  return (
    <div className={styles.results}>
      <p className={styles.summary} role="status">
        {summary} · {COUNT.format(Math.round(result.durationMs))} ms
      </p>
      {result.truncated ? (
        <p className={styles.truncated}>
          Showing the first {COUNT.format(QUERY_ROWS_MAX)} rows. Add a LIMIT or a WHERE clause to
          see the rest.
        </p>
      ) : null}
      {result.columns.length > 0 ? (
        <div className={GRID_SCROLL}>
          <table className={styles.table}>
            <thead>
              <tr>
                {result.columns.map((column, index) => (
                  <th
                    // Statements may return two columns with one name.
                    key={index}
                    scope="col"
                    className={cx(GRID_HEAD, styles.column)}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, rowIndex) => (
                // Result rows have no identity of their own.
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} className={GRID_CELL}>
                      <CellValue cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

/**
 * Free SQL against this database only; results replace each other, nothing is kept.
 * Read-only until writes are allowed, so a stray UPDATE or DROP changes nothing.
 */
export const SqlConsole = ({
  sql,
  onSqlChange,
  example,
  write,
  onWriteChange,
  onRun,
  running,
  result,
  error,
}: {
  sql: string;
  onSqlChange: (sql: string) => void;
  /** A statement for this database, shown while the field is empty. */
  example: string;
  write: boolean;
  onWriteChange: (write: boolean) => void;
  onRun: () => void;
  running: boolean;
  result: QueryResult | undefined;
  error: unknown;
}) => {
  const hint = useId();
  const run = () => {
    if (!running && sql.trim() !== "") onRun();
  };

  return (
    <section aria-label="SQL console" className={styles.console}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <Textarea
          value={sql}
          onChange={(event) => {
            onSqlChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              run();
            }
          }}
          aria-label="SQL"
          aria-describedby={hint}
          placeholder={`For example: ${example}`}
          spellCheck={false}
          autoComplete="off"
          className={styles.sql}
        />
        <div className={styles.controls}>
          <Button type="submit" size="lg" disabled={running || sql.trim() === ""}>
            {running ? <Spinner /> : <PlayIcon />}
            Run
            <Kbd className={styles.runKey}>{IS_MAC ? "⌘↵" : "Ctrl ↵"}</Kbd>
          </Button>
          <label className={styles.allowWrites}>
            <Switch checked={write} onCheckedChange={onWriteChange} />
            Allow writes
          </label>
          <p id={hint} className={cx(styles.hint, write && styles.writing)}>
            {write
              ? "Statements run as this database's own user and change data immediately."
              : "Read-only: statements that would change data or tables are refused."}
          </p>
        </div>
      </form>
      {error && errorMessage(error) === READ_ONLY_REFUSED ? (
        <p role="alert" className={styles.refused}>
          {READ_ONLY_REFUSED}.
        </p>
      ) : error ? (
        <div role="alert" className={styles.failure}>
          <p className={styles.failureLead}>The statement failed. Fix it and run it again.</p>
          <pre className={styles.failureMessage}>{errorMessage(error)}</pre>
        </div>
      ) : result ? (
        <Results result={result} />
      ) : (
        <p className={styles.empty}>
          Rows the statement returns show here. The last result stays while you look at a table.
        </p>
      )}
    </section>
  );
};
