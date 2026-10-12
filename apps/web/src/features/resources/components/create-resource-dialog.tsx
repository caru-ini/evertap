import {
  DATABASE_VERSIONS,
  DESCRIPTION_MAX,
  RESOURCE_NAME_MAX,
  isDatabaseEngine,
  resourceNameError,
  type DatabaseEngine,
  type ResourceEngine,
} from "@evertap/api/rules";
import type { Resource, Extension } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@evertap/ui/components/combobox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@evertap/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@evertap/ui/components/field";
import { Input } from "@evertap/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@evertap/ui/components/select";
import { Spinner } from "@evertap/ui/components/spinner";
import { cx } from "@evertap/ui/lib/cx";
import { ORPCError } from "@orpc/client";
import { ArrowLeftIcon, CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { FormatSwitch } from "@/components/format-switch.tsx";
import { ResourceIcon } from "@/components/resource-icon.tsx";
import { orpc } from "@/lib/orpc.ts";
import { ENGINE_INFO, RESOURCE_GROUPS } from "@/lib/resource-engines.ts";

import { ConnectionPanel } from "./connection-panel.tsx";

import styles from "./create-resource-dialog.module.css";

const matches = (extension: Extension, query: string) => {
  const needle = query.trim().toLowerCase();
  return (
    extension.name.toLowerCase().includes(needle) ||
    extension.description.toLowerCase().includes(needle)
  );
};

/** Multi-select over what the instance ships, searched by name or comment. */
const ExtensionPicker = ({
  version,
  value,
  onChange,
}: {
  version: (typeof DATABASE_VERSIONS.postgresql)[number];
  value: Extension[];
  onChange: (value: Extension[]) => void;
}) => {
  const anchor = useComboboxAnchor();
  const extensions = useQuery(orpc.extensions.list.queryOptions({ input: { version } }));
  const loading = extensions.isPending;

  if (extensions.isError && extensions.data === undefined) {
    return (
      <div className={styles.retry}>
        <p role="alert" className={styles.retryText}>
          {/* While the version's first download runs, the API says when to try again. */}
          {extensions.error instanceof ORPCError && extensions.error.code === "SERVICE_UNAVAILABLE"
            ? extensions.error.message
            : "Try loading extensions again, or create without them."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="default"
          disabled={extensions.isFetching}
          onClick={() => {
            void extensions.refetch();
          }}
        >
          {extensions.isFetching ? <Spinner /> : null}
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Combobox
      multiple
      autoHighlight
      items={extensions.data ?? []}
      value={value}
      onValueChange={onChange}
      itemToStringLabel={(extension) => extension.name}
      isItemEqualToValue={(a, b) => a.name === b.name}
      filter={matches}
    >
      <ComboboxChips ref={anchor} className={styles.chips}>
        <ComboboxValue>
          {(selected: Extension[]) => (
            <>
              {selected.map((extension) => (
                <ComboboxChip
                  key={extension.name}
                  aria-label={extension.name}
                  className={styles.chip}
                >
                  {extension.name}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                id="new-db-extensions"
                disabled={loading}
                placeholder={
                  loading ? "Loading…" : selected.length > 0 ? "" : "Search by name or purpose"
                }
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor} className={styles.popup}>
        <ComboboxEmpty>
          {extensions.data?.length === 0 ? "No extensions available." : "No extension matches."}
        </ComboboxEmpty>
        <ComboboxList>
          {(extension: Extension) => (
            <ComboboxItem key={extension.name} value={extension} className={styles.extension}>
              <span className={styles.extensionText}>
                <span className={styles.extensionName}>{extension.name}</span>
                <span className={styles.extensionDescription}>{extension.description}</span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
};

/** A create past this is likely the first of its version: a download and a first start. */
const SLOW_CREATE_MS = 5000;

// MySQL offers LTS lines only (rules.ts); PostgreSQL and Redis have no LTS line to mark.
const versionLabel = (engine: DatabaseEngine, version: string) =>
  engine === "mysql" ? `${version} LTS` : version;

/** Latest first, the rest one step away: most people want the newest and never look further. */
const VersionPicker = ({
  engine,
  value,
  onChange,
}: {
  engine: DatabaseEngine;
  value: string;
  onChange: (version: string) => void;
}) => {
  const [latest = "", ...others] = DATABASE_VERSIONS[engine];
  const [next] = others;
  const items = others.map((item) => ({ value: item, label: versionLabel(engine, item) }));
  const modes = [
    { id: "latest", label: `Latest (${versionLabel(engine, latest)})` },
    // One other version is shown by name; more open a list.
    ...(next === undefined
      ? []
      : [
          {
            id: "other",
            label: others.length === 1 ? versionLabel(engine, next) : "Other versions",
          },
        ]),
  ] as const;

  return (
    <div className={styles.version}>
      <FormatSwitch
        legend="Version"
        options={modes}
        value={value === latest ? "latest" : "other"}
        onChange={(mode) => {
          onChange(mode === "latest" ? latest : (next ?? latest));
        }}
      />
      {value !== latest && others.length > 1 ? (
        <Select
          items={items}
          value={value}
          onValueChange={(version) => {
            if (version !== null) onChange(version);
          }}
        >
          <SelectTrigger aria-label="Other version" className={styles.versionSelect}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={styles.popup} alignItemWithTrigger={false}>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value} className={styles.mono}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
};

const CreateForm = ({
  onCreated,
  initialEngine,
}: {
  onCreated: (resource: Resource) => void;
  initialEngine?: ResourceEngine;
}) => {
  const queryClient = useQueryClient();
  const engineGroup = useId();
  const status = useQuery(orpc.system.status.queryOptions());
  // Until the status arrives every service stays selectable; the API refuses what it cannot make.
  const available = (engine: ResourceEngine) =>
    status.data === undefined || status.data.engines.includes(engine);
  // Service remembers the last choice so returning from Details can mark it.
  const [step, setStep] = useState<
    { id: "engine"; engine?: ResourceEngine } | { id: "details"; engine: ResourceEngine }
  >(
    initialEngine === undefined || !available(initialEngine)
      ? { id: "engine" }
      : { id: "details", engine: initialEngine },
  );
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [extensions, setExtensions] = useState<Extension[]>([]);
  // Unset means the newest; another engine's versions mean nothing here, so switching clears it.
  const [chosenVersion, setChosenVersion] = useState<string>();

  const create = useMutation(
    orpc.resources.create.mutationOptions({
      onSuccess: async (resource) => {
        onCreated(resource);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.resources.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.system.key() }),
        ]);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = create.isPending
      ? setTimeout(() => {
          setSlow(true);
        }, SLOW_CREATE_MS)
      : undefined;
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [create.isPending]);

  const trimmed = name.trim();
  const nameError =
    step.id === "engine" || trimmed === "" ? null : resourceNameError(trimmed, step.engine);
  const showNameError = touched && nameError !== null;
  const storage = step.engine === "garage";
  const versions =
    step.engine !== undefined && isDatabaseEngine(step.engine)
      ? DATABASE_VERSIONS[step.engine]
      : [];
  const version = versions.find((item) => item === chosenVersion) ?? versions[0];
  const disabled = trimmed === "" || nameError !== null || create.isPending;
  const backToService = () => {
    setStep({ id: "engine", engine: step.engine });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className={styles.title}>
          {step.id === "engine"
            ? "New resource"
            : `New ${ENGINE_INFO[step.engine].label} ${storage ? "bucket" : "database"}`}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {step.id === "engine"
            ? "Choose a database or object storage."
            : "Add a name and optional details."}
        </DialogDescription>
      </DialogHeader>
      <ol aria-label="Creation progress" className={styles.steps}>
        {[
          { id: "engine", label: "Service" },
          { id: "details", label: "Details" },
        ].map((item, index) => {
          const active = step.id === item.id;
          const complete = item.id === "engine" && step.id === "details";
          const label = (
            <>
              <span className={styles.stepNumber}>
                {complete ? (
                  <CheckIcon aria-hidden className={styles.stepCheck} weight="bold" />
                ) : (
                  index + 1
                )}
              </span>
              {item.label}
              {complete ? <span className="sr-only">Completed</span> : null}
            </>
          );
          return (
            <li key={item.id} aria-current={active ? "step" : undefined} className={styles.step}>
              {complete ? (
                <button
                  type="button"
                  aria-label="Back to Service"
                  disabled={create.isPending}
                  onClick={backToService}
                  className={styles.stepButton}
                >
                  {label}
                </button>
              ) : (
                <span className={styles.stepLabel}>{label}</span>
              )}
            </li>
          );
        })}
      </ol>
      {step.id === "engine" ? (
        <FieldSet>
          <FieldLegend className="sr-only">Resource type</FieldLegend>
          {RESOURCE_GROUPS.map((group) => (
            <div key={group.id} role="group" aria-labelledby={`${engineGroup}-${group.id}`}>
              <h3 id={`${engineGroup}-${group.id}`} className={styles.groupTitle}>
                {group.label}
              </h3>
              <div className={styles.engines}>
                {group.engines.map((engineId) => (
                  <button
                    key={engineId}
                    type="button"
                    disabled={!available(engineId)}
                    aria-pressed={step.engine === engineId}
                    autoFocus={step.engine === engineId}
                    onClick={() => {
                      if (engineId !== step.engine) {
                        setChosenVersion(undefined);
                      }
                      setStep({ id: "details", engine: engineId });
                    }}
                    className={styles.engine}
                  >
                    <span className={styles.engineName}>
                      <ResourceIcon engine={engineId} />
                      {ENGINE_INFO[engineId].label}
                    </span>
                    <span className={styles.engineSummary}>
                      {available(engineId) ? ENGINE_INFO[engineId].summary : "Not available yet"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </FieldSet>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (!disabled) {
              create.mutate({
                engine: step.engine,
                name: trimmed,
                description: description.trim(),
                version,
                extensions:
                  step.engine === "postgresql" ? extensions.map((extension) => extension.name) : [],
              });
            }
          }}
        >
          <div className={styles.fields}>
            <Field data-invalid={showNameError}>
              <FieldLabel htmlFor="new-db-name">{storage ? "Bucket name" : "Name"}</FieldLabel>
              <Input
                id="new-db-name"
                autoFocus
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                onBlur={() => {
                  setTouched(true);
                }}
                maxLength={RESOURCE_NAME_MAX}
                placeholder={ENGINE_INFO[step.engine].placeholder}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showNameError}
                aria-describedby="new-db-name-help"
                aria-required="true"
                className={styles.nameInput}
              />
              {showNameError ? (
                <FieldError id="new-db-name-help">{nameError}</FieldError>
              ) : (
                <FieldDescription id="new-db-name-help">
                  {ENGINE_INFO[step.engine].nameHint}
                </FieldDescription>
              )}
            </Field>

            {version !== undefined && step.engine !== undefined && isDatabaseEngine(step.engine) ? (
              <Field>
                <FieldTitle aria-hidden className={styles.versionTitle}>
                  Version
                </FieldTitle>
                <VersionPicker engine={step.engine} value={version} onChange={setChosenVersion} />
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="new-db-description">
                Note <span className={styles.optional}>optional</span>
              </FieldLabel>
              <Input
                id="new-db-description"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
                maxLength={DESCRIPTION_MAX}
                placeholder="What it's for, in a few words"
                className={styles.noteInput}
              />
            </Field>

            {step.engine === "postgresql" ? (
              <Field>
                <FieldLabel htmlFor="new-db-extensions">
                  Extensions <span className={styles.optional}>optional</span>
                </FieldLabel>
                <ExtensionPicker
                  version={
                    DATABASE_VERSIONS.postgresql.find((item) => item === version) ??
                    DATABASE_VERSIONS.postgresql[0]
                  }
                  value={extensions}
                  onChange={setExtensions}
                />
                <FieldDescription>Search available extensions by name or purpose.</FieldDescription>
              </Field>
            ) : null}
          </div>

          {slow ? (
            <p role="status" className={styles.slow}>
              The first {ENGINE_INFO[step.engine].label}{" "}
              {storage ? "bucket" : `${version ?? ""} database`} takes a few minutes to set up.
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={create.isPending}
              onClick={backToService}
            >
              <ArrowLeftIcon aria-hidden />
              Back
            </Button>
            <Button type="submit" size="lg" disabled={disabled}>
              {create.isPending ? <Spinner /> : <PlusIcon />}
              Create
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
};

const CreateResourceContent = ({ initialEngine }: { initialEngine?: ResourceEngine }) => {
  const [created, setCreated] = useState<Resource | null>(null);

  return created ? (
    <>
      <DialogHeader>
        <DialogTitle className={cx(styles.title, styles.createdTitle)}>
          {created.name} is ready
        </DialogTitle>
        <DialogDescription>
          {created.kind === "object-storage"
            ? "Use these credentials with an S3-compatible client."
            : "Here is your connection URL."}
        </DialogDescription>
      </DialogHeader>
      <ConnectionPanel resource={created} />
      <DialogFooter>
        <DialogClose render={<Button size="lg" variant="outline" />}>Close</DialogClose>
      </DialogFooter>
    </>
  ) : (
    <CreateForm onCreated={setCreated} initialEngine={initialEngine} />
  );
};

export const CreateResourceDialog = ({
  open,
  onOpenChange,
  initialEngine,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEngine?: ResourceEngine;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={styles.dialog}>
      <CreateResourceContent key={initialEngine ?? "service"} initialEngine={initialEngine} />
    </DialogContent>
  </Dialog>
);
