import {
  ACCESS_CHOICE_NAMES,
  DATABASE_HOST,
  SETTING_VARIABLES,
  TUNNEL_STATES,
  exposedWarning,
} from "@evertap/api/rules";
import type { Settings } from "@evertap/api/schemas";
import { Button } from "@evertap/ui/components/button";
import { cx } from "@evertap/ui/lib/cx";
import {
  ArrowsLeftRightIcon,
  DoorOpenIcon,
  GlobeIcon,
  LockSimpleIcon,
  PlugsIcon,
  ShareNetworkIcon,
} from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { ProxyConfig } from "@/components/proxy-config.tsx";
import { ResourceIcon } from "@/components/resource-icon.tsx";
import { orpc } from "@/lib/orpc.ts";
import { ENGINE_INFO } from "@/lib/resource-engines.ts";

import { choiceOf, listenReach } from "./access-modes.ts";
import { ChangeAccessDialog } from "./components/change-access-dialog.tsx";
import { ChoiceIcon } from "./components/choice-icon.tsx";
import { ProxyPanel } from "./components/proxy-panel.tsx";

import styles from "./settings-page.module.css";

/**
 * Whether environment variables fix everything the person could choose. The address for buckets is
 * saved only, so the choices that have one always leave something to change.
 */
const fixedByEnv = ({ mode }: Settings) => mode.source === "env" && mode.value === "local";

