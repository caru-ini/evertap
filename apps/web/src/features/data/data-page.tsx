import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { BackLink } from "@/components/back-link.tsx";
import { ResourceIcon } from "@/components/resource-icon.tsx";
import { orpc } from "@/lib/orpc.ts";
import { ENGINE_INFO } from "@/lib/resource-engines.ts";

import { KeyBrowser } from "./components/key-browser.tsx";
import { ObjectBrowser } from "./components/object-browser.tsx";
import { TableBrowser, type TableSelection } from "./components/table-browser.tsx";

import styles from "./data-page.module.css";

/** What is inside one resource: tables and SQL for PostgreSQL / MySQL, keys for Redis, objects for buckets. */
export const DataPage = ({
  id,
  selection,
  selectedKey,
  bucket,
  prefix,
}: {
  id: string;
  selection: TableSelection;
  selectedKey?: string;
  bucket?: string;
  prefix: string;
}) => {
  const { data: resource } = useSuspenseQuery(orpc.resources.get.queryOptions({ input: { id } }));
  const status = useQuery(orpc.system.status.queryOptions());
  const title = useRef<HTMLHeadingElement>(null);
  const redis = resource.engine === "redis";

  useEffect(() => {
    title.current?.focus();
  }, []);

  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <BackLink resourceId={resource.id} label={resource.name} />
        <h1 ref={title} tabIndex={-1} className={styles.title}>
          {resource.kind === "object-storage" ? "Objects" : redis ? "Keys" : "Data"}
        </h1>
        <p className={styles.engine}>
          <ResourceIcon engine={resource.engine} />
          {ENGINE_INFO[resource.engine].label}
          <span className={styles.name}>{resource.name}</span>
        </p>
      </header>

      {status.data?.mode === "demo" ? (
        <p className={styles.note}>
          The demo has no data to browse. Run evertap with Docker to see and edit what is inside
          this {resource.kind === "object-storage" ? "bucket" : "database"}.
        </p>
      ) : resource.kind === "object-storage" ? (
        <ObjectBrowser id={resource.id} first={resource.name} bucket={bucket} prefix={prefix} />
      ) : redis ? (
        <KeyBrowser id={resource.id} selectedKey={selectedKey} />
      ) : (
        <TableBrowser id={resource.id} selection={selection} />
      )}
    </article>
  );
};
