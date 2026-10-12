import { cx } from "@evertap/ui/lib/cx";

import {
  Arrow,
  Diagram,
  Mark,
  ProtectedChip,
  TemporaryChip,
} from "../../../components/diagrams/parts.tsx";

import styles from "./lifecycle.module.css";

export function Lifecycle() {
  return (
    <Diagram label="A temporary resource is deleted after 7 days without a connection unless you keep it, and a protected one cannot be deleted.">
      <ul className={styles.rows}>
        <li className={styles.row}>
          <span className={styles.resource}>
            <Mark engine="postgresql" />
            scratch
            <TemporaryChip />
          </span>
          <span className={styles.step}>
            <span className={styles.label}>7 days unused</span>
            <Arrow turn />
          </span>
          <span className={cx(styles.resource, styles.deleted)}>
            <Mark engine="postgresql" />
            scratch
          </span>
        </li>
        <li className={styles.row}>
          <span className={styles.resource}>
            <Mark engine="postgresql" />
            scratch
            <TemporaryChip />
          </span>
          <span className={styles.step}>
            <span className={styles.label}>Keep</span>
            <Arrow turn />
          </span>
          <span className={styles.resource}>
            <Mark engine="postgresql" />
            scratch
          </span>
        </li>
        <li className={styles.row}>
          <span className={styles.resource}>
            <Mark engine="postgresql" />
            app_dev
          </span>
          <span className={styles.step}>
            <span className={styles.label}>Protect</span>
            <Arrow turn />
          </span>
          <span className={styles.resource}>
            <Mark engine="postgresql" />
            app_dev
            <ProtectedChip />
          </span>
        </li>
      </ul>
    </Diagram>
  );
}