const Section = ({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) => (
  <section aria-label={label} className={styles.group}>
    <h2 className={styles.band}>
      {icon}
      {label}
    </h2>
    {children}
  </section>
);

const SetBy = ({ variable }: { variable: string }) => (
  <span className={styles.note}>
    <LockSimpleIcon aria-hidden className={styles.lock} />
    Set by <code className={styles.variable}>{variable}</code> where evertap runs
  </span>
);

const Row = ({
  label,
  value,
  icon,
  mono = false,
  large = false,
  note,
  variable,
  more,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  mono?: boolean;
  /** The value the section is about, set larger than the rest. */
  large?: boolean;
  note?: string;
  /** The environment variable that sets the value, when one does. */
  variable?: string;
  /** Under the value: further notes. */
  more?: ReactNode;
}) => (
  <div className={styles.row}>
    <dt className={styles.label}>{label}</dt>
    <dd className={styles.value}>
      <span className={cx(styles.main, mono && styles.mono, large && styles.large)}>
        {icon}
        {value}
      </span>
      {note ? <span className={styles.note}>{note}</span> : null}
      {variable ? <SetBy variable={variable} /> : null}
      {more}
    </dd>
  </div>
);

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export const SettingsPage = () => {
  const { data: settings } = useSuspenseQuery(orpc.system.settings.get.queryOptions());
  const { data: guide } = useSuspenseQuery(orpc.system.settings.network.queryOptions());
  const status = useQuery(orpc.system.status.queryOptions());
  // The addresses move only when the settings do, so no need to keep checking them here.
  const doctor = useQuery({ ...orpc.system.doctor.queryOptions(), refetchInterval: false });
  const [changing, setChanging] = useState(false);
  const { mode, publicUrl, listenHost, tunnel, storageUrl } = settings;
  const locked = fixedByEnv(settings);
  const choice = choiceOf(settings, guide);
  const running = doctor.data?.tunnel;
  const setBy = (setting: keyof typeof SETTING_VARIABLES) =>
    settings[setting].source === "env" ? SETTING_VARIABLES[setting] : undefined;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Settings</h1>
          {locked ? null : (
            <Button
              size="lg"
              className={styles.change}
              onClick={() => {
                setChanging(true);
              }}
            >
              <ArrowsLeftRightIcon aria-hidden />
              Change access
            </Button>
          )}
        </div>
        <p className={styles.intro}>How browsers and other machines reach evertap.</p>
      </header>

      <Section icon={<DoorOpenIcon aria-hidden />} label="Access">
        <dl className={styles.rows}>
          <Row
            label="Opened from"
            value={choice ? ACCESS_CHOICE_NAMES[choice].label : "Not set up yet"}
            icon={choice ? <ChoiceIcon choice={choice} className={styles.valueIcon} /> : null}
            note={
              choice
                ? `Listens on ${listenHost.value}, for ${lowerFirst(listenReach(listenHost.value, guide))}`
                : "Choose Change access, or run evertap setup on the machine running evertap"
            }
            variable={setBy("mode")}
            more={
              choice && setBy("listenHost") ? (
                <SetBy variable={SETTING_VARIABLES.listenHost} />
              ) : null
            }
          />
          <Row
            label="Address"
            value={publicUrl.value ?? "Unknown"}
            mono={publicUrl.value !== null}
            large={publicUrl.value !== null}
            note={
              publicUrl.value
                ? "Sign-in links point here"
                : "Sign-in links need one. Give the address browsers open evertap at"
            }
            variable={setBy("publicUrl")}
          />
          {tunnel ? (
            <Row
              label="Tunnel"
              value={running ? TUNNEL_STATES[running.state].label : "Checking…"}
              note={
                running
                  ? (TUNNEL_STATES[running.state].advice ??
                    `${running.connections} ${running.connections === 1 ? "link" : "links"} to Cloudflare`)
                  : undefined
              }
            />
          ) : null}
          {mode.value === "network" || mode.value === "cloudflare" ? (
            <Row
              label="Buckets"
              value={storageUrl.value ?? "None"}
              mono={storageUrl.value !== null}
              note={
                storageUrl.value
                  ? "Signed links to a bucket reached from anywhere point here"
                  : "Give buckets an address of their own to make their signed links work anywhere"
              }
            />
          ) : null}
        </dl>
        {guide.exposedAt ? (
          <p className={styles.warning}>{exposedWarning(guide.exposedAt)}</p>
        ) : null}
        {locked ? (
          <p className={styles.sectionNote}>
            Environment variables set all of these where evertap runs, so they change there.
          </p>
        ) : tunnel ? (
          <p className={styles.sectionNote}>
            evertap runs this tunnel at {tunnel.hostnames.ui}. Change access changes its names or
            removes it, once you approve evertap in Cloudflare.
          </p>
        ) : null}
      </Section>

      {guide.proxy && publicUrl.value ? (
        <Section icon={<ShareNetworkIcon aria-hidden />} label="Your proxy">
          {/* A new address or upstream starts over, without the last check's outcome. */}
          <ProxyPanel
            key={`${publicUrl.value} ${guide.proxy.upstream}`}
            proxy={guide.proxy}
            url={publicUrl.value}
          />
        </Section>
      ) : null}

      {guide.buckets?.proxy && storageUrl.value ? (
        <Section icon={<GlobeIcon aria-hidden />} label="Buckets reached from anywhere">
          <div className={styles.buckets}>
            <p className={styles.bucketsNote}>
              Paste this into the proxy that serves buckets at{" "}
              <code className={styles.address}>{storageUrl.value}</code>. It passes requests on to{" "}
              <code className={styles.address}>{guide.buckets.upstream}</code> with the path and
              Host they came with, which their signatures cover.
            </p>
            <ProxyConfig configs={guide.buckets.proxy} />
          </div>
        </Section>
      ) : null}

      <Section icon={<PlugsIcon aria-hidden />} label="Databases and buckets">
        <p className={styles.sectionNote}>
          {mode.value === "local"
            ? `Apps on this computer connect to them directly at ${DATABASE_HOST}.`
            : mode.value === null
              ? "They listen on this machine only until evertap is set up."
              : `They listen on this machine only. Apps reach them as ${DATABASE_HOST} through evertap connect, which carries them over the address above.`}
        </p>
        {status.data?.mode === "demo" ? (
          <p className={styles.sectionNote}>Demo mode starts nothing, so nothing listens yet.</p>
        ) : doctor.data && doctor.data.entries.length > 0 ? (
          <dl className={styles.rows}>
            {doctor.data.entries.map(({ engine, address }) => (
              <div key={engine} className={styles.row}>
                <dt className={styles.label}>
                  <ResourceIcon engine={engine} className={styles.engineIcon} />
                  {ENGINE_INFO[engine].label}
                </dt>
                <dd className={styles.value}>
                  <span className={cx(styles.main, styles.mono)}>{address}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Section>

      <ChangeAccessDialog
        settings={settings}
        guide={guide}
        open={changing}
        onOpenChange={setChanging}
      />
    </section>
  );
};
