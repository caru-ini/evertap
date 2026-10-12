import { CLIENT_NAME_MAX } from "@evertap/api/rules";
import type { CreatedApiKey } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@evertap/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@evertap/ui/components/field";
import { Input } from "@evertap/ui/components/input";
import { Spinner } from "@evertap/ui/components/spinner";
import { PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { ConnectionUrl } from "@/components/connection-url.tsx";
import { orpc } from "@/lib/orpc.ts";

import styles from "./create-api-key-dialog.module.css";

const CreateApiKeyContent = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const create = useMutation(
    orpc.clients.createApiKey.mutationOptions({
      onSuccess: async (result) => {
        setCreated(result);
        await queryClient.invalidateQueries({ queryKey: orpc.clients.key() });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  if (created) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className={styles.readyTitle}>{created.client.name} is ready</DialogTitle>
          <DialogDescription>
            Copy the key now. evertap does not keep it, so it cannot be shown again.
          </DialogDescription>
        </DialogHeader>
        <ConnectionUrl
          value={`EVERTAP_API_KEY=${created.key}`}
          secrets={[created.key]}
          secretLabel="key"
          copyLabel="Copy .env line"
          size="lg"
        />
        <DialogFooter>
          <DialogClose render={<Button size="lg" variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </>
    );
  }

  const disabled = name.trim() === "" || create.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle className={styles.title}>New API key</DialogTitle>
        <DialogDescription>
          For CI and scripts that cannot run evertap login. A key can do everything a paired CLI
          can.
        </DialogDescription>
      </DialogHeader>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) create.mutate({ name });
        }}
      >
        <Field>
          <FieldLabel htmlFor="new-api-key-name">Name</FieldLabel>
          <Input
            id="new-api-key-name"
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            maxLength={CLIENT_NAME_MAX}
            placeholder="github-actions"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="new-api-key-name-help"
            aria-required="true"
            className={styles.nameInput}
          />
          <FieldDescription id="new-api-key-name-help">
            Where the key will be used, so you know which one to revoke later.
          </FieldDescription>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="lg" />}>Cancel</DialogClose>
          <Button type="submit" size="lg" disabled={disabled}>
            {create.isPending ? <Spinner /> : <PlusIcon />}
            Create
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};

export const CreateApiKeyDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={styles.content}>
      <CreateApiKeyContent />
    </DialogContent>
  </Dialog>
);
