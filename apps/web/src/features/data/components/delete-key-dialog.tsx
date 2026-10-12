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
import { Spinner } from "@evertap/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/lib/orpc.ts";

import { errorMessage } from "../error-message.ts";

import styles from "./delete-key-dialog.module.css";

export const DeleteKeyDialog = ({
  id,
  keyName,
  open,
  onOpenChange,
  onDeleted,
}: {
  id: string;
  keyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => Promise<void>;
}) => {
  const queryClient = useQueryClient();
  const remove = useMutation(
    orpc.data.deleteKey.mutationOptions({
      onSuccess: async () => {
        onOpenChange(false);
        await onDeleted();
        // Only after leaving the key, or the open detail would fetch it again; a new key of this name starts clean.
        queryClient.removeQueries({ queryKey: orpc.data.key.key({ input: { id, key: keyName } }) });
        await queryClient.invalidateQueries({ queryKey: orpc.data.keys.key() });
      },
      onError: (error) => {
        toast.error(errorMessage(error));
      },
    }),
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={styles.title}>
            Delete <span className={styles.keyName}>{keyName}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The key and its value are removed immediately and cannot be restored.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate({ id, key: keyName });
            }}
          >
            {remove.isPending ? <Spinner /> : null}
            Delete key
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
