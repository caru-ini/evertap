import { RESOURCE_ENGINES, type ResourceEngine } from "@evertap/api/rules";
import { LogoMark } from "@evertap/ui/components/logo";
import { cx } from "@evertap/ui/lib/cx";
import { ShieldCheckIcon, TimerIcon } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { Mysql, Postgresql, Redis } from "svgl-react";

import { Brand } from "../brand.tsx";

import styles from "./parts.module.css";

/** The frame every diagram sits in; its width decides whether the diagram runs across or down. */
export function Diagram({ label, children }: { label: string; children: ReactNode }) {
  return (
    // `not-prose` keeps the docs pages' Markdown styles off the boxes and lists inside.
    <figure className={cx(styles.diagram, "not-prose")} aria-label={label}>
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

/** Things in order, with `<Then />` between them; they run down once the diagram is narrow. `even` gives each the same width, so rows of them line up. */
export function Flow({ even = false, children }: { even?: boolean; children: ReactNode }) {
  return <div className={cx(styles.flow, even && styles.even)}>{children}</div>;
}

export function Then() {
  return <span className={cx(styles.arrow, styles.then)} aria-hidden />;
}

/** An arrow down to the next thing, with what travels along it beside it. */
export function Hop({ children }: { children?: ReactNode }) {
  return (
    <span className={styles.hop}>
      <Arrow down />
      {children && <span className={styles.hopLabel}>{children}</span>}
    </span>
  );
}

/** Steps or fallbacks in order, one under another with an arrow between. */
export function Sequence({ children }: { children: ReactNode[] }) {
  return (
    <ol className={styles.sequence}>
      {children.map((child, i) => (
        <li key={i} className={styles.sequenceStep}>
          {i > 0 && <Arrow down />}
          {child}
        </li>
      ))}
    </ol>
  );
}

/** evertap and the services it runs in Docker, as every diagram of the machine shows them. */
export function EvertapAndDocker({ code = "evertap serve" }: { code?: ReactNode }) {
  return (
    <Flow>
      <Item icon={<LogoMark />} code={code}>
        evertap
      </Item>
      <Then />
      <Item icon={<Brand name="docker" />}>
        Docker
        <Engines />
      </Item>
    </Flow>
  );
}

/** A card with an icon, a title, and one line under it, then what it shows. */
export function Panel({
  icon,
  title,
  note,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.panel}>
      <div>
        <p className={styles.panelTitle}>
          {icon}
          {title}
        </p>
        {note && <p className={styles.panelNote}>{note}</p>}
      </div>
      {children}
    </div>
  );
}

/** One thing in a panel, with what to type or where it is in mono under it; `tone` marks a state. */
export function Item({
  icon,
  children,
  code,
  tone,
  wrap = false,
}: {
  icon?: ReactNode;
  children: ReactNode;
  code?: ReactNode;
  tone?: "led" | "amber";
  wrap?: boolean;
}) {
  return (
    <span className={cx(styles.item, tone && styles[tone])}>
      {icon}
      <span className={styles.itemText}>
        {children}
        {code && <code className={cx(styles.code, wrap && styles.wrap)}>{code}</code>}
      </span>
    </span>
  );
}

/** A dashed outline around what runs on one machine, named at its top. */
export function Group({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <p className={styles.groupLabel}>{label}</p>
      {children}
    </div>
  );
}

export function Engines() {
  return (
    <span className={styles.engines}>
      {RESOURCE_ENGINES.map((engine) => (
        <Mark key={engine} engine={engine} />
      ))}
    </span>
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
