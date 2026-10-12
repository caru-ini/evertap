import { DATABASE_VERSIONS, type ResourceEngine } from "@evertap/api/rules";
import { Logo } from "@evertap/ui/components/logo";
import { BrowserIcon, GitBranchIcon, TerminalWindowIcon } from "@phosphor-icons/react/ssr";

import { Arrow, Diagram, Mark } from "../../../components/diagrams/parts.tsx";

import styles from "./overview.module.css";

const CLIENTS = [
  { name: "Browser", Icon: BrowserIcon },
  { name: "CLI", Icon: TerminalWindowIcon },
  { name: "CI", Icon: GitBranchIcon },
];

const SERVICES: { engine: ResourceEngine; name: string; versions: string }[] = [
  { engine: "postgresql", name: "PostgreSQL", versions: DATABASE_VERSIONS.postgresql.join(" · ") },
  { engine: "mysql", name: "MySQL", versions: DATABASE_VERSIONS.mysql.join(" · ") },
  { engine: "redis", name: "Redis®", versions: DATABASE_VERSIONS.redis.join(" · ") },
  { engine: "garage", name: "Garage", versions: "S3" },
];

export function Overview() {
  return (
    <Diagram label="Browsers, the CLI, and CI reach evertap, which runs PostgreSQL, MySQL, Redis, and Garage in Docker.">
      <div className={styles.flow}>
        <ul className={styles.clients}>
          {CLIENTS.map(({ name, Icon }) => (
            <li key={name} className={styles.client}>
              <span className={styles.box}>
                <Icon className={styles.icon} />
                {name}
              </span>
              <span className={styles.across}>
                <Arrow />
              </span>
            </li>
          ))}
        </ul>
        <span className={styles.downOnly}>
          <Arrow down />
        </span>
        <div className={styles.evertap}>
          <Logo />
        </div>
        <Arrow turn />
        <div className={styles.docker}>
          <p className={styles.label}>Docker</p>
          <ul>
            {SERVICES.map((service) => (
              <li key={service.engine} className={styles.service}>
                <Mark engine={service.engine} />
                <span className={styles.name}>{service.name}</span>
                <code className={styles.versions}>{service.versions}</code>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Diagram>
  );
}
