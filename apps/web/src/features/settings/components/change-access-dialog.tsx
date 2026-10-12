import {
  ACCESS_CHOICES,
  ACCESS_CHOICE_NAMES,
  ACCESS_QUESTION,
  type AccessChoice,
  PROXY_PLACES,
  SETTING_VARIABLES,
  STORAGE_URL_EXAMPLE,
  exposedWarning,
  offeredChoices,
} from "@evertap/api/rules";
import type { NetworkGuide, SavedSettings, Settings, SettingsPreview } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@evertap/ui/components/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@evertap/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@evertap/ui/components/field";
import { Input } from "@evertap/ui/components/input";
import { Spinner } from "@evertap/ui/components/spinner";
import { cx } from "@evertap/ui/lib/cx";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretDownIcon,
  CheckIcon,
  LockSimpleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";

import { orpc } from "@/lib/orpc.ts";

import { CHOICE_OUTCOMES, choiceOf, dockerOf, listenReach, savedFor } from "../access-modes.ts";
import { ChoiceIcon } from "./choice-icon.tsx";
import { type Choice, Choices } from "./choices.tsx";
import { CloudflareTunnel, type Leaving } from "./cloudflare-tunnel.tsx";
import { SignInAgain } from "./sign-in-again.tsx";

import styles from "./change-access-dialog.module.css";

/** What the server would put in force for `choice`, before anything moves. */
type Review = { input: SavedSettings; choice: AccessChoice; preview: SettingsPreview };

/** A value an environment variable sets, shown where its control would be. */
const Fixed = ({
  label,
  value,
  mono = false,
  variable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  variable: string;
}) => (
  <div className={styles.fixed}>
    <p className={styles.legend}>{label}</p>
    <p className={cx(styles.fixedValue, mono && styles.mono)}>{value}</p>
    <p className={styles.fixedNote}>
      <LockSimpleIcon aria-hidden className={styles.lock} />
      Set by <code className={styles.variable}>{variable}</code> where evertap runs
    </p>
  </div>
);

/** What a choice can also take, folded away until the person opens it. */
const More = ({
  label,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) => (
  <Collapsible open={open} onOpenChange={onOpenChange}>
    <CollapsibleTrigger className={styles.more}>
      <CaretDownIcon aria-hidden className={styles.caret} />
      {label}
    </CollapsibleTrigger>
    <CollapsiblePanel>
      <div className={styles.morePanel}>{children}</div>
    </CollapsiblePanel>
  </Collapsible>
);

/** An address field, with what it is for or why it is wrong. */
const AddressField = ({
  label,
  optional = false,
  value,
  onChange,
  placeholder,
  error,
  description,
}: {
  label: string;
  optional?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error: string | null;
  description: ReactNode;
}) => {
  const id = useId();
  return (
    <Field data-invalid={error !== null}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? <span className={styles.optional}>optional</span> : null}
      </FieldLabel>
      <Input
        id={id}
        inputMode="url"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={`${id}-help`}
        aria-required={!optional}
        className={styles.urlInput}
      />
      {error ? (
        <FieldError id={`${id}-help`}>{error}</FieldError>
      ) : (
        <FieldDescription id={`${id}-help`}>{description}</FieldDescription>
      )}
    </Field>
  );
};

