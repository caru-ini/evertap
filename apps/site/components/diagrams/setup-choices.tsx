import { DATABASE_HOST } from "@evertap/api/rules";
import {
  LaptopIcon,
  ShareNetworkIcon,
  TerminalWindowIcon,
  WifiHighIcon,
} from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";

import { Brand } from "../brand.tsx";
import { Diagram, Panel } from "./parts.tsx";

import styles from "./setup-choices.module.css";

const CONNECT = "Laptops run evertap connect";

// Named and ordered as `evertap setup` and Settings → Change access ask.
const CHOICES: { name: string; icon: ReactNode; address: string; apps: string }[] = [
  {
    name: "This computer only",
    icon: <LaptopIcon />,
    address: `http://${DATABASE_HOST}:8080`,
    apps: "Apps on this computer connect directly",
  },
  {
    name: "Devices on your network",
    icon: <WifiHighIcon />,
    address: "http://<this machine>:8080",
    apps: CONNECT,
  },
  {
    name: "Anywhere, through Cloudflare",
    icon: <Brand name="cloudflare" />,
    address: "https://evertap.example.com",
    apps: CONNECT,
  },
  {
    name: "Behind your own proxy or tunnel",
    icon: <ShareNetworkIcon />,
    address: "https://evertap.example.com",
    apps: CONNECT,
  },
];

export function SetupChoices() {
  return (
    <Diagram label="evertap setup asks where you will open evertap from: this computer only, devices on your network, anywhere through Cloudflare, or behind your own proxy or tunnel.">
      <Panel
        icon={<TerminalWindowIcon />}
        title={<code className={styles.command}>evertap setup</code>}
        note="Where will you open evertap from?"
      >
        <ul className={styles.choices}>
          {CHOICES.map(({ name, icon, address, apps }) => (
            <li key={name} className={styles.choice}>
              <span className={styles.icon}>{icon}</span>
              <span className={styles.text}>
                <span className={styles.name}>{name}</span>
                <span className={styles.apps}>{apps}</span>
              </span>
              <code className={styles.address}>{address}</code>
            </li>
          ))}
        </ul>
      </Panel>
    </Diagram>
  );
}
