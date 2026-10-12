import type { Resource } from "@evertap/api/schemas";
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
import { Field, FieldLabel } from "@evertap/ui/components/field";
import { Input } from "@evertap/ui/components/input";
import { Spinner } from "@evertap/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { client, orpc } from "@/lib/orpc.ts";

import styles from "./delete-resource-dialog.module.css";

const DeleteForm = ({
  resource,
  onDone,
  onDeleted,
}: {
  resource: Resource;
  onDone: () => void;
  onDeleted?: () => void;
}) => {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");

  // The API refuses protected rows (that is what stops an agent); the human's click lifts it first.
  const remove = useMutation({
    mutationFn: async () => {
      if (resource.protected) {
        await client.resources.setProtected({ id: resource.id, protected: false });
      }
      await client.resources.delete({ id: resource.id });
    },
    onSuccess: async () => {
      onDone();
      onDeleted?.();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.resources.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.system.key() }),
      ]);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const armed = !resource.protected || typed.trim() === resource.name;

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (armed && !remove.isPending) {
          remove.mutate();
        }
      }}
    >
      {resource.protected ? (
        <Field>
          <FieldLabel htmlFor="delete-db-name" className={styles.confirmLabel}>
            Type <span className={styles.name}>{resource.name}</span> to confirm
          </FieldLabel>
          <Input
            id="delete-db-name"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            placeholder={resource.name}
            autoComplete="off"
            spellCheck={false}
            className={styles.confirmInput}
            autoFocus
          />
        </Field>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={!armed || remove.isPending}>
          {remove.isPending ? <Spinner /> : null}
          {resource.protected ? "Remove protection and delete" : "Delete"}
        </Button>
      </AlertDialogFooter>
    </form>
  );
};

export const DeleteResourceDialog = ({
  resource,
  open,
  onOpenChange,
  onDeleted,
}: {
  resource: Resource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className={styles.dialog}>
      <AlertDialogHeader>
        <AlertDialogTitle className={styles.title}>Delete {resource.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          {resource.kind === "object-storage"
            ? "The bucket, every bucket its apps created, and all their objects are deleted immediately and cannot be restored. Apps using them will lose access."
            : "The data is gone immediately and cannot be restored. Apps connected to it will start failing."}
          {resource.protected ? " This resource is protected from deletion." : ""}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <DeleteForm
        resource={resource}
        onDone={() => {
          onOpenChange(false);
        }}
        onDeleted={onDeleted}
      />
    </AlertDialogContent>
  </AlertDialog>
);
