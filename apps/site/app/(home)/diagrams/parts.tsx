import type { ResourceEngine } from "@evertap/api/rules";
import { cx } from "@evertap/ui/lib/cx";
import { ShieldCheckIcon, TimerIcon } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { Mysql, Postgresql, Redis } from "svgl-react";

import styles from "./parts.module.css";

/** The frame every diagram sits in; its width decides whether the diagram runs across or down. */
export function Diagram({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className={styles.diagram} aria-label={label}>
      {children}
    </figure>
  );
}

/** A line with a head; `turn` points it down once the diagram is too narrow to run across. */
export function Arrow({ down = false, turn = false }: { down?: boolean; turn?: boolean }) {
  return (
    <span className={cx(styles.arrow, down && styles.down, turn && styles.turn)} aria-hidden />
  );
}

export function Mark({ engine }: { engine: ResourceEngine }) {
  switch (engine) {
    case "postgresql":
      return <Postgresql aria-hidden className={styles.mark} />;
    case "mysql":
      return <Mysql aria-hidden className={cx(styles.mark, styles.mysql)} />;
    case "redis":
      return <Redis aria-hidden className={styles.mark} />;
    case "garage":
      return <img src="/brands/garage.svg" alt="" className={styles.mark} />;
  }
  return null;
}

export function TemporaryChip() {
  return (
    <span className={cx(styles.chip, styles.temporary)}>
      <TimerIcon />2 days left
    </span>
  );
}

export function ProtectedChip() {
  return (
    <span className={cx(styles.chip, styles.protected)}>
      <ShieldCheckIcon weight="fill" />
      Protected
    </span>
  );
}
