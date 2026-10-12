import { RESOURCE_ENGINES } from "@evertap/api/rules";
import { cx } from "@evertap/ui/lib/cx";
import { CheckIcon } from "@phosphor-icons/react/ssr";

import { Arrow, Diagram, Mark } from "../../../components/diagrams/parts.tsx";

import styles from "./create.module.css";

export function Create() {
  return (
    <Diagram label="Pick a service, name it, and copy its connection URL.">
      <div className={styles.steps}>
        <div className={styles.panel}>
          <ul className={styles.services}>
            {RESOURCE_ENGINES.map((engine) => (
              <li
                key={engine}
                className={cx(styles.service, engine === "postgresql" && styles.picked)}
              >
                <Mark engine={engine} />
              </li>
            ))}
          </ul>
        </div>
        <Arrow turn />
        <div className={styles.panel}>
          <span className={styles.input}>
            blog
            <span className={styles.caret} />
          </span>
          <span className={styles.button}>Create</span>
        </div>
        <Arrow turn />
        <div className={cx(styles.panel, styles.wide)}>
          <code className={styles.url}>
            postgres://blog:••••@
            <wbr />
            ev.internal:5432/blog
          </code>
          <span className={styles.copied}>
            <CheckIcon weight="bold" />
            Copied
          </span>
        </div>
      </div>
    </Diagram>
  );
}
