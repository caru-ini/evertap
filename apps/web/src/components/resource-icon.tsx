import type { ResourceEngine } from "@evertap/api/rules";
import { cx } from "@evertap/ui/lib/cx";
import { Mysql, Postgresql, Redis } from "svgl-react";

import styles from "./resource-icon.module.css";

export const ResourceIcon = ({
  engine,
  className = styles.icon,
}: {
  engine: ResourceEngine;
  className?: string;
}) => {
  switch (engine) {
    case "postgresql":
      return <Postgresql aria-hidden className={className} />;
    case "mysql":
      return <Mysql aria-hidden className={cx(className, styles.mysql)} />;
    case "redis":
      return <Redis aria-hidden className={className} />;
    case "garage":
      return <img src="/brands/garage.svg" alt="" className={className} />;
  }
  return null;
};
