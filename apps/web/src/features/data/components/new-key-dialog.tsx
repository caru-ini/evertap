import type { RedisValue } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@evertap/ui/components/dialog";
import { Field, FieldLabel, FieldTitle } from "@evertap/ui/components/field";
import { Input } from "@evertap/ui/components/input";
import { Spinner } from "@evertap/ui/components/spinner";
import { PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { FormatSwitch } from "@/components/format-switch.tsx";
import { client, orpc } from "@/lib/orpc.ts";

import { errorMessage } from "../error-message.ts";
import { REDIS_TYPES, type RedisDraft, emptyDraft, fromDraft } from "../redis-draft.ts";
import { ValueEditor } from "./value-editor.tsx";

import styles from "./new-key-dialog.module.css";

const NewKeyForm = ({
  id,
  onCreated,
  onCancel,
}: {
  id: string;
  onCreated: (key: string) => void;
  onCancel: () => void;
}) => {
  const queryClient = useQueryClient();
  const nameId = useId();
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<RedisDraft>(() => emptyDraft("string"));
  const [touched, setTouched] = useState(false);

  // The API refuses an existing name, so creating never replaces a key; its message shows here.
  const create = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: RedisValue }) => {
      await client.data.writeKey({ id, key, value, ttlMs: null, createOnly: true });
      return key;
    },
    onSuccess: async (key) => {
      onCreated(key);
      await queryClient.invalidateQueries({ queryKey: orpc.data.key() });
    },
  });

  const parsed = fromDraft(draft);
  const nameError = touched && name === "" ? "Enter a key name." : null;
  const valueError = touched && !parsed.ok ? parsed.error : null;

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (name !== "" && parsed.ok && !create.isPending) {
          create.mutate({ key: name, value: parsed.value });
        }
      }}
    >
      <Field data-invalid={nameError !== null}>
        <FieldLabel htmlFor={nameId}>Key</FieldLabel>
        <Input
          id={nameId}
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            create.reset();
          }}
          placeholder="session:1234"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={nameError !== null}
          className={styles.keyInput}
        />
        {nameError ? <p className={styles.error}>{nameError}</p> : null}
        {create.isError ? (
          <p role="alert" className={styles.error}>
            {errorMessage(create.error)}
          </p>
        ) : null}
      </Field>
      <Field>
        <FieldTitle aria-hidden className={styles.fieldTitle}>
          Type
        </FieldTitle>
        <FormatSwitch
          legend="Type"
          options={REDIS_TYPES}
          value={draft.type}
          onChange={(type) => {
            setDraft(emptyDraft(type));
          }}
        />
      </Field>
      <Field>
        <FieldTitle aria-hidden className={styles.fieldTitle}>
          Value
        </FieldTitle>
        <ValueEditor draft={draft} onChange={setDraft} label={name || "the new key"} />
        {valueError ? <p className={styles.error}>{valueError}</p> : null}
      </Field>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={create.isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={create.isPending}>
          {create.isPending ? <Spinner /> : <PlusIcon />}
          Create key
        </Button>
      </DialogFooter>
    </form>
  );
};

export const NewKeyDialog = ({
  id,
  open,
  onOpenChange,
  onCreated,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (key: string) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={styles.content}>
      <DialogHeader>
        <DialogTitle className={styles.title}>New key</DialogTitle>
        <DialogDescription>
          The key never expires; set an expiry after creating it.
        </DialogDescription>
      </DialogHeader>
      <NewKeyForm
        id={id}
        onCreated={(key) => {
          onOpenChange(false);
          onCreated(key);
        }}
        onCancel={() => {
          onOpenChange(false);
        }}
      />
    </DialogContent>
  </Dialog>
);
