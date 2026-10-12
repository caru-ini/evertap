import type { NetworkGuide } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import { Spinner } from "@evertap/ui/components/spinner";
import { CheckCircleIcon, PulseIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";

import { ProxyConfig } from "@/components/proxy-config.tsx";
import { orpc } from "@/lib/orpc.ts";

import styles from "./proxy-panel.module.css";

/**
 * What to paste into the proxy in front of evertap, and a check, made from evertap itself, that the
 * address reaches it through that proxy.
 */
export const ProxyPanel = ({
  proxy,
  url,
}: {
  proxy: NonNullable<NetworkGuide["proxy"]>;
  url: string;
}) => {
  const check = useMutation(orpc.system.settings.check.mutationOptions());

  return (
    <div className={styles.panel}>
      <p className={styles.note}>
        Paste this into the proxy that serves evertap at <code className={styles.mono}>{url}</code>.
        It passes requests on to <code className={styles.mono}>{proxy.upstream}</code>, WebSocket
        upgrades and the caller's address included.
      </p>
      <ProxyConfig configs={proxy} />
      <div className={styles.check}>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={check.isPending}
          onClick={() => {
            check.mutate(undefined);
          }}
        >
          {check.isPending ? <Spinner /> : <PulseIcon aria-hidden />}
          Check the address
        </Button>
        <div role="status" className={styles.outcome}>
          {check.error ? (
            <p className={styles.failure}>{check.error.message}</p>
          ) : check.data && check.data.problems.length === 0 ? (
            <p className={styles.reached}>
              <CheckCircleIcon aria-hidden weight="fill" className={styles.reachedIcon} />
              {check.data.url} reaches this evertap
            </p>
          ) : check.data ? (
            <div className={styles.problems}>
              <p>
                {check.data.result === "reached"
                  ? `${check.data.url} reaches this evertap, but:`
                  : `${check.data.url} does not reach this evertap yet:`}
              </p>
              <ul className={styles.list}>
                {check.data.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
