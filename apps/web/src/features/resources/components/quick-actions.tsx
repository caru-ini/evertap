import type { Resource } from "@evertap/api/schemas";
import { Button, buttonVariants } from "@evertap/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@evertap/ui/components/tooltip";
import {
  FolderOpenIcon,
  RowsIcon,
  ShieldCheckIcon,
  ShieldIcon,
  TableIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { useSetProtected } from "@/lib/use-set-protected.ts";

import styles from "./quick-actions.module.css";

const shortcut = (className?: string) =>
  buttonVariants({ variant: "outline", size: "lg", className });

const ProtectAction = ({ resource }: { resource: Resource }) => {
  const setProtected = useSetProtected();
  const label = resource.protected ? "Allow deletion" : "Protect from deletion";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="icon-lg"
            className={styles.iconAction}
            aria-label="Protect from deletion"
            aria-pressed={resource.protected}
            disabled={setProtected.isPending}
            onClick={() => {
              setProtected.mutate({ id: resource.id, protected: !resource.protected });
            }}
          >
            {resource.protected ? (
              <ShieldCheckIcon weight="fill" className={styles.done} />
            ) : (
              <ShieldIcon />
            )}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

/** The page's shortcuts, beside the name: named ways into the data page, then protection. */
export const QuickActions = ({ resource }: { resource: Resource }) => (
  // Under the name the protect icon goes: touch has no tooltip to name it, and the Protection
  // switch below does the same.
  <div className={styles.actions}>
    {resource.kind === "object-storage" ? (
      <Link to="/resources/$id/data" params={{ id: resource.id }} className={shortcut(styles.keys)}>
        <FolderOpenIcon />
        Objects
      </Link>
    ) : resource.engine === "redis" ? (
      <Link to="/resources/$id/data" params={{ id: resource.id }} className={shortcut(styles.keys)}>
        <RowsIcon />
        Keys
      </Link>
    ) : resource.kind === "database" ? (
      <>
        <Link
          to="/resources/$id/data"
          params={{ id: resource.id }}
          className={shortcut(styles.shortcut)}
        >
          <TableIcon />
          Tables
        </Link>
        <Link
          to="/resources/$id/data"
          params={{ id: resource.id }}
          search={{ sql: true }}
          className={shortcut(styles.shortcut)}
        >
          <TerminalWindowIcon />
          SQL
        </Link>
      </>
    ) : null}
    <ProtectAction resource={resource} />
  </div>
);
