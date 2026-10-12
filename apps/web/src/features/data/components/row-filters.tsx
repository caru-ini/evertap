import type { Column, RowFilter } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import { Input } from "@evertap/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@evertap/ui/components/select";
import { PlusIcon, XIcon } from "@phosphor-icons/react";

import styles from "./row-filters.module.css";

export type FilterOp = RowFilter["op"];

/** A filter being edited; `id` keeps React's rows apart while columns repeat. */
export type FilterDraft = { id: number; column: string; op: FilterOp; value: string };

export const OPERATORS: readonly { value: FilterOp; label: string }[] = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
  { value: "lt", label: "is less than" },
  { value: "gt", label: "is greater than" },
  { value: "contains", label: "contains" },
  { value: "null", label: "is NULL" },
  { value: "not-null", label: "is not NULL" },
];

const takesValue = (op: FilterOp) => op !== "null" && op !== "not-null";

export const toFilters = (drafts: FilterDraft[]): RowFilter[] =>
  drafts.map(({ column, op, value }) => ({ column, op, value: takesValue(op) ? value : "" }));

/** Column + operator + value rows, applied together so a half-typed value never runs. */
export const RowFilters = ({
  columns,
  drafts,
  onChange,
  onApply,
  onClear,
  dirty,
}: {
  columns: Column[];
  drafts: FilterDraft[];
  onChange: (drafts: FilterDraft[]) => void;
  onApply: () => void;
  onClear: () => void;
  dirty: boolean;
}) => {
  const update = (id: number, patch: Partial<FilterDraft>) => {
    onChange(drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  };
  const columnItems = columns.map((column) => ({ value: column.name, label: column.name }));

  return (
    <form
      aria-label="Filters"
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <ul className={styles.filters}>
        {drafts.map((draft, index) => (
          <li key={draft.id} className={styles.filter}>
            <span className={styles.joiner}>{index === 0 ? "Where" : "and"}</span>
            <Select
              items={columnItems}
              value={draft.column}
              onValueChange={(value) => {
                if (value !== null) update(draft.id, { column: value });
              }}
            >
              <SelectTrigger aria-label="Column" className={styles.column}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={styles.popup} alignItemWithTrigger={false}>
                {columnItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} className={styles.columnItem}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={OPERATORS}
              value={draft.op}
              onValueChange={(value) => {
                if (value !== null) update(draft.id, { op: value });
              }}
            >
              <SelectTrigger aria-label="Operator" className={styles.operator}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={styles.popup} alignItemWithTrigger={false}>
                {OPERATORS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {takesValue(draft.op) ? (
              <Input
                aria-label="Value"
                value={draft.value}
                onChange={(event) => {
                  update(draft.id, { value: event.target.value });
                }}
                placeholder="Value"
                autoComplete="off"
                spellCheck={false}
                className={styles.value}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove filter on ${draft.column}`}
              className={styles.remove}
              onClick={() => {
                onChange(drafts.filter((item) => item.id !== draft.id));
              }}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="ghost"
          size="default"
          className={styles.quiet}
          disabled={drafts.length >= 10}
          onClick={() => {
            const last = drafts.at(-1);
            onChange([
              ...drafts,
              {
                id: (last?.id ?? 0) + 1,
                column: last?.column ?? columns[0]?.name ?? "",
                op: "eq",
                value: "",
              },
            ]);
          }}
        >
          <PlusIcon />
          Add filter
        </Button>
        <Button type="submit" variant="secondary" size="default" disabled={!dirty}>
          Apply
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="default"
          className={styles.quiet}
          onClick={onClear}
        >
          Clear filters
        </Button>
      </div>
    </form>
  );
};
