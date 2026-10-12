import { type ConnectionFormat, formatConnection } from "@evertap/api/connections";
import type { Resource } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@evertap/ui/components/dropdown-menu";
import {
  CopyIcon,
  DotsThreeIcon,
  PushPinIcon,
  ShieldIcon,
  ShieldSlashIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { copyText } from "@/lib/clipboard.ts";
import { getConnectionFormats } from "@/lib/resource-connections.ts";
import { useKeepResource } from "@/lib/use-keep-resource.ts";
import { useSetProtected } from "@/lib/use-set-protected.ts";

import { DeleteResourceDialog } from "./delete-resource-dialog.tsx";

import styles from "./resource-actions.module.css";

export const ResourceActions = ({ resource }: { resource: Resource }) => {
  const [deleting, setDeleting] = useState(false);
  const setProtected = useSetProtected();
  const keep = useKeepResource();

  // The menu closes on click, so the toast is the only feedback this path has.
  const copyAs = async (format: ConnectionFormat) => {
    if (await copyText(formatConnection(resource, format))) {
      toast.success("Copied");
    } else {
      toast.error("Couldn't copy. Open the resource and copy the value by hand.");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" className={styles.trigger} />}
        >
          <DotsThreeIcon aria-hidden weight="bold" />
          <span className="sr-only">Actions for {resource.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={styles.menu}>
          {getConnectionFormats(resource)
            .filter((format) => format.id !== "credentials")
            .map((format) => (
              <DropdownMenuItem
                key={format.id}
                onClick={() => {
                  void copyAs(format.id);
                }}
              >
                <CopyIcon />
                {format.copyLabel}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          {resource.expiresAt ? (
            <DropdownMenuItem
              disabled={keep.isPending}
              onClick={() => {
                keep.mutate({ id: resource.id });
              }}
            >
              <PushPinIcon />
              Keep
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={setProtected.isPending}
            onClick={() => {
              setProtected.mutate({ id: resource.id, protected: !resource.protected });
            }}
          >
            {resource.protected ? <ShieldSlashIcon /> : <ShieldIcon />}
            {resource.protected ? "Remove protection" : "Protect from deletion"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              setDeleting(true);
            }}
          >
            <TrashIcon />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteResourceDialog resource={resource} open={deleting} onOpenChange={setDeleting} />
    </>
  );
};
