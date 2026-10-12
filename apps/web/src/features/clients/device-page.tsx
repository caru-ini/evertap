import { DEMO_PAIRING_CODE, normalizePairingCode } from "@evertap/api/rules";
import type { Client } from "@evertap/api/schemas";
import { Button, buttonVariants } from "@evertap/ui/components/button";
import { Field, FieldError, FieldLabel } from "@evertap/ui/components/field";
import { Input } from "@evertap/ui/components/input";
import { Spinner } from "@evertap/ui/components/spinner";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ConnectionUrl } from "@/components/connection-url.tsx";
import { EVERTAP_LOGIN_COMMAND } from "@/lib/evertap-cli.ts";
import { formatTimeAgo } from "@/lib/format.ts";
import { orpc } from "@/lib/orpc.ts";
import { useNow } from "@/lib/use-now.ts";

import styles from "./device-page.module.css";

const CodeForm = ({ rejected }: { rejected?: string }) => {
  const navigate = useNavigate();
  const status = useQuery(orpc.system.status.queryOptions());
  const [typed, setTyped] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const code = normalizePairingCode(typed);
  // The rejected code's message gives way as soon as another one is being typed.
  const error =
    submitted && code === null
      ? "Enter the eight letters of the code"
      : typed === ""
        ? rejected
        : undefined;

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (code !== null) void navigate({ to: "/device", search: { code } });
      }}
    >
      <Field data-invalid={error !== undefined}>
        <FieldLabel htmlFor="pairing-code">Code</FieldLabel>
        <Input
          id="pairing-code"
          autoFocus
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setSubmitted(false);
          }}
          placeholder="XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error !== undefined}
          aria-describedby="pairing-code-help"
          className={styles.codeInput}
        />
        {error === undefined ? null : <FieldError id="pairing-code-help">{error}</FieldError>}
      </Field>
      <div>
        <Button type="submit" size="lg">
          Continue
        </Button>
      </div>
      {status.data?.mode === "demo" ? (
        <p className={styles.demoNote}>
          <span className={styles.strong}>Nothing to add in the demo</span> — no device can ask yet.
          Open the example request{" "}
          <Link to="/device" search={{ code: DEMO_PAIRING_CODE }} className={styles.demoLink}>
            {DEMO_PAIRING_CODE}
          </Link>
          .
        </p>
      ) : null}
    </form>
  );
};

const TITLES = { browser: "Sign in a browser", cli: "Pair a CLI" } as const;

const Page = ({ title, children }: { title: string; children: ReactNode }) => (
  <article className={styles.page}>
    <header className={styles.header}>
      <Link to="/clients" className={styles.back}>
        <ArrowLeftIcon aria-hidden size={14} />
        Clients
      </Link>
      <h1 className={styles.title}>{title}</h1>
    </header>
    {children}
  </article>
);

const PairingRequest = ({ code }: { code: string }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const now = useNow();
  const [paired, setPaired] = useState<Client | null>(null);
  const pairing = useQuery({
    ...orpc.clients.pairing.get.queryOptions({ input: { code } }),
    enabled: paired === null,
  });

  const approve = useMutation(
    orpc.clients.pairing.approve.mutationOptions({
      onSuccess: async (client) => {
        setPaired(client);
        // Not the whole clients key: the approved code's own query would only come back not found.
        await queryClient.invalidateQueries({ queryKey: orpc.clients.list.key() });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
  const deny = useMutation(
    orpc.clients.pairing.deny.mutationOptions({
      onSuccess: () => navigate({ to: "/clients", replace: true }),
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  if (paired) {
    return (
      <Page title={TITLES[paired.kind === "browser" ? "browser" : "cli"]}>
        <div className={styles.paired}>
          <p className={styles.body}>
            {paired.kind === "browser" ? (
              <>
                <span className={styles.clientName}>{paired.name}</span> is signed in. It continues
                on its own.
              </>
            ) : (
              <>
                <span className={styles.clientName}>{paired.name}</span> is paired. Go back to its
                terminal; evertap login finishes on its own.
              </>
            )}
          </p>
          <div>
            <Link to="/clients" className={buttonVariants({ variant: "outline", size: "lg" })}>
              View clients
            </Link>
          </div>
        </div>
      </Page>
    );
  }
  if (pairing.isPending) {
    return (
      <Page title="Add a device">
        <Spinner aria-label="Checking the code" />
      </Page>
    );
  }
  if (pairing.isError) {
    return <AddDevice rejected={pairing.error.message} />;
  }

  const busy = approve.isPending || deny.isPending;
  const browser = pairing.data.kind === "browser";

  return (
    <Page title={TITLES[pairing.data.kind]}>
      <div className={styles.request}>
        <p className={styles.body}>
          {browser
            ? "A browser is asking to sign in to evertap. Approve it only if you just opened evertap there and the code matches the one it shows."
            : "A CLI is asking to use evertap. Approve it only if you just ran evertap login and the code matches the one in your terminal."}
        </p>
        <dl className={styles.details}>
          <div>
            <dt>Code</dt>
            <dd className={styles.code}>{pairing.data.code}</dd>
          </div>
          <div>
            <dt>{browser ? "Browser" : "Machine"}</dt>
            <dd className={styles.machine}>{pairing.data.name}</dd>
          </div>
          <div>
            <dt>IP address</dt>
            <dd className={styles.address}>{pairing.data.source ?? "—"}</dd>
          </div>
          <div>
            <dt>Asked</dt>
            <dd className={styles.asked}>{formatTimeAgo(pairing.data.requestedAt, now)}</dd>
          </div>
        </dl>
        <div className={styles.decision}>
          <Button
            size="lg"
            disabled={busy}
            onClick={() => {
              approve.mutate({ code });
            }}
          >
            {approve.isPending ? <Spinner /> : null}
            Approve
          </Button>
          <Button
            variant="outline"
            size="lg"
            disabled={busy}
            onClick={() => {
              deny.mutate({ code });
            }}
          >
            Deny
          </Button>
        </div>
        <p className={styles.scope}>
          {browser
            ? "A signed-in browser can do everything you can here, including approving other sign-ins, until you revoke it in Clients."
            : "A paired CLI can create, list, and delete resources and read their connection details, for you and for the agents it runs, until you revoke it. It cannot pair other machines or create API keys."}
        </p>
      </div>
    </Page>
  );
};

const AddDevice = ({ rejected }: { rejected?: string }) => (
  <Page title="Add a device">
    <div className={styles.steps}>
      <p className={styles.body}>
        Enter the code shown on the device you are adding: a browser on its sign-in page, or a
        terminal that ran evertap login.
      </p>
      <CodeForm rejected={rejected} />
      <h2 className={styles.nextStep}>Pairing a CLI?</h2>
      <p className={styles.hint}>
        On that machine, run this. It prints a code and opens this page. Agents on that machine use
        evertap through the CLI.
      </p>
      <ConnectionUrl value={EVERTAP_LOGIN_COMMAND} copyLabel="Copy command" />
    </div>
  </Page>
);

export const DevicePage = ({ code }: { code?: string }) =>
  code === undefined ? <AddDevice /> : <PairingRequest code={code} />;
