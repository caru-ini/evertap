import { TimerIcon } from "@phosphor-icons/react";

import { formatRemaining } from "@/lib/format.ts";

import styles from "./temporary-chip.module.css";

/** A temporary database says when it goes; the presence of the time is what makes it temporary. */
export const TemporaryChip = ({
  expiresAt,
  now,
  short = false,
}: {
  expiresAt: string;
  now: number;
  short?: boolean;
}) => {
  const remaining = formatRemaining(expiresAt, now);
  return (
    <span className={styles.chip}>
      <TimerIcon className={styles.icon} />
      {short ? (
        <>
          <span className="sr-only">{"Temporary, "}</span>
          {remaining ?? "<1 hour"} left
        </>
      ) : (
        `Temporary · deleted ${remaining ? `in ${remaining}` : "soon"}`
      )}
    </span>
  );
};
