import { DESCRIPTION_MAX } from "@evertap/api/rules";
import type { Resource } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import { Input } from "@evertap/ui/components/input";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/lib/orpc.ts";

import styles from "./note-editor.module.css";

/** The note under a resource's name, edited in place: Enter or leaving the field saves, Escape cancels. */
export const NoteEditor = ({ resource }: { resource: Resource }) => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const returnFocus = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Escape unmounts the field, and some browsers blur it on the way out; that blur must not save.
  const cancelled = useRef(false);
  const save = useMutation(
    orpc.resources.setDescription.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.resources.key() });
        setDraft(null);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  useEffect(() => {
    if (draft === null && returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [draft]);

  if (draft !== null) {
    const commit = () => {
      if (save.isPending || cancelled.current) {
        return;
      }
      if (draft.trim() === resource.description) {
        setDraft(null);
        return;
      }
      save.mutate({ id: resource.id, description: draft });
    };
    return (
      <Input
        aria-label="Note"
        autoFocus
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            returnFocus.current = true;
            commit();
          } else if (event.key === "Escape") {
            cancelled.current = true;
            returnFocus.current = true;
            setDraft(null);
          }
        }}
        readOnly={save.isPending}
        maxLength={DESCRIPTION_MAX}
        placeholder="What it's for, in a few words"
        className={styles.input}
      />
    );
  }

  const edit = () => {
    cancelled.current = false;
    setDraft(resource.description);
  };

  if (!resource.description) {
    return (
      <Button ref={trigger} variant="ghost" size="xs" onClick={edit} className={styles.add}>
        <PencilSimpleIcon data-icon="inline-start" />
        Add note
      </Button>
    );
  }

  return (
    <button ref={trigger} type="button" onClick={edit} className={styles.note}>
      <span className="sr-only">Edit note: </span>
      <span className={styles.text}>{resource.description}</span>
      <PencilSimpleIcon aria-hidden className={styles.pencil} />
    </button>
  );
};
