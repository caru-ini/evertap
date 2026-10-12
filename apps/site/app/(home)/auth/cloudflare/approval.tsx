"use client";

import { useEffect, useSyncExternalStore } from "react";

import { Command } from "../../../../components/command.tsx";

import styles from "./approval.module.css";

type Outcome =
  | { kind: "code"; value: string }
  | { kind: "refused"; reason: string }
  | { kind: "none" };

// Anyone can link here with a query of their own, so the page shows only its own words and values
// shaped like a code, never text from the address.
const OAUTH_ERRORS: Record<string, string> = {
  access_denied: "The approval was declined, so evertap has no access.",
  invalid_scope: "Cloudflare would not give evertap the access it asks for.",
  server_error: "Cloudflare could not finish the approval. Try again in a minute.",
  temporarily_unavailable: "Cloudflare could not finish the approval. Try again in a minute.",
};
const ERROR_CODE = /^[a-z_]{1,64}$/;
const URL_SAFE = /^[\w.~-]{1,2048}$/;

/** What Cloudflare put in the address: the code and state to paste as one, or why it refused. */
export const readApproval = (search: string): Outcome => {
  const query = new URLSearchParams(search);
  const error = query.get("error");
  if (error) {
    const known = OAUTH_ERRORS[error];
    return {
      kind: "refused",
      reason:
        known ??
        `Cloudflare could not finish the approval${ERROR_CODE.test(error) ? ` (${error})` : ""}.`,
    };
  }
  const code = query.get("code");
  const state = query.get("state");
  if (!code || !URL_SAFE.test(code) || (state !== null && !URL_SAFE.test(state))) {
    return { kind: "none" };
  }
  return { kind: "code", value: state ? `${code}#${state}` : code };
};

// Read once and kept, as the address loses it right after.
let read: Outcome | null = null;
const fromAddress = () => (read ??= readApproval(window.location.search));
const unchanging = () => () => {};
// Unknown in the prerendered page, which has no address to read.
const prerendered = () => null;

export function Approval() {
  const outcome = useSyncExternalStore(unchanging, fromAddress, prerendered);

  useEffect(() => {
    // Off the address bar and history once read, so it goes no further than this page.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return (
    <main className={styles.page}>
      {outcome === null ? null : outcome.kind === "code" ? (
        <section className={styles.panel}>
          <h1 className={styles.title}>Paste this into evertap</h1>
          <p className={styles.lede}>
            Copy it and paste it where evertap asked: in Settings, or in the terminal running{" "}
            <code>evertap setup</code>. It works only with the evertap that sent you here, for a few
            minutes.
          </p>
          <Command value={outcome.value} />
          <p className={styles.note}>
            This page sends the code nowhere and keeps nothing. You can close it once you paste.
          </p>
        </section>
      ) : outcome.kind === "refused" ? (
        <section className={styles.panel}>
          <h1 className={styles.title}>Cloudflare did not approve evertap</h1>
          <p className={styles.lede}>{outcome.reason}</p>
          <p className={styles.note}>
            Go back to evertap and approve it again, or use a Cloudflare API token instead.
          </p>
        </section>
      ) : (
        <section className={styles.panel}>
          <h1 className={styles.title}>Nothing to paste</h1>
          <p className={styles.lede}>
            This page shows a code once you approve evertap in Cloudflare. Start from Settings or{" "}
            <code>evertap setup</code>, and Cloudflare brings you back here.
          </p>
        </section>
      )}
    </main>
  );
}
