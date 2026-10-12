import { TEMPORARY_WINDOW_MS } from "@evertap/api/rules";
import { Button } from "@evertap/ui/components/button";
import { Switch } from "@evertap/ui/components/switch";
import { cx } from "@evertap/ui/lib/cx";
import { PushPinIcon, TrashIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { BackLink } from "@/components/back-link.tsx";
import { ResourceIcon } from "@/components/resource-icon.tsx";
import { formatBytes, formatDate, formatTimeAgo } from "@/lib/format.ts";
import { orpc } from "@/lib/orpc.ts";
import { ENGINE_INFO } from "@/lib/resource-engines.ts";
import { useKeepResource } from "@/lib/use-keep-resource.ts";
import { useNow } from "@/lib/use-now.ts";
import { useSetProtected } from "@/lib/use-set-protected.ts";

import { ConnectionPanel } from "./components/connection-panel.tsx";
import { DeleteResourceDialog } from "./components/delete-resource-dialog.tsx";
import { NoteEditor } from "./components/note-editor.tsx";
import { ProtectedChip } from "./components/protected-chip.tsx";
import { QuickActions } from "./components/quick-actions.tsx";
import { ReachableAnywhere } from "./components/reachable-anywhere.tsx";
import { TemporaryChip } from "./components/temporary-chip.tsx";

import styles from "./resource-page.module.css";

const TEMPORARY_WINDOW_DAYS = Math.round(TEMPORARY_WINDOW_MS / (24 * 60 * 60 * 1000));

const Detail = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className={styles.detail}>
    <dt className={styles.detailLabel}>{label}</dt>
    <dd className={styles.detailValue}>{children}</dd>
  </div>
);

export const ResourcePage = ({ id }: { id: string }) => {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const { data: resource } = useSuspenseQuery(orpc.resources.get.queryOptions({ input: { id } }));
  const title = useRef<HTMLHeadingElement>(null);
  const setProtected = useSetProtected();
  const keep = useKeepResource();
  const now = useNow();

  useEffect(() => {
    title.current?.focus();
  }, []);

  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <BackLink engine={resource.engine} label={ENGINE_INFO[resource.engine].label} />
        <div className={styles.summary}>
          <div className={styles.identity}>
            <div className={styles.nameRow}>
              <h1 ref={title} tabIndex={-1} className={styles.name}>
                {resource.name}
              </h1>
              {resource.protected ? <ProtectedChip /> : null}
              {resource.expiresAt ? (
                <TemporaryChip expiresAt={resource.expiresAt} now={now} />
              ) : null}
            </div>
            <NoteEditor key={resource.id} resource={resource} />
            <p className={styles.engine}>
              <ResourceIcon engine={resource.engine} />
              {ENGINE_INFO[resource.engine].label}
              {resource.kind === "database" ? (
                <span className={styles.mono}>{resource.version}</span>
              ) : (
                <span>· S3 bucket</span>
              )}
            </p>
          </div>
          {/* Shown in the demo too: the data page says there is nothing to browse. */}
          <QuickActions resource={resource} />
        </div>
      </header>

      <section className={styles.connection}>
        <h2 className={styles.sectionTitle}>Connection</h2>
        <ConnectionPanel key={resource.id} resource={resource} />
      </section>

      {resource.kind === "object-storage" ? <ReachableAnywhere resource={resource} /> : null}

      <section className={styles.section}>
        <h2 className={cx(styles.sectionTitle, styles.detailsTitle)}>Details</h2>
        <dl className={styles.details}>
          <Detail label="Size">{formatBytes(resource.sizeBytes)}</Detail>
          <Detail label="Created">{formatDate(resource.createdAt)}</Detail>
          <Detail label={resource.kind === "object-storage" ? "Last used" : "Last connected"}>
            {resource.lastConnectedAt ? formatTimeAgo(resource.lastConnectedAt, now) : "Never"}
          </Detail>
          {resource.kind === "database" && resource.engine === "postgresql" ? (
            <Detail label="Extensions">
              {resource.extensions.length > 0 ? (
                <span className={styles.mono}>{resource.extensions.join(", ")}</span>
              ) : (
                <span className={styles.none}>None</span>
              )}
            </Detail>
          ) : null}
        </dl>
      </section>

      {resource.expiresAt ? (
        <section className={styles.temporary}>
          <h2 className={styles.sectionTitle}>Temporary</h2>
          <p className={styles.note}>
            Created as temporary, so it is deleted after {TEMPORARY_WINDOW_DAYS} days without a
            connection. Keep removes the expiry.
          </p>
          <div>
            <Button
              variant="outline"
              size="lg"
              disabled={keep.isPending}
              onClick={() => {
                keep.mutate({ id: resource.id });
              }}
            >
              <PushPinIcon />
              Keep
            </Button>
          </div>
        </section>
      ) : null}

      <section className={styles.deletion}>
        <label className={styles.protect}>
          <Switch
            checked={resource.protected}
            disabled={setProtected.isPending}
            onCheckedChange={(checked) => {
              setProtected.mutate({ id: resource.id, protected: checked });
            }}
            className={styles.protectSwitch}
          />
          <span className={styles.protectText}>
            <span className={styles.protectTitle}>Protect from deletion</span>
            <span className={styles.note}>
              An agent cannot delete a protected resource. You still can, by typing its name.
              Protecting a temporary resource also keeps it.
            </span>
          </span>
        </label>
        <div>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => {
              setDeleting(true);
            }}
          >
            <TrashIcon />
            Delete {resource.kind === "object-storage" ? "bucket" : "database"}…
          </Button>
        </div>
      </section>

      <DeleteResourceDialog
        resource={resource}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => {
          void navigate({ to: "/", search: { engine: resource.engine }, replace: true });
        }}
      />
    </article>
  );
};
