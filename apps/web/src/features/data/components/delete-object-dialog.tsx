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

import styles from "./delete-object-dialog.module.css";

export const DeleteObjectDialog = ({
  id,
  bucket,
  objectKey,
  onOpenChange,
}: {
  id: string;
  /** One of the resource's buckets; undefined for its first. */
  bucket: string | undefined;
  /** The object to delete; null keeps the dialog closed. */
  objectKey: string | null;
  onOpenChange: (open: boolean) => void;
}) => {
  const queryClient = useQueryClient();
  const remove = useMutation(
    orpc.data.deleteObject.mutationOptions({
      onSuccess: async () => {
        onOpenChange(false);
        await queryClient.invalidateQueries({ queryKey: orpc.data.objects.key() });
      },
      onError: (error) => {
        toast.error(errorMessage(error));
      },
    }),
  );

  return (
    <AlertDialog open={objectKey !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={styles.title}>
            Delete <span className={styles.objectKey}>{objectKey}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The object is removed from the bucket immediately and cannot be restored.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending || objectKey === null}
            onClick={() => {
              if (objectKey !== null) {
                remove.mutate({ id, bucket, key: objectKey });
              }
            }}
          >
            {remove.isPending ? <Spinner /> : null}
            Delete object
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
