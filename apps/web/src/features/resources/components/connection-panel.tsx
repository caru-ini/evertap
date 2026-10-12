import { type ConnectionFormat, formatConnection } from "@evertap/api/connections";
import type { Resource } from "@evertap/api/schemas";
import { cx } from "@evertap/ui/lib/cx";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ConnectionUrl } from "@/components/connection-url.tsx";
import { FormatSwitch } from "@/components/format-switch.tsx";
import { orpc } from "@/lib/orpc.ts";
import { getConnectionFormats, getConnectionSecrets } from "@/lib/resource-connections.ts";

import styles from "./connection-panel.module.css";

export const ConnectionPanel = ({ resource }: { resource: Resource }) => {
  const [format, setFormat] = useState<ConnectionFormat>(
    resource.kind === "object-storage" ? "credentials" : "uri",
  );
  const settings = useQuery(orpc.system.settings.get.queryOptions());
  const formats = getConnectionFormats(resource);
  const current = formats.find((item) => item.id === format);
  const mysqlPassword =
    resource.kind === "database" && resource.engine === "mysql" && format === "cli"
      ? decodeURIComponent(new URL(resource.connectionUrl).password)
      : undefined;

  return (
    <div className={styles.panel}>
      <FormatSwitch
        legend="Connection format"
        options={formats.map((item) => ({ ...item, mono: item.id !== "credentials" }))}
        value={format}
        onChange={setFormat}
      />
      {resource.kind === "object-storage" && format === "credentials" ? (
        <dl className={styles.fields}>
          {[
            { label: "Endpoint", value: resource.endpoint, wide: true },
            ...(resource.publicEndpoint === null
              ? []
              : [{ label: "Public endpoint", value: resource.publicEndpoint, wide: true }]),
            { label: "Bucket", value: resource.name },
            { label: "Region", value: resource.region },
            { label: "Access key ID", value: resource.accessKeyId, wide: true },
            {
              label: "Secret access key",
              value: resource.secretAccessKey,
              wide: true,
              secret: true,
            },
          ].map((field) => (
            <div key={field.label} className={cx(styles.field, field.wide && styles.wide)}>
              <dt className={styles.label}>{field.label}</dt>
              <dd>
                <ConnectionUrl
                  value={field.value}
                  copyLabel={`Copy ${field.label.toLowerCase()}`}
                  secrets={field.secret ? [field.value] : []}
                  secretLabel="secret key"
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <ConnectionUrl
          key={format}
          value={formatConnection(resource, format)}
          copyLabel={current?.copyLabel}
          secrets={getConnectionSecrets(resource)}
          secretLabel={resource.kind === "object-storage" ? "secret key" : "password"}
          size="lg"
        />
      )}
      {mysqlPassword !== undefined && (
        <div className={styles.password}>
          <p className={styles.passwordHint}>
            Run the command, then paste this password when prompted. If MariaDB's mysql, as on
            Debian, stops at the certificate, add --ssl-verify-server-cert=0.
          </p>
          <ConnectionUrl
            value={mysqlPassword}
            secrets={[mysqlPassword]}
            copyLabel="Copy password"
          />
        </div>
      )}
      <p className={styles.note}>
        {settings.data?.mode.value === "local"
          ? "Works on this computer."
          : "Works on any machine running evertap connect."}
        {resource.kind === "database" &&
          resource.engine === "postgresql" &&
          " To reach a database your app created, change the name after the last /."}
        {resource.kind === "object-storage" &&
          " Use an S3-compatible client with path-style addressing."}
        {resource.kind === "object-storage" &&
          resource.publicEndpoint !== null &&
          " Links signed for the public endpoint work on any device."}
      </p>
    </div>
  );
};
