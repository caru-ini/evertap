import type { ResourceEngine } from "@evertap/api/rules";
import { Logo } from "@evertap/ui/components/logo";

import { Arrow, Diagram, Mark } from "../../../components/diagrams/parts.tsx";

import styles from "./no-db.module.css";

const PROJECTS: { name: string; engine: ResourceEngine; port: number; resource: string }[] = [
  { name: "api", engine: "postgresql", port: 5432, resource: "api_dev" },
  { name: "blog", engine: "postgresql", port: 5433, resource: "blog" },
  { name: "shop", engine: "mysql", port: 3306, resource: "shop_dev" },
];

export function NoDb() {
  return (
    <Diagram label="Before: each project runs its own database on its own port. After: each project's .env points at evertap, which runs them all.">
      <div className={styles.panels}>
        <div className={styles.panel}>
          <p className={styles.label}>Before</p>
          <ul className={styles.projects}>
            {PROJECTS.map((project) => (
              <li key={project.name} className={styles.project}>
                <span className={styles.name}>{project.name}</span>
                <span className={styles.box}>
                  <code className={styles.key}>db:</code>
                  <Mark engine={project.engine} />
                  <code className={styles.port}>{project.port}</code>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.panel}>
          <p className={styles.label}>After</p>
          <div className={styles.after}>
            <ul className={styles.projects}>
              {PROJECTS.map((project) => (
                <li key={project.name} className={styles.project}>
                  <span className={styles.name}>{project.name}</span>
                  <span className={styles.box}>
                    <code className={styles.key}>.env</code>
                    <code>ev.internal</code>
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
              <Logo className={styles.logo} />
              <ul>
                {PROJECTS.map((project) => (
                  <li key={project.name} className={styles.resource}>
                    <Mark engine={project.engine} />
                    {project.resource}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Diagram>
  );
}
