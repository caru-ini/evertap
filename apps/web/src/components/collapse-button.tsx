import { CollapsibleTrigger } from "@evertap/ui/components/collapsible";
import { CaretDownIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import styles from "./collapse-button.module.css";

/** A list group's heading that folds the group; it fills the band up to the band's + button. */
export const CollapseButton = ({ children }: { children: ReactNode }) => (
  <h2 className={styles.heading}>
    <CollapsibleTrigger className={styles.button}>
      <CaretDownIcon aria-hidden className={styles.caret} />
      {children}
    </CollapsibleTrigger>
  </h2>
);
