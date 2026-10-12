import type { Cell, Column, RowFilter, RowKey, Table } from "@evertap/api/schemas";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@evertap/ui/components/alert-dialog";
import { Button } from "@evertap/ui/components/button";
import { Kbd } from "@evertap/ui/components/kbd";
import { Skeleton } from "@evertap/ui/components/skeleton";
import { Spinner } from "@evertap/ui/components/spinner";
import { cx } from "@evertap/ui/lib/cx";
import {
  CaretLeftIcon,
  CaretRightIcon,
  FloppyDiskIcon,
  FunnelIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { IS_MAC } from "@/lib/is-mac.ts";
import { orpc } from "@/lib/orpc.ts";

import { errorMessage } from "../error-message.ts";
import {
  NO_CHANGES,
  type ShownRow,
  type Staged,
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
} from "../row-changes.ts";
import { LoadError } from "./load-error.tsx";
import { type FilterDraft, RowFilters, toFilters } from "./row-filters.tsx";
import { RowsGrid, type Sort } from "./rows-grid.tsx";

import styles from "./table-view.module.css";

const PAGE_SIZE = 100;
const COUNT = new Intl.NumberFormat("en");
const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"];

const changes = (count: number) => `${COUNT.format(count)} unsaved change${count === 1 ? "" : "s"}`;

const readOnlyNote = (table: Table, columns: Column[]) => {
  if (table.kind === "view") {
    return "Views are read-only here. Change the rows in the tables it reads from, or run SQL in the console.";
  }
  if (!columns.some((column) => column.primaryKey)) {
    return "This table has no primary key, so its rows can't be told apart for editing. Add a primary key, or change rows with SQL in the console.";
  }
  return null;
};

/**
 * One table: filters, sortable columns, a page of rows, and the edits its primary key allows.
 * Edits are staged here, keyed by primary key, and written together by Save changes.
 */
export const TableView = ({
  id,
  table,
  showSchema,
}: {
  id: string;
  table: Table;
  showSchema: boolean;
}) => {
  const queryClient = useQueryClient();
  const ref = { schema: table.schema, name: table.name };
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<Sort>();
  const [drafts, setDrafts] = useState<FilterDraft[]>([]);
  const [filters, setFilters] = useState<RowFilter[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [staged, setStaged] = useState<Staged>(NO_CHANGES);
  const [editRequest, setEditRequest] = useState<{ rowId: string; column: string } | null>(null);

  const rows = useQuery(
    orpc.data.rows.queryOptions({
      input: { id, table: ref, offset: page * PAGE_SIZE, limit: PAGE_SIZE, sort, filters },
      placeholderData: keepPreviousData,
    }),
  );
  const save = useMutation(
    orpc.data.applyChanges.mutationOptions({
      // Cleared only once the saved rows are back, so edited cells never flash their old values.
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.data.key() });
        setStaged(NO_CHANGES);
        setSelected(new Set());
      },
    }),
  );
  // Any new change makes the last failure stale; the next Save reports afresh.
  const change = (next: Staged) => {
    setStaged(next);
    save.reset();
  };

  // A failed read (say, a filter value the column can't take) keeps the filter bar's columns.
  const [knownColumns, setKnownColumns] = useState<Column[]>([]);
  if (rows.data && rows.data.columns !== knownColumns) {
    setKnownColumns(rows.data.columns);
  }
  const columns = rows.data?.columns ?? knownColumns;
  const keyColumns = columns.flatMap((column, index) => (column.primaryKey ? [index] : []));
  const note = rows.data ? readOnlyNote(table, columns) : null;
  const editable = rows.data !== undefined && note === null;
  const keyOf = (row: Cell[]): RowKey =>
    Object.fromEntries(keyColumns.map((index) => [columns[index]?.name ?? "", row[index] ?? null]));
  const pageRows = rows.data?.rows ?? [];
  const rowIds = editable
    ? pageRows.map((row) => JSON.stringify(keyColumns.map((index) => row[index])))
    : [];
  const shown = showRows(editable ? staged : NO_CHANGES, columns, pageRows, rowIds);
  const selectedRows = pageRows.flatMap((row, index) => {
    const rowId = rowIds[index];
    return rowId !== undefined && selected.has(rowId) && !staged.deletes.has(rowId)
      ? [{ id: rowId, key: keyOf(row) }]
      : [];
  });

  const { total: count } = countChanges(staged);
  const dirty = count > 0;
  const tooLarge = changesTooLarge(staged);
  const locked = save.isPending;

  // Switching tables, going back, or closing the tab would drop the staged changes.
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) =>
      !(
        next.routeId === "/resources/$id_/data" &&
        next.params.id === id &&
        next.search.table === table.name &&
        (next.search.schema ?? table.schema) === table.schema &&
        next.search.sql !== true
      ),
    enableBeforeUnload: dirty,
    disabled: !dirty,
    withResolver: true,
  });

  const submit = () => {
    if (!dirty || locked || tooLarge !== null || blocker.status === "blocked") return;
    save.mutate({ id, table: ref, changes: toRowChanges(staged) });
  };

  // The window listener outlives renders, so it calls the latest `submit`. An open cell editor
  // stages its value on the same keydown; that renders before this listener runs.
  const latestSubmit = useRef(submit);
  useLayoutEffect(() => {
    latestSubmit.current = submit;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        latestSubmit.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Deleting the last rows of the last page leaves it empty; show the page before it.
  if (rows.data && !rows.isPlaceholderData && pageRows.length === 0 && page > 0) {
    setPage(Math.max(Math.ceil(rows.data.total / PAGE_SIZE) - 1, 0));
  }

  const onEdit = (row: ShownRow, column: Column, value: string | null) => {
    if (row.status === "new") {
      change(stageNewValue(staged, row.id, column.name, value));
      return;
    }
    const index = rowIds.indexOf(row.id);
    const original = pageRows[index];
    if (original === undefined) return;
    const key = keyOf(original);
    const cell = original[columns.indexOf(column)] ?? null;
    change(stageEdit(staged, { id: row.id, key, original: cell }, column.name, value));
  };

  // Changing which rows are shown drops the selection, so Delete never marks rows out of sight.
  const reset = () => {
    setPage(0);
    setSelected(new Set());
  };
  const applied = JSON.stringify(filters);
  const filtersDirty = JSON.stringify(toFilters(drafts)) !== applied;
  const showFilters = drafts.length > 0 || filters.length > 0;

  const total = rows.data?.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = page * PAGE_SIZE + pageRows.length;
  const failure = tooLarge ?? (save.isError ? errorMessage(save.error) : null);

  return (
    <section aria-label={table.name} className={styles.view}>
      <div className={styles.bar}>
        <h2 className={styles.title}>
          {showSchema ? <span className={styles.schema}>{table.schema}.</span> : null}
          {table.name}
        </h2>
        {table.kind === "view" ? <span className={styles.viewBadge}>View</span> : null}
        <div className={styles.actions}>
          {selectedRows.length > 0 ? (
            <>
              <Button
                variant="ghost"
                size="default"
                className={styles.quiet}
                onClick={() => {
                  setSelected(new Set());
                }}
              >
                Clear selection
              </Button>
              <Button
                variant="destructive"
                size="lg"
                disabled={locked}
                onClick={() => {
                  change(markDeleted(staged, selectedRows));
                  setSelected(new Set());
                }}
              >
                <TrashIcon />
                Delete {selectedRows.length === 1 ? "1 row" : `${selectedRows.length} rows`}
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            size="lg"
            aria-expanded={showFilters}
            disabled={columns.length === 0}
            onClick={() => {
              if (drafts.length === 0) {
                setDrafts([{ id: 1, column: columns[0]?.name ?? "", op: "eq", value: "" }]);
              }
            }}
          >
            <FunnelIcon />
            Filter
            {filters.length > 0 ? (
              <span className={styles.filterCount}>{filters.length}</span>
            ) : null}
          </Button>
          {editable ? (
            <Button
              variant="outline"
              size="lg"
              disabled={locked}
              onClick={() => {
                const next = addRow(staged);
                const rowId = next.inserts[0]?.id;
                // Serial and other generated keys are left to their defaults.
                const first = columns.find((column) => column.default === null) ?? columns[0];
                change(next);
                if (rowId !== undefined && first) setEditRequest({ rowId, column: first.name });
              }}
            >
              <PlusIcon />
              Add row
            </Button>
          ) : null}
        </div>
      </div>

      {note ? <p className={styles.note}>{note}</p> : null}

      {showFilters ? (
        <RowFilters
          columns={columns}
          drafts={drafts}
          onChange={setDrafts}
          dirty={filtersDirty}
          onApply={() => {
            setFilters(toFilters(drafts));
            reset();
          }}
          onClear={() => {
            setDrafts([]);
            setFilters([]);
            reset();
          }}
        />
      ) : null}

      {rows.data ? (
        <>
          <RowsGrid
            columns={columns}
            rows={shown}
            editable={editable}
            locked={locked}
            busy={rows.isPlaceholderData}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              reset();
            }}
            selected={selected}
            onSelectedChange={setSelected}
            editRequest={editRequest}
            widthsKey={`${id}:${table.schema}.${table.name}`}
            onEdit={onEdit}
            onUndoRow={(row) => {
              change(undoRow(staged, row.id));
            }}
          />
          {shown.length === 0 ? (
            <p className={styles.empty}>
              {filters.length > 0
                ? "No rows match these filters. Change or clear them."
                : editable
                  ? "No rows yet. Add one with Add row."
                  : "No rows yet."}
            </p>
          ) : null}
          <div className={styles.pager}>
            <p className={styles.range} aria-live="polite">
              {total === 0
                ? "0 rows"
                : `${COUNT.format(from)}–${COUNT.format(to)} of ${COUNT.format(total)}`}
            </p>
            {rows.isFetching ? <Spinner className={styles.fetching} /> : null}
            <div className={styles.pages}>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous page"
                disabled={page === 0}
                className={cx(styles.quiet, styles.page)}
                onClick={() => {
                  setPage(page - 1);
                  setSelected(new Set());
                }}
              >
                <CaretLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next page"
                disabled={to >= total}
                className={cx(styles.quiet, styles.page)}
                onClick={() => {
                  setPage(page + 1);
                  setSelected(new Set());
                }}
              >
                <CaretRightIcon />
              </Button>
            </div>
          </div>
        </>
      ) : rows.isError ? (
        <LoadError
          error={rows.error}
          retrying={rows.isFetching}
          onRetry={() => {
            void rows.refetch();
          }}
        />
      ) : (
        <div aria-hidden className={styles.skeleton}>
          {SKELETON_ROWS.map((key) => (
            <div key={key} className={styles.skeletonRow}>
              <Skeleton className={styles.skeletonId} />
              <Skeleton className={styles.skeletonText} />
              <Skeleton className={styles.skeletonShort} />
            </div>
          ))}
          <span className="sr-only">Loading rows</span>
        </div>
      )}

      {dirty ? (
        <div role="region" aria-label="Unsaved changes" className={styles.unsaved}>
          <div className={styles.summary}>
            <p className={styles.count}>
              <span className={styles.total}>{changes(count)}</span>
              <span className={styles.parts}> · {describeChanges(staged)}</span>
            </p>
            {failure ? (
              <p role="alert" className={styles.failure}>
                {failure}
              </p>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="lg"
            disabled={locked}
            onClick={() => {
              change(NO_CHANGES);
            }}
          >
            Discard
          </Button>
          <Button size="lg" disabled={locked || tooLarge !== null} onClick={submit}>
            {locked ? <Spinner /> : <FloppyDiskIcon />}
            Save changes
            <Kbd className={styles.shortcut}>{IS_MAC ? "⌘S" : "Ctrl S"}</Kbd>
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className={styles.dialogTitle}>
              Discard {changes(count)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They haven&apos;t been saved to <span className={styles.tableName}>{table.name}</span>
              . Keep editing to save them first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              Discard changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
