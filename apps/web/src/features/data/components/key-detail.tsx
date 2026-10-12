import { REDIS_VALUE_MAX, type RedisKey } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import { Input } from "@evertap/ui/components/input";
import { Skeleton } from "@evertap/ui/components/skeleton";
import { Spinner } from "@evertap/ui/components/spinner";
import { FloppyDiskIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { FormatSwitch } from "@/components/format-switch.tsx";
import { client, orpc } from "@/lib/orpc.ts";

import { errorMessage } from "../error-message.ts";
import {
  type KeyBase,
  REDIS_TYPES,
  type SavePlan,
  expiryError,
  formatTtl,
  fromDraft,
  isValueDirty,
  planSave,
  toDraft,
  toExpiry,
} from "../redis-draft.ts";
import { DeleteKeyDialog } from "./delete-key-dialog.tsx";
import { LoadError } from "./load-error.tsx";
import { ValueEditor } from "./value-editor.tsx";

import styles from "./key-detail.module.css";

const COUNT = new Intl.NumberFormat("en");

const EXPIRY = [
  { id: "never", label: "No expiry" },
  { id: "after", label: "Expires after" },
] as const;

const typeLabel = (type: string) => REDIS_TYPES.find((item) => item.id === type)?.label ?? type;

const size = (key: RedisKey) => {
  const value = key.value;
  if (value === null || value.type === "string") return null;
  const count =
    value.type === "hash"
      ? value.entries.length
      : value.type === "list"
        ? value.items.length
        : value.members.length;
  const noun = value.type === "hash" ? "field" : value.type === "list" ? "item" : "member";
  return `${COUNT.format(count)}${key.truncated ? "+" : ""} ${noun}${count === 1 ? "" : "s"}`;
};

// Read in event handlers only, where the time a save lands is what the countdown starts from.
const clock = () => Date.now();

/** The loaded key, its value in a draft, and the expiry; the draft follows fresh reads until edited. */
const KeyEditor = ({
  id,
  loaded,
  loadedAt,
  onDeleted,
}: {
  id: string;
  loaded: RedisKey;
  loadedAt: number;
  onDeleted: () => Promise<void>;
}) => {
  const queryClient = useQueryClient();
  const expiryId = useId();
  // What is on the box as far as this editor knows: the read, then each save.
  const [base, setBase] = useState<KeyBase>(() => ({
    value: loaded.value,
    ttlMs: loaded.ttlMs,
    at: loadedAt,
  }));
  const [draft, setDraft] = useState(() => (loaded.value ? toDraft(loaded.value) : null));
  const [expiry, setExpiry] = useState(() => toExpiry(loaded.ttlMs));
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [seenAt, setSeenAt] = useState(loadedAt);
  const [deleting, setDeleting] = useState(false);

  const save = useMutation({
    mutationFn: (plan: SavePlan) =>
      plan.kind === "write"
        ? client.data.writeKey({ id, key: loaded.key, value: plan.value, ttlMs: plan.ttlMs })
        : client.data.expireKey({ id, key: loaded.key, ttlMs: plan.ttlMs }),
    onSuccess: async (_, plan) => {
      const at = clock();
      setBase((current) => ({
        value: plan.kind === "write" ? plan.value : current.value,
        ttlMs: plan.ttlMs,
        at,
      }));
      setExpiryTouched(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.data.key.key({ input: { id, key: loaded.key } }),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.data.keys.key() }),
      ]);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  const editable = loaded.value !== null && !loaded.truncated;
  const valueDirty = editable && isValueDirty(base.value, draft);
  const dirty = valueDirty || expiryTouched;

  // A newer read replaces an unedited draft, so Save never writes back an old value.
  if (loadedAt !== seenAt) {
    setSeenAt(loadedAt);
    if (!dirty) {
      setBase({ value: loaded.value, ttlMs: loaded.ttlMs, at: loadedAt });
      setDraft(loaded.value ? toDraft(loaded.value) : null);
      setExpiry(toExpiry(loaded.ttlMs));
    }
  }

  const parsed = valueDirty && draft ? fromDraft(draft) : null;
  const error = parsed && !parsed.ok ? parsed.error : expiryError(expiry);

  const submit = () => {
    if (!dirty || save.isPending) return;
    const plan = planSave({ base, draft, expiry, expiryTouched, editable, now: clock() });
    if (plan) save.mutate(plan);
  };

  const meta = [
    typeLabel(loaded.type),
    size(loaded),
    base.ttlMs === null ? "No expiry" : `Expires in ${formatTtl(base.ttlMs)}`,
  ].filter((item) => item !== null);

  return (
    <>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      >
        <div className={styles.header}>
          <div className={styles.heading}>
            <h2 className={styles.keyName}>{loaded.key}</h2>
            <p className={styles.meta}>{meta.join(" · ")}</p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="default"
            onClick={() => {
              setDeleting(true);
            }}
          >
            <TrashIcon />
            Delete key…
          </Button>
        </div>

        {draft === null ? (
          <p className={styles.unreadable}>
            This value can&apos;t be shown or edited here. Change it with a Redis client such as
            redis-cli.
          </p>
        ) : (
          <>
            {loaded.truncated ? (
              <p className={styles.truncated}>
                Only the first {COUNT.format(REDIS_VALUE_MAX)} items are shown, so the value is
                read-only here. Change it with a Redis client such as redis-cli.
              </p>
            ) : null}
            <ValueEditor
              draft={draft}
              onChange={setDraft}
              readOnly={!editable}
              label={loaded.key}
            />
          </>
        )}

        <div className={styles.expiry}>
          <h3 aria-hidden className={styles.expiryTitle}>
            Expiry
          </h3>
          <div className={styles.expiryRow}>
            <FormatSwitch
              legend="Expiry"
              options={EXPIRY}
              value={expiry.mode}
              onChange={(mode) => {
                setExpiry({
                  mode,
                  seconds: expiry.seconds === "" ? "3600" : expiry.seconds,
                });
                setExpiryTouched(true);
              }}
            />
            {expiry.mode === "after" ? (
              <span className={styles.seconds}>
                <Input
                  id={expiryId}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  aria-label="Seconds until the key expires"
                  aria-invalid={expiryError(expiry) !== null}
                  value={expiry.seconds}
                  onChange={(event) => {
                    setExpiry({ ...expiry, seconds: event.target.value });
                    setExpiryTouched(true);
                  }}
                  className={styles.secondsInput}
                />
                <label htmlFor={expiryId} className={styles.secondsLabel}>
                  seconds
                </label>
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.actions}>
          <Button type="submit" size="lg" disabled={!dirty || error !== null || save.isPending}>
            {save.isPending ? <Spinner /> : <FloppyDiskIcon />}
            Save
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={save.isPending}
              onClick={() => {
                // Back to the newer of the last read and the last save.
                const latest =
                  loadedAt >= base.at
                    ? { value: loaded.value, ttlMs: loaded.ttlMs, at: loadedAt }
                    : base;
                setBase(latest);
                setDraft(latest.value ? toDraft(latest.value) : null);
                setExpiry(toExpiry(latest.ttlMs));
                setExpiryTouched(false);
              }}
            >
              Discard changes
            </Button>
          ) : null}
          {dirty && error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : (
            <p className={styles.hint}>
              {editable
                ? "Saving a changed value replaces all of it."
                : "Only the expiry can be changed here."}
            </p>
          )}
        </div>
      </form>
      <DeleteKeyDialog
        id={id}
        keyName={loaded.key}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={onDeleted}
      />
    </>
  );
};

/** One key's value by its type, or what to do when it cannot be read. */
export const KeyDetail = ({
  id,
  keyName,
  onDeleted,
}: {
  id: string;
  keyName: string;
  onDeleted: () => Promise<void>;
}) => {
  const key = useQuery(orpc.data.key.queryOptions({ input: { id, key: keyName } }));

  if (key.data) {
    return (
      <KeyEditor id={id} loaded={key.data} loadedAt={key.dataUpdatedAt} onDeleted={onDeleted} />
    );
  }
  if (key.isError) {
    return (
      <LoadError
        error={key.error}
        retrying={key.isFetching}
        onRetry={() => {
          void key.refetch();
        }}
      />
    );
  }
  return (
    <div aria-hidden className={styles.loading}>
      <Skeleton className={styles.loadingName} />
      <Skeleton className={styles.loadingMeta} />
      <Skeleton className={styles.loadingValue} />
    </div>
  );
};
