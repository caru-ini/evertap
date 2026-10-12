import { DATABASE_VERSIONS, type ResourceEngine } from "@evertap/api/rules";
import { DatabaseIcon } from "@phosphor-icons/react/ssr";

import { Diagram, Mark, Panel } from "./parts.tsx";

import styles from "./services.module.css";

const SERVICES: { engine: ResourceEngine; name: string; arg: string; versions: string }[] = [
  {
    engine: "postgresql",
    name: "PostgreSQL",
    arg: "postgres",
    versions: DATABASE_VERSIONS.postgresql.join(" · "),
  },
  { engine: "mysql", name: "MySQL", arg: "mysql", versions: DATABASE_VERSIONS.mysql.join(" · ") },
  { engine: "redis", name: "Redis®", arg: "redis", versions: DATABASE_VERSIONS.redis.join(" · ") },
  { engine: "garage", name: "Buckets (Garage)", arg: "garage", versions: "No versions" },
];

/** What `evertap create` takes, with each service's versions read from the rules the server uses. */
export function Services() {
  return (
    <Diagram
      label={`evertap create takes ${SERVICES.map(({ name, arg, versions }) => `${arg} for ${name}, ${versions}`).join("; ")}.`}
    >
      <Panel
        icon={<DatabaseIcon />}
        title="Services"
        note="What evertap create takes, and the versions to choose from, newest first."
      >
        <ul className={styles.rows}>
          {SERVICES.map(({ engine, name, arg, versions }) => (
            <li key={engine} className={styles.row}>
              <Mark engine={engine} />
              <span className={styles.name}>{name}</span>
              <code className={styles.arg}>{arg}</code>
              <span className={styles.versions}>{versions}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </Diagram>
  );
}
