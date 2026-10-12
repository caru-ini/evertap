import { useState } from "react";

import { ConnectionUrl } from "./connection-url.tsx";
import { FormatSwitch } from "./format-switch.tsx";

import styles from "./proxy-config.module.css";

const PROXIES = [
  { id: "caddy", label: "Caddy" },
  { id: "nginx", label: "nginx" },
] as const;

type Proxy = (typeof PROXIES)[number]["id"];

/** A configuration to paste into Caddy or nginx, with a switch between the two. */
export const ProxyConfig = ({ configs }: { configs: Record<Proxy, string> }) => {
  const [chosen, setChosen] = useState<Proxy>("caddy");
  const label = PROXIES.find((item) => item.id === chosen)?.label ?? "";

  return (
    <>
      <FormatSwitch legend="Proxy" options={PROXIES} value={chosen} onChange={setChosen} />
      <ConnectionUrl
        value={configs[chosen]}
        size="lg"
        copyLabel={`Copy the ${label} configuration`}
        className={styles.config}
      />
    </>
  );
};
