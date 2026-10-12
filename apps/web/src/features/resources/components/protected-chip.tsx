import { ShieldCheckIcon } from "@phosphor-icons/react";

import styles from "./protected-chip.module.css";

/** Green because it is a safe state, set apart from the amber temporary countdown beside it. */
export const ProtectedChip = () => (
  <span className={styles.chip}>
    <ShieldCheckIcon weight="fill" className={styles.icon} />
    Protected
  </span>
);
