import type { Table } from "@evertap/api/schemas";
import { buttonVariants } from "@evertap/ui/components/button";
import { Skeleton } from "@evertap/ui/components/skeleton";
import { TableIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { FormatSwitch } from "@/components/format-switch.tsx";
import { NameFilter } from "@/components/name-filter.tsx";
import { orpc } from "@/lib/orpc.ts";

import { LoadError } from "./load-error.tsx";
import { SqlConsole } from "./sql-console.tsx";
import { TablePicker, TableSize } from "./table-picker.tsx";
import { TableView } from "./table-view.tsx";

import styles from "./table-browser.module.css";

const MODES = [
  { id: "tables", label: "Tables", icon: TableIcon },
  { id: "sql", label: "SQL console", icon: TerminalWindowIcon },
] as const;

// The threshold the engine pages and Clients use for their name filter.
const FILTER_FROM = 9;

const SKELETON = ["a", "b", "c", "d"];

export type TableSelection = { schema?: string; table?: string; sql?: boolean };

const groupBySchema = (tables: Table[]) => {
  const groups = new Map<string, Table[]>();
  for (const table of tables) {
    groups.set(table.schema, [...(groups.get(table.schema) ?? []), table]);
  }
  return [...groups].map(([schema, items]) => ({ schema, tables: items }));
};

/** PostgreSQL and MySQL: the chosen table beside the table list, or the SQL console. */
export const TableBrowser = ({ id, selection }: { id: string; selection: TableSelection }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [nameFilter, setNameFilter] = useState("");
  const tables = useQuery(orpc.data.tables.queryOptions({ input: { id } }));
  // Kept here so moving between a table and the console does not lose the statement or its result.
  const [sql, setSql] = useState("");
  const [write, setWrite] = useState(false);
  const query = useMutation(
    orpc.data.query.mutationOptions({
      // A statement may create, drop or change anything the other views show.
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.data.key() });
      },
    }),
  );

  if (tables.isError) {
    return (
      <LoadError
        error={tables.error}
        retrying={tables.isFetching}
        onRetry={() => {
          void tables.refetch();
        }}
      />
    );
  }

  const list = tables.data ?? [];
  const groups = groupBySchema(list);
  const showSchema = groups.length > 1;
  const chosen =
    selection.table === undefined
      ? list[0]
      : list.find(
          (table) =>
            table.name === selection.table &&
            (selection.schema === undefined || table.schema === selection.schema),
        );
  const consoleOpen = selection.sql === true || (tables.data !== undefined && list.length === 0);
  const needle = nameFilter.trim().toLowerCase();
  const shownGroups =
    needle === ""
      ? groups
      : groups.flatMap((group) => {
          const matches = group.tables.filter((table) => table.name.toLowerCase().includes(needle));
          return matches.length > 0 ? [{ schema: group.schema, tables: matches }] : [];
        });

  return (
    <div className={styles.browser}>
      <div className={styles.modes}>
        <FormatSwitch
          legend="Show"
          options={MODES}
          value={consoleOpen ? "sql" : "tables"}
          onChange={(mode) => {
            // The chosen table stays in the URL, so returning from the console shows it again.
            void navigate({
              to: "/resources/$id/data",
              params: { id },
              search: {
                schema: selection.schema,
                table: selection.table,
                sql: mode === "sql" ? true : undefined,
              },
            });
          }}
        />
      </div>

      {consoleOpen ? (
        <div className={styles.console}>
          {tables.data !== undefined && list.length === 0 ? (
            <p className={styles.noTables}>
              This database has no tables yet. Create one with CREATE TABLE below.
            </p>
          ) : null}
          <SqlConsole
            sql={sql}
            onSqlChange={setSql}
            write={write}
            onWriteChange={(next) => {
              setWrite(next);
              // A refusal from the other setting no longer describes what Run would do.
              query.reset();
            }}
            example={
              chosen
                ? `SELECT * FROM ${showSchema ? `${chosen.schema}.` : ""}${chosen.name} LIMIT 10;`
                : "CREATE TABLE notes (id int PRIMARY KEY, body text);"
            }
            running={query.isPending}
            result={query.data}
            error={query.error}
            onRun={() => {
              query.mutate({ id, sql, write });
            }}
          />
        </div>
      ) : (
        <div className={styles.layout}>
          <nav aria-label="Tables" className={styles.nav}>
            <p className={styles.navTitle}>
              Tables
              {tables.data ? <span className={styles.count}>{list.length}</span> : null}
            </p>
            {list.length >= FILTER_FROM ? (
              <div className={styles.nameFilter}>
                <NameFilter
                  value={nameFilter}
                  onChange={setNameFilter}
                  label="Filter tables by name"
                />
              </div>
            ) : null}
            {tables.data === undefined ? (
              <div aria-hidden className={styles.navSkeleton}>
                {SKELETON.map((key) => (
                  <Skeleton key={key} className={styles.navSkeletonRow} />
                ))}
              </div>
            ) : shownGroups.length === 0 ? (
              <p className={styles.noMatch}>No table matches. Try part of the name.</p>
            ) : (
              shownGroups.map((group) => (
                <div key={group.schema} className={styles.group}>
                  {showSchema ? <p className={styles.schema}>{group.schema}</p> : null}
                  {group.tables.map((table) => (
                    <Link
                      key={`${table.schema}.${table.name}`}
                      to="/resources/$id/data"
                      params={{ id }}
                      search={{ schema: table.schema, table: table.name }}
                      aria-current={table === chosen ? "page" : undefined}
                      title={table.name}
                      className={styles.table}
                    >
                      <span className={styles.tableName}>{table.name}</span>
                      <TableSize table={table} />
                    </Link>
                  ))}
                </div>
              ))
            )}
          </nav>

          <div className={styles.main}>
            <div className={styles.picker}>
              {tables.data === undefined ? (
                <Skeleton aria-hidden className={styles.pickerSkeleton} />
              ) : (
                <TablePicker id={id} groups={groups} chosen={chosen} showSchema={showSchema} />
              )}
            </div>
            {tables.data === undefined ? (
              <span className="sr-only">Loading tables</span>
            ) : chosen ? (
              <TableView
                key={`${chosen.schema}.${chosen.name}`}
                id={id}
                table={chosen}
                showSchema={showSchema}
              />
            ) : (
              <div className={styles.missingTable}>
                <p className={styles.missing}>
                  That table no longer exists. Pick another from the list.
                </p>
                <Link
                  to="/resources/$id/data"
                  params={{ id }}
                  search={{}}
                  className={buttonVariants({ variant: "outline", size: "default" })}
                >
                  Open the first table
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
