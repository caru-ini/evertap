import type { Table } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@evertap/ui/components/command";
import { CaretUpDownIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import styles from "./table-picker.module.css";

const ESTIMATE = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

// Table names are identifiers: part of the name as typed, not cmdk's fuzzy match.
const matchName = (value: string, search: string) =>
  value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0;

/** "view", or the row estimate, beside a table's name. */
export const TableSize = ({ table }: { table: Table }) =>
  table.kind === "view" ? (
    <span className={styles.kind}>view</span>
  ) : table.rowEstimate !== null ? (
    <span className={styles.estimate}>~{ESTIMATE.format(table.rowEstimate)}</span>
  ) : null;

/** Narrow widths: the chosen table as one button that opens a searchable list of the rest. */
export const TablePicker = ({
  id,
  groups,
  chosen,
  showSchema,
}: {
  id: string;
  groups: { schema: string; tables: Table[] }[];
  chosen: Table | undefined;
  showSchema: boolean;
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        aria-haspopup="dialog"
        className={styles.trigger}
        onClick={() => {
          setOpen(true);
        }}
      >
        <span className="sr-only">Table:</span>
        <span className={styles.chosen}>
          {showSchema && chosen ? <span className={styles.schema}>{chosen.schema}.</span> : null}
          {chosen?.name ?? "Choose a table"}
        </span>
        {chosen ? <TableSize table={chosen} /> : null}
        <CaretUpDownIcon aria-hidden className={styles.caret} />
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Tables"
        description="Find a table by name"
      >
        <Command filter={matchName}>
          <CommandInput placeholder="Find a table" />
          <CommandList className={styles.list}>
            <CommandEmpty className={styles.empty}>
              No table matches. Try part of the name.
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.schema} heading={showSchema ? group.schema : undefined}>
                {group.tables.map((table) => (
                  <CommandItem
                    key={`${table.schema}.${table.name}`}
                    value={`${table.schema}.${table.name}`}
                    data-checked={table === chosen}
                    className={styles.item}
                    onSelect={() => {
                      setOpen(false);
                      void navigate({
                        to: "/resources/$id/data",
                        params: { id },
                        search: { schema: table.schema, table: table.name },
                      });
                    }}
                  >
                    <span className={styles.name}>{table.name}</span>
                    <TableSize table={table} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
};
