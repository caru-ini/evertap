import { formatConnection } from "@evertap/api/connections";
import type { Resource } from "@evertap/api/schemas";
import { Link } from "@tanstack/react-router";

import { CopyButton } from "@/components/copy-button.tsx";
import { formatBytes, formatTimeAgo } from "@/lib/format.ts";

import { ProtectedChip } from "./protected-chip.tsx";
import { ResourceActions } from "./resource-actions.tsx";
import { TemporaryChip } from "./temporary-chip.tsx";

import styles from "./resource-row.module.css";

export const ResourceColumns = () => (
  <div aria-hidden className={styles.columns}>
    <span>Name</span>
    <span className={styles.sizeHead}>Size</span>
    <span>Last used</span>
  </div>
);

export const ResourceRow = ({ resource, now }: { resource: Resource; now: number }) => {
  const database = resource.kind === "database";
  const size = formatBytes(resource.sizeBytes);
  const lastUsed = resource.lastConnectedAt
    ? formatTimeAgo(resource.lastConnectedAt, now)
    : "Never";
  const chips =
    resource.protected || resource.expiresAt ? (
      <>
        {resource.protected ? <ProtectedChip /> : null}
        {resource.expiresAt ? (
          <TemporaryChip short expiresAt={resource.expiresAt} now={now} />
        ) : null}
      </>
    ) : null;

  return (
    <li className={styles.row}>
      <div className={styles.main}>
        {/* Chips never start a line, so the text under the name always starts flush with it:
            they follow the name in columns and the size · last used line when stacked. */}
        <div className={styles.nameLine}>
          <h3 className={styles.name}>
            <Link
              to="/resources/$id"
              params={{ id: resource.id }}
              title={resource.name}
              className={styles.link}
            >
              {resource.name}
            </Link>
          </h3>
          {chips ? <div className={styles.chipsWide}>{chips}</div> : null}
        </div>
        <div className={styles.meta}>
          <p className={styles.stackedMeta}>
            {size} · {lastUsed === "Never" ? "Never used" : `Last used ${lastUsed}`}
          </p>
          {resource.description ? (
            <p title={resource.description} className={styles.description}>
              {resource.description}
            </p>
          ) : null}
          {chips ? <div className={styles.chipsStacked}>{chips}</div> : null}
        </div>
      </div>
      <p className={styles.size}>
        <span className="sr-only">Size </span>
        {size}
      </p>
      <p className={styles.lastUsed}>
        <span className="sr-only">Last used </span>
        {lastUsed}
      </p>
      <div className={styles.actions}>
        <CopyButton
          value={formatConnection(resource, database ? "uri" : "env")}
          label={database ? "Copy URL" : "Copy .env"}
          ariaLabel={`${database ? "Copy connection URL" : "Copy .env values"} for ${resource.name}`}
          className={styles.copy}
          labelClassName={styles.copyLabel}
        />
        <ResourceActions resource={resource} />
      </div>
    </li>
  );
};
