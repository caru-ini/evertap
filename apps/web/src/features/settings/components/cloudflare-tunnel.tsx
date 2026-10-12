import {
  ACCESS_CHOICE_NAMES,
  type AccessChoice,
  CLOUDFLARE_CONNECTED_APPS,
  TUNNEL_STATES,
  type TunnelPhase,
  tunnelLeftovers,
  zoneOf,
} from "@evertap/api/rules";
import {
  type SavedSettings,
  type Settings,
  type TunnelChange,
  type TunnelNames,
  type TunnelOutcome,
  tunnelNamesSchema,
} from "@evertap/api/schemas";
import { Button, buttonVariants } from "@evertap/ui/components/button";
import {
  DialogClose,
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
  ArrowSquareOutIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { orpc } from "@/lib/orpc.ts";
import { useNow } from "@/lib/use-now.ts";

import { ChoiceIcon } from "./choice-icon.tsx";
import { Choices } from "./choices.tsx";
import { SignInAgain } from "./sign-in-again.tsx";

import styles from "./cloudflare-tunnel.module.css";

type ShownTunnel = NonNullable<Settings["tunnel"]>;

/**
 * Settings without the tunnel to switch to (`input`, for `to`), and whether they leave this browser
 * without its way in; `opens` is the host it signs in at then, if any.
 */
export type Leaving = {
  input: SavedSettings;
  to: AccessChoice;
  cutOff: boolean;
  opens: string | null;
};

/** A change waiting for the person to approve evertap in Cloudflare, at `url`. */
type Approval = { change: TunnelChange; url: string };

/**
 * How a change ended: with Cloudflare, from the tunnel `before` it, or by leaving the tunnel there
 * for the person.
 */
type Done =
  | { change: TunnelChange; outcome: TunnelOutcome; before: ShownTunnel | null }
  | { left: ShownTunnel; signIn: string | null };

/** What evertap made in Cloudflare, each linked to where to remove it in Cloudflare's dashboard. */
const Leftovers = ({ tunnel }: { tunnel: ShownTunnel }) => (
  <ul className={styles.leftovers}>
    {tunnelLeftovers(tunnel).map(({ what, where, url }) => (
      <li key={url}>
        <a href={url} target="_blank" rel="noopener noreferrer" className={styles.external}>
          {what}
          <ArrowSquareOutIcon aria-hidden className={styles.externalIcon} />
        </a>
        <span className={styles.where}>{where}</span>
      </li>
    ))}
  </ul>
);

/** The tunnel evertap runs: its names, and how cloudflared is doing. */
const TunnelState = ({ tunnel }: { tunnel: ShownTunnel }) => {
  // The state moves only with the tunnel, so no need to keep checking it here.
  const doctor = useQuery({ ...orpc.system.doctor.queryOptions(), refetchInterval: false });
  const running = doctor.data?.tunnel;
  return (
    <dl className={styles.state}>
      <div className={styles.stateRow}>
        <dt className={styles.stateLabel}>evertap</dt>
        <dd className={styles.mono}>https://{tunnel.hostnames.ui}</dd>
      </div>
      <div className={styles.stateRow}>
        <dt className={styles.stateLabel}>Buckets</dt>
        <dd className={styles.mono}>https://{tunnel.hostnames.storage}</dd>
      </div>
      <div className={styles.stateRow}>
        <dt className={styles.stateLabel}>Tunnel</dt>
        <dd>{running ? TUNNEL_STATES[running.state].label : "Checking…"}</dd>
      </div>
    </dl>
  );
};

/** The names to make the tunnel at, or to move it to. */
const NamesStep = ({
  tunnel,
  onBack,
  onApprove,
}: {
  tunnel: ShownTunnel | null;
  onBack: () => void;
  onApprove: (approval: Approval) => void;
}) => {
  const uiId = useId();
  const storageId = useId();
  const [ui, setUi] = useState(tunnel?.hostnames.ui ?? "");
  const [storage, setStorage] = useState(tunnel?.hostnames.storage ?? "");
  const [problem, setProblem] = useState<{ field: "ui" | "storage"; message: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const start = useMutation(orpc.system.settings.tunnel.start.mutationOptions());
  const typed = tunnelNamesSchema.safeParse({ ui, storage });
  const zone = typed.success ? zoneOf(typed.data.ui) : "example.com";
  const uiProblem = problem?.field === "ui" ? problem.message : null;
  const storageProblem = problem?.field === "storage" ? problem.message : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className={styles.title}>
          {tunnel ? "Change the Cloudflare Tunnel" : "Let evertap create the tunnel"}
        </DialogTitle>
        <DialogDescription>
          evertap makes the tunnel, its DNS records, and a Cache Rule in your Cloudflare account
          once you approve it there, and keeps no Cloudflare credential.
          {tunnel ? " To stop using it, go back and choose another way to open evertap." : null}
        </DialogDescription>
      </DialogHeader>
      {tunnel ? <TunnelState tunnel={tunnel} /> : null}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setFailure(null);
          if (!typed.success) {
            const [issue] = typed.error.issues;
            setProblem({
              field: issue?.path[0] === "storage" ? "storage" : "ui",
              message: issue?.message ?? "Give a name such as evertap.example.com",
            });
            return;
          }
          const change: TunnelChange = { action: "set-up", names: typed.data };
          start.mutate(change, {
            onSuccess: (started) => {
              onApprove({ change, url: started.url });
            },
            onError: (error) => {
              setFailure(error.message);
            },
          });
        }}
      >
        <Field data-invalid={uiProblem !== null}>
          <FieldLabel htmlFor={uiId}>Name for evertap</FieldLabel>
          <Input
            id={uiId}
            value={ui}
            onChange={(event) => {
              setUi(event.target.value);
              setProblem(null);
            }}
            placeholder="evertap.example.com"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={uiProblem !== null}
            aria-describedby={`${uiId}-help`}
            aria-required
            className={styles.input}
          />
          {uiProblem ? (
            <FieldError id={`${uiId}-help`}>{uiProblem}</FieldError>
          ) : (
            <FieldDescription id={`${uiId}-help`}>
              One level under a domain on Cloudflare. Browsers open evertap here, and sign-in links
              point here.
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={storageProblem !== null}>
          <FieldLabel htmlFor={storageId}>
            Name for buckets
            <span className={styles.optional}>optional</span>
          </FieldLabel>
          <Input
            id={storageId}
            value={storage}
            onChange={(event) => {
              setStorage(event.target.value);
              setProblem(null);
            }}
            placeholder={`s3.${zone}`}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={storageProblem !== null}
            aria-describedby={`${storageId}-help`}
            className={styles.input}
          />
          {storageProblem ? (
            <FieldError id={`${storageId}-help`}>{storageProblem}</FieldError>
          ) : (
            <FieldDescription id={`${storageId}-help`}>
              Where buckets reached from anywhere are served, in the same domain. Empty takes{" "}
              <span className={styles.mono}>s3.{zone}</span>.
            </FieldDescription>
          )}
        </Field>
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
            disabled={start.isPending}
            onClick={onBack}
          >
            <ArrowLeftIcon aria-hidden />
            Back
          </Button>
          <Button type="submit" size="lg" disabled={start.isPending}>
            {start.isPending ? <Spinner /> : <ArrowRightIcon aria-hidden />}
            Continue
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};

/** Whether Cloudflare keeps the tunnel once evertap switches to `leaving` and stops running it. */
const LeaveStep = ({
  tunnel,
  leaving,
  onBack,
  onApprove,
  onLeft,
}: {
  tunnel: ShownTunnel;
  leaving: Leaving;
  onBack: () => void;
  onApprove: (approval: Approval) => void;
  onLeft: (signIn: string | null) => void;
}) => {
  const [after, setAfter] = useState<"remove" | "leave">("remove");
  const [failure, setFailure] = useState<string | null>(null);
  const start = useMutation(orpc.system.settings.tunnel.start.mutationOptions());
  const update = useMutation(orpc.system.settings.update.mutationOptions());
  const pending = start.isPending || update.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle className={styles.title}>The tunnel evertap runs</DialogTitle>
        <DialogDescription>
          Switching to {ACCESS_CHOICE_NAMES[leaving.to].label}, evertap stops running it. Remove it
          from Cloudflare too, or leave it there.
        </DialogDescription>
      </DialogHeader>
      <TunnelState tunnel={tunnel} />
      <Choices
        legend="In Cloudflare"
        options={[
          {
            id: "remove",
            label: "Remove it",
            hint: "With its DNS records and Cache Rule, once you approve evertap in Cloudflare",
          },
          {
            id: "leave",
            label: "Leave it there",
            hint: "evertap lists what to remove there yourself",
          },
        ]}
        value={after}
        onChange={setAfter}
      />
      {failure ? (
        <p role="alert" className={styles.failure}>
          {failure}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" disabled={pending} onClick={onBack}>
          <ArrowLeftIcon aria-hidden />
          Back
        </Button>
        <Button
          type="button"
          size="lg"
          autoFocus
          disabled={pending}
          onClick={() => {
            setFailure(null);
            const onError = (error: Error) => {
              setFailure(error.message);
            };
            if (after === "leave") {
              update.mutate(leaving.input, {
                onSuccess: (result) => {
                  onLeft(result.signIn);
                },
                onError,
              });
              return;
            }
            const change: TunnelChange = { action: "remove", next: leaving.input };
            start.mutate(change, {
              onSuccess: (started) => {
                onApprove({ change, url: started.url });
              },
              onError,
            });
          }}
        >
          {pending ? <Spinner /> : after === "leave" ? <CheckIcon aria-hidden /> : null}
          {after === "leave"
            ? leaving.opens
              ? `Switch and open ${leaving.opens}`
              : "Switch"
            : "Continue"}
          {after === "remove" && !pending ? <ArrowRightIcon aria-hidden /> : null}
        </Button>
      </DialogFooter>
    </>
  );
};

/**
 * What each phase of a change is called while the person waits, in the order they come. A tunnel
 * evertap already runs keeps its connection, so only a new one has cloudflared connect.
 */
const phaseSteps = (
  names: TunnelNames | null,
  connects: boolean,
): { phase: TunnelPhase; label: string; hint?: string }[] =>
  names
    ? [
        { phase: "approval", label: "Check the code with Cloudflare" },
        {
          phase: "cloudflare",
          label: `Make the tunnel, DNS records, and Cache Rule for ${names.ui}`,
        },
        ...(connects
          ? [
              {
                phase: "connecting" as const,
                label: "Connect cloudflared to Cloudflare",
                hint: "Up to a minute, and longer for its first download",
              },
            ]
          : []),
        { phase: "switching", label: `Switch to ${names.ui}` },
      ]
    : [
        { phase: "approval", label: "Check the code with Cloudflare" },
        { phase: "cloudflare", label: "Remove the tunnel, its DNS records, and its Cache Rule" },
        { phase: "switching", label: "Switch" },
      ];

/**
 * Where the change is, step by step, and how long it has taken so far; with `opening`, every step
 * is done and the browser is about to open that host.
 */
const Progress = ({
  names,
  connects,
  startedAt,
  opening,
}: {
  names: TunnelNames | null;
  connects: boolean;
  startedAt: number;
  opening: string | null;
}) => {
  const progress = useQuery({
    ...orpc.system.settings.tunnel.progress.queryOptions(),
    refetchInterval: 1000,
    enabled: opening === null,
  });
  const steps = phaseSteps(names, connects);
  const phase = progress.data?.phase ?? "approval";
  const at =
    opening === null
      ? Math.max(
          0,
          steps.findIndex((step) => step.phase === phase),
        )
      : steps.length;
  const seconds = Math.max(0, Math.floor((useNow(1000) - startedAt) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className={styles.form}>
      <ol className={styles.progress}>
        {steps.map((step, index) => (
          <li
            key={step.phase}
            aria-current={index === at ? "step" : undefined}
            className={cx(
              styles.progressStep,
              index < at && styles.stepDone,
              index > at && styles.stepLater,
            )}
          >
            <span className={styles.stepMark}>
              {index < at ? (
                <CheckIcon aria-hidden weight="bold" />
              ) : index === at ? (
                <Spinner />
              ) : (
                <span className={styles.stepDot} />
              )}
            </span>
            <span className={styles.stepText}>
              <span>
                {step.label}
                {index === at ? <span className={styles.elapsed}>{elapsed}</span> : null}
              </span>
              {step.hint && index === at ? (
                <span className={styles.stepHint}>{step.hint}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.note}>
        {opening ? `Done. Opening ${opening}…` : "Keep this page open until it is done."}
      </p>
    </div>
  );
};

/** The steps that approve evertap in Cloudflare and bring the code back, then make the change. */
const ApproveStep = ({
  approval,
  tunnel,
  address,
  opening,
  onBack,
  onDone,
}: {
  approval: Approval;
  tunnel: ShownTunnel | null;
  /** Where evertap is opened now, which laptops signed in at. */
  address: string | null;
  /** The host the browser opens next, once the change is done. */
  opening: string | null;
  onBack: () => void;
  onDone: (outcome: TunnelOutcome) => void;
}) => {
  const codeId = useId();
  const [pasted, setPasted] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const finish = useMutation(
    orpc.system.settings.tunnel.finish.mutationOptions({
      onSuccess: onDone,
      onError: (error) => {
        setFailure(error.message);
      },
    }),
  );
  const { change } = approval;
  const names = change.action === "set-up" ? change.names : null;
  const zone = names ? zoneOf(names.ui) : (tunnel?.zone ?? "");
  const action = !names
    ? "Remove the tunnel"
    : !tunnel
      ? "Create the tunnel"
      : tunnel.hostnames.ui === names.ui && tunnel.hostnames.storage === names.storage
        ? "Set it up again"
        : "Change the tunnel";

  if (finish.isPending || opening) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className={styles.title}>
            {!names
              ? "Removing the tunnel"
              : tunnel
                ? "Changing the tunnel"
                : "Creating the tunnel"}
          </DialogTitle>
          <DialogDescription>This can take a minute or two.</DialogDescription>
        </DialogHeader>
        <Progress names={names} connects={!tunnel} startedAt={startedAt} opening={opening} />
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className={styles.title}>Approve evertap in Cloudflare</DialogTitle>
        <DialogDescription>
          evertap uses the access for this change alone and gives it back right after. It keeps no
          Cloudflare credential.
        </DialogDescription>
      </DialogHeader>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (pasted.trim() === "") {
            setFailure("Paste the code evertap.dev shows once you approve evertap in Cloudflare");
            return;
          }
          setFailure(null);
          setStartedAt(Date.now());
          finish.mutate({ change, pasted });
        }}
      >
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span>
              Open Cloudflare, choose the account that has{" "}
              <span className={styles.mono}>{zone}</span>, and allow evertap.
            </span>
            <a
              href={approval.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "lg", className: styles.open })}
            >
              Open Cloudflare
              <ArrowSquareOutIcon aria-hidden />
            </a>
          </li>
          <li className={styles.step}>
            Cloudflare then sends you to evertap.dev, which shows a code. Paste it here.
          </li>
        </ol>
        {names && tunnel && tunnel.hostnames.storage !== names.storage ? (
          <p className={styles.warning}>
            Buckets reached from anywhere move to{" "}
            <span className={styles.mono}>https://{names.storage}</span>. Change{" "}
            <span className={styles.mono}>S3_PUBLIC_ENDPOINT</span> in each .env you copied for one.
          </p>
        ) : null}
        {names ? <SignInAgain from={address} to={`https://${names.ui}`} /> : null}
        <Field data-invalid={failure !== null}>
          <FieldLabel htmlFor={codeId}>Code</FieldLabel>
          <Input
            id={codeId}
            value={pasted}
            onChange={(event) => {
              setPasted(event.target.value);
              setFailure(null);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={failure !== null}
            aria-describedby={`${codeId}-help`}
            className={styles.input}
          />
          {failure ? (
            <FieldError id={`${codeId}-help`}>{failure}</FieldError>
          ) : (
            <FieldDescription id={`${codeId}-help`}>
              {names
                ? `evertap then routes ${names.ui} and ${names.storage} through the tunnel. Cloudflare takes a few more minutes to start serving a new name.`
                : "evertap then removes the tunnel, its DNS records, and its Cache Rule."}
            </FieldDescription>
          )}
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={finish.isPending}
            onClick={onBack}
          >
            <ArrowLeftIcon aria-hidden />
            Back
          </Button>
          <Button type="submit" size="lg" disabled={finish.isPending}>
            {finish.isPending ? <Spinner /> : <CheckIcon aria-hidden />}
            {action}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};

/** How the change went, with what is left for the person to do. */
const DoneStep = ({ done, leaving }: { done: Done; leaving: Leaving | undefined }) => {
  const switched = leaving ? `Switched to ${ACCESS_CHOICE_NAMES[leaving.to].label}` : "Switched";
  // Cut off with nowhere to sign in, this browser has no way back to evertap.
  const stranded = leaving?.cutOff && leaving.opens === null;
  const signIn = "left" in done ? done.signIn : done.outcome.signIn;
  const url = "left" in done ? null : done.outcome.settings.publicUrl.value;
  const footer = (
    <DialogFooter>
      {signIn ? (
        <>
          <DialogClose render={<Button variant="outline" size="lg" />}>Close</DialogClose>
          <a href={signIn} className={buttonVariants({ size: "lg" })}>
            Open {leaving?.opens ?? (url ? new URL(url).host : "evertap")}
            <ArrowRightIcon aria-hidden />
          </a>
        </>
      ) : (
        <DialogClose render={<Button size="lg" autoFocus />}>Close</DialogClose>
      )}
    </DialogFooter>
  );
  const back = stranded ? (
    <p className={styles.note}>
      This browser can no longer open evertap. To change it back, run evertap setup on the machine
      running evertap.
    </p>
  ) : null;

  if ("left" in done) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className={styles.title}>{switched}</DialogTitle>
          <DialogDescription>
            evertap no longer runs the tunnel. These stay in Cloudflare; remove them there once you
            no longer need them.
          </DialogDescription>
        </DialogHeader>
        <Leftovers tunnel={done.left} />
        {back}
        {footer}
      </>
    );
  }
  const { change, outcome, before } = done;
  const host = url ? new URL(url).host : null;
  // Cloudflare starts serving a name new to the tunnel only a few minutes after the switch.
  const newName = change.action === "set-up" && host !== null && before?.hostnames.ui !== host;
  return (
    <>
      <DialogHeader>
        <DialogTitle className={styles.title}>
          {change.action === "remove"
            ? switched
            : before
              ? "The tunnel is changed"
              : "The tunnel is ready"}
        </DialogTitle>
        <DialogDescription>
          {change.action === "set-up"
            ? "evertap runs the tunnel, and buckets reached from anywhere are served through it too."
            : outcome.revoked === null
              ? "evertap removes the tunnel, its DNS records, and its Cache Rule from Cloudflare now. If it cannot, its log on the machine running evertap lists what to remove."
              : outcome.left
                ? "evertap no longer runs the tunnel."
                : "evertap removed the tunnel, its DNS records, and its Cache Rule from Cloudflare."}
        </DialogDescription>
      </DialogHeader>
      {change.action === "set-up" && url ? (
        <div className={styles.destination}>
          <p className={styles.legend}>Browsers open evertap at</p>
          <p className={styles.url}>
            <ChoiceIcon choice="cloudflare" className={styles.urlIcon} />
            <span className={styles.mono}>{url}</span>
          </p>
        </div>
      ) : null}
      {newName ? (
        <p className={styles.warning}>
          Cloudflare takes a few minutes to start serving {host}, and until then it shows an error,
          such as a failed SSL handshake. Wait a few minutes, then open it.
        </p>
      ) : null}
      {signIn ? (
        <p className={styles.note}>
          This browser came in at an address that no longer leads to evertap. The button opens the
          new one and signs this browser in there, once, within 10 minutes.
        </p>
      ) : null}
      {back}
      {outcome.left ? (
        <div className={styles.left}>
          <p className={styles.warning}>
            evertap could not remove what it made in Cloudflare for{" "}
            {outcome.left.tunnel.hostnames.ui}: {outcome.left.reason}. Remove it there:
          </p>
          <Leftovers tunnel={outcome.left.tunnel} />
        </div>
      ) : null}
      {outcome.revoked === false ? (
        <p className={styles.warning}>
          Cloudflare did not confirm it took back evertap's access. Remove evertap under{" "}
          <a href={CLOUDFLARE_CONNECTED_APPS} target="_blank" rel="noopener noreferrer">
            Connected applications
          </a>{" "}
          in Cloudflare.
        </p>
      ) : null}
      {footer}
    </>
  );
};

/**
 * The Cloudflare Tunnel evertap runs, as dialog content: its names and state, making or changing
 * it, and with `leaving`, whether Cloudflare keeps it once evertap switches to those settings. A
 * change goes through approving evertap in Cloudflare and the code evertap.dev shows, and ends on
 * how it went, or at the new address when there is nothing to read here.
 */
export const CloudflareTunnel = ({
  settings,
  leaving,
  onBack,
}: {
  settings: Settings;
  leaving?: Leaving;
  onBack: () => void;
}) => {
  const queryClient = useQueryClient();
  const tunnel = settings.tunnel;
  const [approval, setApproval] = useState<Approval | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  // A browser that signs in elsewhere, or has lost its way in, has nothing left to refresh here.
  const refresh = (signIn: string | null) => {
    if (signIn === null && !leaving?.cutOff) {
      void queryClient.invalidateQueries({ queryKey: orpc.system.key() });
    }
  };

  if (done) {
    return <DoneStep done={done} leaving={leaving} />;
  }
  if (approval) {
    return (
      <ApproveStep
        approval={approval}
        tunnel={tunnel}
        address={settings.publicUrl.value}
        opening={opening}
        onBack={() => {
          setApproval(null);
        }}
        onDone={(outcome) => {
          // A new name is not served yet, so the person opens it from the next step when it is.
          if (
            approval.change.action === "remove" &&
            outcome.signIn &&
            !outcome.left &&
            outcome.revoked !== false
          ) {
            const signIn = outcome.signIn;
            // Long enough to see every step done before the page goes.
            setOpening(new URL(signIn).host);
            setTimeout(() => {
              window.location.assign(signIn);
            }, 1200);
            return;
          }
          setDone({ change: approval.change, outcome, before: tunnel });
          refresh(outcome.signIn);
        }}
      />
    );
  }
  if (leaving && tunnel) {
    return (
      <LeaveStep
        tunnel={tunnel}
        leaving={leaving}
        onBack={onBack}
        onApprove={setApproval}
        onLeft={(signIn) => {
          setDone({ left: tunnel, signIn });
          refresh(signIn);
        }}
      />
    );
  }
  return <NamesStep tunnel={tunnel} onBack={onBack} onApprove={setApproval} />;
};
