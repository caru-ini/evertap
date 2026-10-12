import { useQuery } from "@tanstack/react-query";

import { ConnectionUrl } from "@/components/connection-url.tsx";
import { orpc } from "@/lib/orpc.ts";

import styles from "./sign-in-again.module.css";

/**
 * What a change that moves evertap from `from` to `to` means for every CLI that uses `from`: each
 * keeps that address, as `evertap login` or `EVERTAP_URL` gave it, until it is set up again.
 */
export const SignInAgain = ({ from, to }: { from: string | null; to: string | null }) => {
  const clients = useQuery(orpc.clients.list.queryOptions());
  const laptops = (clients.data ?? []).filter(({ kind }) => kind === "cli");
  const keys = (clients.data ?? []).some(({ kind }) => kind === "api-key");
  if (!from || !to || from === to || (laptops.length === 0 && !keys)) {
    return null;
  }
  const names = new Intl.ListFormat("en").format(laptops.map(({ name }) => name));
  return (
    <div className={styles.warning}>
      <p>
        Every CLI that uses <span className={styles.mono}>{from}</span> can no longer reach evertap
        there.
        {laptops.length > 0 ? ` On each laptop (${names}), sign in again:` : null}
      </p>
      {laptops.length > 0 ? (
        <ConnectionUrl value={`evertap login ${to}`} copyLabel="Copy command" />
      ) : null}
      {keys ? (
        <p>
          With an API key, as in CI, set <span className={styles.mono}>EVERTAP_URL={to}</span>.
        </p>
      ) : null}
    </div>
  );
};
