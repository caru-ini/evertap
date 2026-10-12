import type { ResourceEngine } from "@evertap/api/rules";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import styles from "./back-link.module.css";

/**
 * One level up: a resource's data returns to the resource, a resource to its engine's list, an
 * engine's list to all resources.
 */
export const BackLink = ({
  engine,
  resourceId,
  label,
}: {
  engine?: ResourceEngine;
  resourceId?: string;
  label: string;
}) => {
  const content = (
    <>
      <ArrowLeftIcon aria-hidden className={styles.icon} />
      {label}
    </>
  );
  return resourceId === undefined ? (
    <Link to="/" search={{ engine }} className={styles.link}>
      {content}
    </Link>
  ) : (
    <Link to="/resources/$id" params={{ id: resourceId }} className={styles.link}>
      {content}
    </Link>
  );
};
