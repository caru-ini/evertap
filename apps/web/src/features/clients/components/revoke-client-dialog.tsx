import type { Client } from "@evertap/api/schemas";
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

import { formatDate, formatTimeAgo } from "@/lib/format.ts";
import { orpc } from "@/lib/orpc.ts";

import styles from "./revoke-client-dialog.module.css";

/** The row leaving the list is the feedback; only failures speak. */
export const RevokeClientDialog = ({
  client,
  now,
  open,
  onOpenChange,
}: {
  client: Client;
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const queryClient = useQueryClient();
  const revoke = useMutation(
    orpc.clients.revoke.mutationOptions({
      onSuccess: async () => {
        onOpenChange(false);
        await queryClient.invalidateQueries({ queryKey: orpc.clients.key() });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={styles.title}>Revoke {client.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {client.kind === "api-key"
              ? "Anything using this key stops working immediately. Create a new key to replace it."
              : client.kind === "browser"
                ? "That browser is signed out immediately. Signing in again needs a code approved here."
                : "This CLI and the agents using it stop working immediately. Run evertap login on that machine to pair it again."}
          </AlertDialogDescription>
          {/* A machine paired twice has two rows with one name; the dates tell them apart. */}
          <p className={styles.dates}>
            Added {formatDate(client.createdAt)} ·{" "}
            {client.lastUsedAt
              ? `last used ${formatTimeAgo(client.lastUsedAt, now)}`
              : "never used"}
            {client.lastUsedIp ? ` from ${client.lastUsedIp}` : ""}
          </p>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revoke.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => {
              revoke.mutate({ id: client.id });
            }}
          >
            {revoke.isPending ? <Spinner /> : null}
            Revoke
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
