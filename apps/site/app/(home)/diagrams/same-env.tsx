import { CloudIcon, HardDrivesIcon, LaptopIcon } from "@phosphor-icons/react/ssr";

import { Arrow, Diagram } from "./parts.tsx";

import styles from "./same-env.module.css";

const PLACES = [
  { name: "This computer", Icon: LaptopIcon },
  { name: "Home server", Icon: HardDrivesIcon },
  { name: "VPS", Icon: CloudIcon },
];

export function SameEnv() {
  return (
    <Diagram label="One .env line names ev.internal, and it works whether evertap runs on this computer, a home server, or a VPS.">
      <code className={styles.line}>
        <span className={styles.dim}>
          DATABASE_URL=
          <wbr />
          postgres://app:••••@
        </span>
        <wbr />
        <strong>ev.internal</strong>
        <span className={styles.dim}>:5432/app</span>
      </code>
      <ul className={styles.places}>
        {PLACES.map(({ name, Icon }) => (
          <li key={name} className={styles.place}>
            <Arrow down />
            <span className={styles.box}>
              <Icon className={styles.icon} />
              {name}
            </span>
          </li>
        ))}
      </ul>
    </Diagram>
  );
}