const ChangeAccessContent = ({
  settings,
  guide,
  onDone,
}: {
  settings: Settings;
  guide: NetworkGuide;
  onDone: () => void;
}) => {
  const queryClient = useQueryClient();
  const docker = dockerOf(guide);
  const current = choiceOf(settings, guide);
  const envUrl = settings.publicUrl.source === "env" ? settings.publicUrl.value : null;
  const envListen = settings.listenHost.source === "env" ? settings.listenHost.value : null;
  const offered = offeredChoices(
    { mode: settings.mode.source === "env" ? settings.mode.value : null, listenHost: envListen },
    docker,
  );
  const [choice, setChoice] = useState<AccessChoice>(
    current !== null && offered.includes(current) ? current : (offered[0] ?? "local"),
  );
  // What the person typed before is kept for the choice it was for.
  const ownUrl = settings.publicUrl.source === "saved" ? (settings.publicUrl.value ?? "") : "";
  const [lanUrl, setLanUrl] = useState(current === "network" ? ownUrl : "");
  const [otherAddress, setOtherAddress] = useState(current === "network" && ownUrl !== "");
  const [proxyUrl, setProxyUrl] = useState(current === "proxy" ? ownUrl : "");
  const [place, setPlace] = useState(
    envListen ?? (current === "proxy" ? settings.listenHost.value : "127.0.0.1"),
  );
  const savedStorage =
    settings.mode.value === "network" && settings.storageUrl.source === "saved"
      ? (settings.storageUrl.value ?? "")
      : "";
  const [storage, setStorage] = useState(savedStorage);
  const [buckets, setBuckets] = useState(savedStorage !== "");
  const [problem, setProblem] = useState<{ field: "url" | "storage"; message: string } | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  // Cut off, with nowhere this browser can sign in again.
  const [stranded, setStranded] = useState<Review | null>(null);
  const [moving, setMoving] = useState(false);
  // The tunnel evertap runs goes through Cloudflare: made or changed, or left with `leaving`.
  const [cloudflare, setCloudflare] = useState<{ leaving?: Leaving } | null>(null);

  const preview = useMutation(orpc.system.settings.preview.mutationOptions());
  const update = useMutation(orpc.system.settings.update.mutationOptions());

  if (cloudflare) {
    return (
      <CloudflareTunnel
        settings={settings}
        leaving={cloudflare.leaving}
        onBack={() => {
          setCloudflare(null);
        }}
      />
    );
  }

  const lan = guide.listenChoices.find(({ use }) => use === "lan");
  // Devices on the network reach where it listens now, such as its Tailscale address, or anywhere.
  const lanHost = envListen ?? (current === "network" ? settings.listenHost.value : "0.0.0.0");
  const lanDefault = current === "network" ? settings.publicUrl.value : (lan?.defaultUrl ?? null);
  const exposes = guide.listenChoices.find(({ address }) => address === lanHost)?.exposes ?? null;

  // The address each choice opens evertap at, where the UI can tell before it is made.
  const addresses: Record<AccessChoice, string | null> = {
    local: guide.localUrl,
    network: lanDefault,
    cloudflare: settings.tunnel ? `https://${settings.tunnel.hostnames.ui}` : null,
    proxy: current === "proxy" ? settings.publicUrl.value : null,
  };

  const places: Choice<string>[] = [
    { id: "127.0.0.1", ...PROXY_PLACES.proxy },
    ...(docker === null ? [] : [{ id: docker, ...PROXY_PLACES.docker }]),
  ];
  // A listen address set some other way stays one choice away.
  if (current === "proxy" && !places.some(({ id }) => id === settings.listenHost.value)) {
    places.push({
      id: settings.listenHost.value,
      label: "As it is now",
      hint: listenReach(settings.listenHost.value, guide),
      address: settings.listenHost.value,
    });
  }

  if (stranded) {
    const url = stranded.preview.settings.publicUrl.value;
    return (
      <>
        <DialogHeader>
          <DialogTitle className={styles.title}>
            Switched to {ACCESS_CHOICE_NAMES[stranded.choice].label}
          </DialogTitle>
          <DialogDescription>
            {url && stranded.choice === "local"
              ? `Open evertap on the machine running it, at ${url}.`
              : "evertap can't tell its address on your network."}{" "}
            To change it back, run evertap setup on the machine running evertap.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button size="lg" autoFocus />}>Close</DialogClose>
        </DialogFooter>
      </>
    );
  }

  if (review) {
    const { input, preview: next } = review;
    const url = next.settings.publicUrl.value;
    const label = ACCESS_CHOICE_NAMES[review.choice].label;
    const bucketsAt = next.settings.storageUrl.value;
    // The host this browser signs in at once the change leaves it without the one it came to.
    const opens =
      next.cutOff && url !== null && review.choice !== "local" ? new URL(url).host : null;
    const back = () => {
      setReview(null);
      setFailure(null);
    };
    return (
      <>
        <DialogHeader>
          <DialogTitle className={styles.title}>
            {review.choice === current ? "Save these changes?" : `Switch to ${label}?`}
          </DialogTitle>
          <DialogDescription>
            Check where browsers will open evertap. Sign-in links point there.
          </DialogDescription>
        </DialogHeader>
        <div className={styles.destination}>
          <p className={styles.legend}>Browsers will open evertap at</p>
          {url ? (
            <p className={styles.url}>
              <ChoiceIcon choice={review.choice} className={styles.urlIcon} />
              <span className={styles.mono}>{url}</span>
            </p>
          ) : (
            <p className={styles.fixedNote}>
              evertap can't tell its address on your network. Go back and give the one browsers use
              under Use another address.
            </p>
          )}
        </div>
        <div className={styles.outcome}>
          <p>{CHOICE_OUTCOMES[review.choice]}</p>
          {bucketsAt ? (
            <p>
              Buckets reached from anywhere are served at{" "}
              <span className={styles.mono}>{bucketsAt}</span>.
            </p>
          ) : null}
        </div>
        {/* Other machines cannot open evertap on this computer alone. */}
        <SignInAgain from={settings.publicUrl.value} to={review.choice === "local" ? null : url} />
        {next.cutOff ? (
          <div className={styles.warning}>
            <p>
              This browser can no longer open evertap at{" "}
              <span className={styles.mono}>{window.location.host}</span>.
              {opens ? ` Next, it opens evertap at ${opens}, signed in.` : null}
            </p>
            {review.choice === "network" ? (
              <p>From outside this network, evertap can't be opened anymore.</p>
            ) : null}
            {opens ? null : (
              <p>
                {review.choice === "local"
                  ? "Only the machine running evertap opens it then."
                  : "evertap can't tell where browsers open it then."}{" "}
                To change it back, run evertap setup on the machine running evertap.
              </p>
            )}
          </div>
        ) : null}
        {failure ? (
          <p role="alert" className={styles.failure}>
            {failure}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={update.isPending || moving}
            onClick={back}
          >
            <ArrowLeftIcon aria-hidden />
            Back
          </Button>
          {settings.tunnel ? (
            // Next comes whether Cloudflare keeps the tunnel evertap stops running.
            <Button
              type="button"
              size="lg"
              autoFocus
              onClick={() => {
                setCloudflare({
                  leaving: { input, to: review.choice, cutOff: next.cutOff, opens },
                });
              }}
            >
              <ArrowRightIcon aria-hidden />
              Continue
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              autoFocus
              disabled={update.isPending || moving}
              onClick={() => {
                setFailure(null);
                update.mutate(input, {
                  onSuccess: async (result) => {
                    if (result.signIn) {
                      setMoving(true);
                      window.location.assign(result.signIn);
                      return;
                    }
                    if (next.cutOff) {
                      setStranded(review);
                      return;
                    }
                    onDone();
                    await queryClient.invalidateQueries({ queryKey: orpc.system.key() });
                  },
                  onError: (error) => {
                    setFailure(error.message);
                  },
                });
              }}
            >
              {update.isPending || moving ? <Spinner /> : <CheckIcon aria-hidden />}
              {opens ? `Switch and open ${opens}` : review.choice === current ? "Save" : "Switch"}
            </Button>
          )}
        </DialogFooter>
      </>
    );
  }

  const urlProblem = problem?.field === "url" ? problem.message : null;
  const storageProblem = problem?.field === "storage" ? problem.message : null;
  const bucketsField = (
    <More label="Buckets reached from anywhere" open={buckets} onOpenChange={setBuckets}>
      <AddressField
        label="Bucket address"
        optional
        value={storage}
        onChange={(value) => {
          setStorage(value);
          setProblem(null);
        }}
        placeholder={STORAGE_URL_EXAMPLE}
        error={storageProblem}
        description="Where your proxy serves buckets reached from anywhere, apart from evertap's own address."
      />
    </More>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className={styles.title}>Change access</DialogTitle>
        <DialogDescription>
          You'll see the address browsers open evertap at before anything changes.
        </DialogDescription>
      </DialogHeader>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setFailure(null);
          if (choice === "cloudflare") {
            setCloudflare({});
            return;
          }
          const built = savedFor(choice, {
            lanHost,
            place,
            lanUrl,
            proxyUrl,
            storage,
            urlFixed: envUrl !== null,
          });
          if (!("saved" in built)) {
            if (built.field === "storage") {
              setBuckets(true);
            } else if (choice === "network") {
              setOtherAddress(true);
            }
            setProblem(built);
            return;
          }
          const input = built.saved;
          preview.mutate(input, {
            onSuccess: (next) => {
              setReview({ input, choice, preview: next });
            },
            onError: (error) => {
              setFailure(error.message);
            },
          });
        }}
      >
        <div className={styles.question}>
          <Choices
            legend={ACCESS_QUESTION}
            options={offered.map((option) => ({
              id: option,
              ...ACCESS_CHOICE_NAMES[option],
              address: addresses[option] ?? undefined,
              icon: <ChoiceIcon choice={option} />,
            }))}
            value={choice}
            onChange={(id) => {
              setChoice(id);
              setProblem(null);
            }}
          />
          {offered.length < ACCESS_CHOICES.length ? (
            <p className={styles.fixedNote}>
              <LockSimpleIcon aria-hidden className={styles.lock} />
              Set by{" "}
              <code className={styles.variable}>
                {settings.mode.source === "env"
                  ? SETTING_VARIABLES.mode
                  : SETTING_VARIABLES.listenHost}
              </code>{" "}
              where evertap runs
            </p>
          ) : null}
        </div>

        {choice === "network" ? (
          <>
            {exposes ? <p className={styles.warning}>{exposedWarning(exposes)}</p> : null}
            <More label="Use another address" open={otherAddress} onOpenChange={setOtherAddress}>
              {envUrl ? (
                <Fixed label="Address" value={envUrl} mono variable={SETTING_VARIABLES.publicUrl} />
              ) : (
                <AddressField
                  label="Address"
                  optional
                  value={lanUrl}
                  onChange={(value) => {
                    setLanUrl(value);
                    setProblem(null);
                  }}
                  placeholder="http://evertap.local:8080"
                  error={urlProblem}
                  description={
                    lanDefault
                      ? `Such as this machine's name on your network or on Tailscale. Leave it empty for ${lanDefault}.`
                      : "evertap can't tell this machine's address on your network. Give the one browsers use."
                  }
                />
              )}
            </More>
            {bucketsField}
          </>
        ) : null}

        {choice === "proxy" ? (
          <>
            {envListen ? (
              <Fixed
                label="Where it runs"
                value={envListen}
                mono
                variable={SETTING_VARIABLES.listenHost}
              />
            ) : places.length > 1 ? (
              <Choices
                legend="Where does it run?"
                options={places}
                value={place}
                onChange={setPlace}
              />
            ) : null}
            {envUrl ? (
              <Fixed label="Address" value={envUrl} mono variable={SETTING_VARIABLES.publicUrl} />
            ) : (
              <AddressField
                label="Address"
                value={proxyUrl}
                onChange={(value) => {
                  setProxyUrl(value);
                  setProblem(null);
                }}
                placeholder="https://evertap.example.com"
                error={urlProblem}
                description="Where your proxy or tunnel serves evertap. Sign-in links point here."
              />
            )}
            {bucketsField}
          </>
        ) : null}

        {failure ? (
          <p role="alert" className={styles.failure}>
            {failure}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" size="lg" />}>
            Cancel
          </DialogClose>
          <Button type="submit" size="lg" disabled={preview.isPending}>
            {preview.isPending ? <Spinner /> : <ArrowRightIcon aria-hidden />}
            Continue
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};

/** Changing where evertap is opened from: the choice, then the new address to confirm. */
export const ChangeAccessDialog = ({
  settings,
  guide,
  open,
  onOpenChange,
}: {
  settings: Settings;
  guide: NetworkGuide;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={styles.content}>
      <ChangeAccessContent
        settings={settings}
        guide={guide}
        onDone={() => {
          onOpenChange(false);
        }}
      />
    </DialogContent>
  </Dialog>
);
