import { Button } from "@evertap/ui/components/button";
import { Spinner } from "@evertap/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Brand } from "@/components/brand.tsx";
import { ConnectionUrl } from "@/components/connection-url.tsx";
import { client, orpc } from "@/lib/orpc.ts";

import styles from "./sign-in-page.module.css";

const POLL_MS = 2000;

/** The command that prints a one-time sign-in link, run where evertap runs. */
const SIGNIN_LINK_COMMAND = "evertap signin-link";

/** Read once: the link's secret leaves the address bar before anything else renders. */
const takeLinkToken = () => {
  const token = window.location.hash.slice(1);
  if (token !== "") {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return token;
};

/** Shows a code for a signed-in browser to approve, and waits for the approval. */
const CodeRequest = ({ onSignedIn }: { onSignedIn: () => void }) => {
  const start = useMutation(orpc.session.start.mutationOptions());
  const code = start.data?.code;
  const claim = useQuery({
    // One poll per code: a new code starts over instead of reusing the last answer.
    queryKey: [...orpc.session.claim.key(), code],
    queryFn: () => client.session.claim(),
    enabled: code !== undefined,
    refetchInterval: (query) => (query.state.data?.status === "pending" ? POLL_MS : false),
    staleTime: 0,
    gcTime: 0,
    meta: { silent: true },
  });
  const status = claim.data?.status;

  // One request per visit, even when development mode runs effects twice.
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      start.mutate({});
    }
  }, [start]);

  useEffect(() => {
    if (status === "approved") {
      onSignedIn();
    }
  }, [status, onSignedIn]);

  if (start.isError) {
    return (
      <div className={styles.section}>
        <p className={styles.problem}>{start.error.message}</p>
        <div>
          <Button
            size="lg"
            onClick={() => {
              start.mutate({});
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (code === undefined) {
    return <Spinner aria-label="Getting a code" />;
  }
  if (status === "denied" || status === "expired") {
    return (
      <div className={styles.section}>
        <p className={styles.problem}>
          {status === "denied" ? "That sign-in was denied." : "That code has expired."} Get a new
          code to try again.
        </p>
        <div>
          <Button
            size="lg"
            onClick={() => {
              start.mutate({});
            }}
          >
            Get a new code
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <p className={styles.body}>
        On a device where you are signed in, open{" "}
        <span className={styles.path}>{window.location.origin}/device</span> and enter this code.
      </p>
      <p className={styles.code} aria-label={`Code ${code}`}>
        {code}
      </p>
      <p className={styles.waiting}>
        <Spinner aria-hidden />
        Waiting for approval
      </p>
    </div>
  );
};

/** Signs in with a link printed on the machine running evertap. */
const LinkRedeem = ({ token, onSignedIn }: { token: string; onSignedIn: () => void }) => {
  const redeem = useMutation(orpc.session.redeem.mutationOptions({ onSuccess: onSignedIn }));

  // The link works once: a second attempt would be refused.
  const sent = useRef(false);
  useEffect(() => {
    if (!sent.current) {
      sent.current = true;
      redeem.mutate({ token });
    }
  }, [redeem, token]);

  if (redeem.isError) {
    return <p className={styles.problem}>{redeem.error.message}</p>;
  }
  return <Spinner aria-label="Signing in" />;
};

export const SignInPage = ({ next }: { next?: string }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token] = useState(takeLinkToken);
  const [useCode, setUseCode] = useState(token === "");

  const signedIn = () => {
    void queryClient
      .invalidateQueries({ queryKey: orpc.session.key() })
      .then(() => navigate({ href: next ?? "/", replace: true }));
  };

  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <Brand className={styles.brand} />
        <h1 className={styles.title}>Sign in</h1>
        {useCode ? (
          <CodeRequest onSignedIn={signedIn} />
        ) : (
          <div className={styles.section}>
            <LinkRedeem token={token} onSignedIn={signedIn} />
            <div>
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setUseCode(true);
                }}
              >
                Sign in with a code instead
              </Button>
            </div>
          </div>
        )}
        <section className={styles.fallback} aria-labelledby="no-device">
          <h2 id="no-device" className={styles.fallbackTitle}>
            No device signed in?
          </h2>
          <p className={styles.hint}>
            On the machine running evertap, run this and open the link it prints, or scan its QR
            code with your phone.
          </p>
          <ConnectionUrl value={SIGNIN_LINK_COMMAND} copyLabel="Copy command" />
        </section>
      </div>
    </main>
  );
};
